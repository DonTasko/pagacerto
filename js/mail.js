/* PagaCerto — ler um email guardado (.eml) e ficheiros ZIP, no próprio dispositivo, sem bibliotecas.
 * parseEml(bytes)  => { subject, from, date, text, attachments: [{ name, type, bytes }] }
 * readZip(bytes)   => [{ name, bytes }]   (limites contra "bombas" ZIP)
 * Funciona no browser (window.PagaMail) e em Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagaMail = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PARTS = 200;
  const MAX_DEPTH = 6;

  // ---------- utilitários ----------
  function bin(bytes) { // Uint8Array -> string "latin1" (1 caractere = 1 byte)
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  }
  function toBytes(s) { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
  function decode(bytes, charset) {
    try { return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  // Cabeçalhos com UTF-8 "em bruto" (sem =?utf-8?...?=): se os bytes forem UTF-8 válido, descodifica.
  function rawUtf8(s) {
    if (!/[\x80-\xff]/.test(s)) return s;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(toBytes(s)); } catch (e) { return s; }
  }
  function splitMsg(s) {
    const m = /\r?\n\r?\n/.exec(s);
    if (!m) return { head: s, body: '' };
    return { head: s.slice(0, m.index), body: s.slice(m.index + m[0].length) };
  }
  function headers(head) {
    const h = {};
    head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => {
      const k = l.indexOf(':');
      if (k > 0) { const n = l.slice(0, k).trim().toLowerCase(); if (!(n in h)) h[n] = l.slice(k + 1).trim(); }
    });
    return h;
  }

  // "=?utf-8?Q?Fatura_n=C2=BA?=" e "=?utf-8?B?...?="
  function encodedWords(v) {
    return String(v || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
      try {
        const bytes = /b/i.test(enc) ? toBytes(atob(txt)) : qpBytes(txt.replace(/_/g, ' '), true);
        return decode(bytes, cs);
      } catch (e) { return m; }
    }).replace(/\?=\s+=\?/g, '');
  }
  function qpBytes(s, header) {
    const out = [];
    const t = header ? s : s.replace(/=\r?\n/g, '');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
      else out.push(t.charCodeAt(i) & 255);
    }
    return Uint8Array.from(out);
  }

  // parâmetros: boundary, charset, name, filename (inclui RFC 2231: filename*=utf-8''..., filename*0=...)
  function params(v) {
    const p = {}, cont = {};
    const re = /;\s*([\w*-]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]*)/g;
    let m;
    while ((m = re.exec(String(v || '')))) {
      const key = m[1].toLowerCase();
      const val = m[3] !== undefined ? m[3].replace(/\\(.)/g, '$1') : m[2].trim();
      const c = /^([\w-]+)\*(\d+)(\*?)$/.exec(key);
      if (c) { (cont[c[1]] = cont[c[1]] || []).push({ n: +c[2], enc: !!c[3], v: val }); continue; }
      if (key.endsWith('*')) p[key.slice(0, -1)] = rfc2231(val);
      else p[key] = encodedWords(rawUtf8(val));
    }
    Object.keys(cont).forEach(k => {
      const parts = cont[k].sort((a, b) => a.n - b.n);
      const raw = parts.map(x => x.v).join('');
      p[k] = parts[0].enc ? rfc2231(raw) : raw;
    });
    return p;
  }
  function rfc2231(v) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(v);
    const cs = m ? m[1] : 'utf-8', data = m ? m[2] : v;
    try { return decode(toBytes(unescape(data)), cs || 'utf-8'); } catch (e) { return data; }
  }

  function decodeBody(body, enc) {
    enc = String(enc || '7bit').toLowerCase().trim();
    if (enc === 'base64') { try { return toBytes(atob(body.replace(/[^A-Za-z0-9+/=]/g, ''))); } catch (e) { return new Uint8Array(0); } }
    if (enc === 'quoted-printable') return qpBytes(body, false);
    return toBytes(body);
  }

  function htmlToText(h) {
    return h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&euro;/g, '€')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }

  // ---------- email ----------
  function parseEml(input) {
    const raw = typeof input === 'string' ? input : bin(input);
    const top = splitMsg(raw);
    const th = headers(top.head);
    const res = {
      subject: encodedWords(rawUtf8(th.subject || '')), from: encodedWords(rawUtf8(th.from || '')), date: th.date || '',
      text: '', attachments: []
    };
    const texts = [], htmls = [];
    let count = 0;

    function walk(msg, depth) {
      if (depth > MAX_DEPTH || ++count > MAX_PARTS) return;
      const { head, body } = splitMsg(msg);
      const h = headers(head);
      const ctRaw = h['content-type'] || 'text/plain';
      const type = ctRaw.split(';')[0].trim().toLowerCase();
      const cp = params(ctRaw);
      if (type.startsWith('multipart/') && cp.boundary) {
        const pieces = body.split('--' + cp.boundary);
        for (let i = 1; i < pieces.length; i++) {
          if (pieces[i].startsWith('--')) break;
          walk(pieces[i].replace(/^\r?\n/, ''), depth + 1);
        }
        return;
      }
      const dp = params(h['content-disposition'] || '');
      const name = dp.filename || cp.name || '';
      const bytes = decodeBody(body, h['content-transfer-encoding']);
      if (type === 'message/rfc822') {
        res.attachments.push({ name: name || 'mensagem.eml', type, bytes });
      } else if (name || /^attachment/i.test(h['content-disposition'] || '') || (!type.startsWith('text/') && !type.startsWith('multipart/'))) {
        if (bytes.length) res.attachments.push({ name: name || 'anexo', type, bytes });
      } else if (type === 'text/html') htmls.push(decode(bytes, cp.charset));
      else if (type === 'text/plain') texts.push(decode(bytes, cp.charset));
    }
    walk(raw, 0);
    res.text = (texts.join('\n').trim() || htmls.map(htmlToText).join('\n')).trim();
    return res;
  }

  // ---------- ZIP ----------
  async function inflateRaw(data, limit) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { try { await reader.cancel(); } catch (e) { /* ignorar */ } throw new Error('zip-too-big'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /** Lê os ficheiros de um ZIP. Ignora pastas, ficheiros cifrados, __MACOSX e ficheiros ocultos. */
  async function readZip(bytes, opts) {
    const MAX_FILES = (opts && opts.maxFiles) || 100;
    const MAX_ONE = (opts && opts.maxOne) || 25 * 1024 * 1024;
    const MAX_TOTAL = (opts && opts.maxTotal) || 120 * 1024 * 1024;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip-invalid');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = []; let total = 0;
    for (let i = 0; i < n && out.length < MAX_FILES; i++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip-invalid');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const nameBytes = bytes.subarray(p + 46, p + 46 + nl);
      const name = flags & 0x800 ? decode(nameBytes, 'utf-8') : bin(nameBytes);
      p += 46 + nl + el + cl;
      const base = name.split('/').pop();
      if (!base || name.endsWith('/') || /^__MACOSX\//.test(name) || base.startsWith('.')) continue;
      if (flags & 1) continue;                 // cifrado
      if (usize > MAX_ONE) continue;
      if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== 0x04034b50) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const comp = bytes.subarray(start, start + csize);
      let data;
      if (method === 0) data = comp.slice();
      else if (method === 8) { try { data = await inflateRaw(comp, MAX_ONE); } catch (e) { continue; } }
      else continue;
      total += data.length;
      if (total > MAX_TOTAL) throw new Error('zip-too-big');
      out.push({ name: base, bytes: data });
    }
    return out;
  }

  return { parseEml, readZip, htmlToText, encodedWords };
}));
