/* PagaCerto — encriptação ponta-a-ponta dos dados sincronizados.
 * Frase-passe -> PBKDF2-SHA256 (600 000 iterações, sal aleatório) -> chave AES-GCM 256 (não extraível).
 * Cada pagamento é cifrado no dispositivo; o servidor só vê ciphertext + id/data de alteração.
 * Sem bibliotecas: só WebCrypto. Se a frase-passe se perder, os dados no servidor não se recuperam.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto);
  else root.PagaCrypto = factory(root.crypto);
}(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  const ITER = 600000;
  const VERIFY_TEXT = 'pagacerto-v1';
  const subtle = () => webcrypto.subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();

  function b64(bytes) {
    let s = '';
    const u = new Uint8Array(bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  const newSalt = () => b64(webcrypto.getRandomValues(new Uint8Array(16)));

  async function deriveKey(passphrase, saltB64, iterations) {
    const base = await subtle().importKey('raw', enc.encode(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iterations || ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function encryptText(key, text) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { enc: 1, iv: b64(iv), ct: b64(ct) };
  }
  async function decryptText(key, wire) {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(wire.iv) }, key, unb64(wire.ct));
    return dec.decode(pt);
  }

  const encryptJson = (key, obj) => encryptText(key, JSON.stringify(obj));
  async function decryptJson(key, wire) { return JSON.parse(await decryptText(key, wire)); }
  const isEncrypted = p => !!(p && p.enc === 1 && typeof p.iv === 'string' && typeof p.ct === 'string');

  // Verificador: cifra um texto conhecido. Serve para saber se a frase-passe está certa, sem a guardar.
  const makeVerifier = async key => JSON.stringify(await encryptText(key, VERIFY_TEXT));
  async function checkVerifier(key, verifier) {
    try { return (await decryptText(key, JSON.parse(verifier))) === VERIFY_TEXT; } catch (e) { return false; }
  }

  // Avaliação simples da frase-passe (mínimo 10 caracteres, não só dígitos/repetições).
  function passphraseProblem(p) {
    p = String(p || '');
    if (p.length < 10) return 'A frase-passe deve ter pelo menos 10 caracteres.';
    if (/^(.)\1+$/.test(p) || /^\d+$/.test(p)) return 'Escolha uma frase-passe menos previsível (não só números nem repetições).';
    return '';
  }

  return { ITER, newSalt, deriveKey, encryptJson, decryptJson, encryptText, decryptText, isEncrypted, makeVerifier, checkVerifier, passphraseProblem };
}));
