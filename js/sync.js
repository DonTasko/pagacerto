/* PagaCerto — conta e sincronização (opcional). Sem bibliotecas: só fetch ao Supabase (Auth + PostgREST).
 * A app funciona 100% sem conta. Com conta, cada pagamento é enviado como um "payload" para a tabela pc_payments.
 * Conflitos: ganha a edição mais recente (updatedAt). Apagados viajam como lápides (deleted:true).
 * A chave abaixo é a chave PÚBLICA (publishable); a proteção dos dados vem das regras RLS no servidor.
 */
(function (root) {
  'use strict';
  const API = 'https://ubcngppazgiminiivjpj.supabase.co';
  const KEY = 'sb_publishable_ySvViONXKmD82UTC7SW_2w_jyP8_5R6';
  const PAGE = 1000, CHUNK = 200;
  const R = () => root.PagaRepo, DB = () => root.PagaDB;
  const siteUrl = () => location.origin + location.pathname;

  class SyncError extends Error {
    constructor(message, code, data) { super(message); this.code = code; this.data = data; }
  }

  function friendly(data, status) {
    const raw = (data && (data.msg || data.error_description || data.message || data.error)) || '';
    const code = (data && (data.error_code || data.code)) || '';
    const t = String(raw);
    if (/invalid login credentials/i.test(t)) return 'Email ou palavra-passe incorretos.';
    if (/email not confirmed/i.test(t)) return 'Confirme primeiro o email (veja a caixa de entrada e o spam).';
    if (/already registered/i.test(t) || code === 'user_already_exists') return 'Já existe uma conta com este email.';
    if (/password should be at least|weak_password/i.test(t + code)) return 'Palavra-passe demasiado fraca (mínimo 8 caracteres).';
    if (status === 429 || /rate limit|over_email_send_rate_limit/i.test(t + code)) return 'Demasiados pedidos. Tente novamente daqui a alguns minutos.';
    if (/same password/i.test(t)) return 'A nova palavra-passe tem de ser diferente da anterior.';
    if (/invalid email|validation_failed/i.test(t + code)) return 'Email inválido.';
    return t || ('Erro do servidor (' + status + ').');
  }

  async function api(path, o) {
    o = o || {};
    const headers = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, o.headers || {});
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    let res;
    try {
      res = await fetch(API + path, { method: o.method || 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    } catch (e) { throw new SyncError('Sem ligação à internet.', 'offline'); }
    const txt = await res.text();
    let data = null;
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { message: txt }; } }
    if (!res.ok) throw new SyncError(friendly(data, res.status), res.status, data);
    return data;
  }

  // ---------- sessão ----------
  const nowSec = () => Math.floor(Date.now() / 1000);

  async function storeSession(t) {
    const s = {
      access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: t.expires_at || (nowSec() + (t.expires_in || 3600)),
      email: (t.user && t.user.email) || '', user_id: (t.user && t.user.id) || ''
    };
    await R().settings.set('session', s);
    return s;
  }
  const clearSession = () => R().settings.set('session', null);

  async function getSession() {
    let s = await R().settings.get('session', null);
    if (!s) return null;
    if (s.expires_at - nowSec() > 60) return s;
    try {
      const t = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
      if (!t.user) t.user = { email: s.email, id: s.user_id };
      return await storeSession(t);
    } catch (e) {
      if (e.code === 'offline') throw e;
      await clearSession();
      throw new SyncError('A sessão expirou. Entre novamente.', 'expired');
    }
  }

  // ---------- conta ----------
  async function signUp(email, password) {
    const d = await api('/auth/v1/signup?redirect_to=' + encodeURIComponent(siteUrl()), { method: 'POST', body: { email, password } });
    if (d && d.access_token) return { session: await storeSession(d) };
    if (d && d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) throw new SyncError('Já existe uma conta com este email.', 'exists');
    if (d && Array.isArray(d.identities) && d.identities.length === 0) throw new SyncError('Já existe uma conta com este email.', 'exists');
    return { needsConfirm: true };
  }
  async function signIn(email, password) {
    const t = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    return storeSession(t);
  }
  async function signOut() {
    try { const s = await R().settings.get('session', null); if (s) await api('/auth/v1/logout?scope=local', { method: 'POST', token: s.access_token }); } catch (e) { /* offline: sai na mesma */ }
    await clearSession();
  }
  function recover(email) {
    return api('/auth/v1/recover?redirect_to=' + encodeURIComponent(siteUrl()), { method: 'POST', body: { email } });
  }
  async function updatePassword(password) {
    const s = await getSession();
    if (!s) throw new SyncError('Sem sessão. Abra outra vez o link do email.', 'expired');
    await api('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password } });
  }
  // Direito ao apagamento: apaga a conta e todos os pagamentos guardados no servidor.
  async function deleteAccount() {
    const s = await getSession();
    if (!s) throw new SyncError('Sem sessão.', 'expired');
    await api('/rest/v1/rpc/pc_delete_my_account', { method: 'POST', token: s.access_token, body: {} });
    await clearSession();
    await R().settings.set('syncUser', null);
    await R().settings.set('syncCursor', null);
    await R().settings.set('lastSync', null);
  }

  // Link do email (confirmar conta / recuperar palavra-passe) volta com os tokens no #hash.
  async function handleAuthRedirect() {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)(access_token|error)=/.test(h)) return null;
    const q = new URLSearchParams(h);
    if (q.get('error')) return { kind: 'error', message: (q.get('error_code') === 'otp_expired' ? 'O link expirou ou já foi usado. Peça um novo.' : (q.get('error_description') || 'Erro no link do email.').replace(/\+/g, ' ')) };
    const t = { access_token: q.get('access_token'), refresh_token: q.get('refresh_token'), expires_in: Number(q.get('expires_in')) || 3600, expires_at: Number(q.get('expires_at')) || undefined };
    try {
      const u = await api('/auth/v1/user', { token: t.access_token });
      t.user = u;
    } catch (e) { return { kind: 'error', message: e.message }; }
    const session = await storeSession(t);
    return { kind: q.get('type') === 'recovery' ? 'recovery' : 'login', session };
  }

  // ---------- sincronização ----------
  async function migrateLocal() {
    const all = await DB().getAll('payments');
    const fix = all.filter(p => !p.updatedAt && !p.sample);
    fix.forEach(p => { p.updatedAt = p.createdAt || new Date().toISOString(); p._dirty = true; });
    if (fix.length) await DB().putMany('payments', fix);
  }
  async function markAllDirty() {
    const all = (await DB().getAll('payments')).filter(p => !p.sample);
    all.forEach(p => { if (!p.updatedAt) p.updatedAt = p.createdAt || new Date().toISOString(); p._dirty = true; });
    if (all.length) await DB().putMany('payments', all);
  }

  async function mergeRow(row) {
    const local = await DB().get('payments', row.id);
    const remoteTs = Date.parse(row.updated_at);
    if (local && local.updatedAt && Date.parse(local.updatedAt) >= remoteTs) return false; // o local é igual ou mais recente
    const rec = row.deleted ? { id: row.id, dueDate: '' } : Object.assign({}, row.payload, { id: row.id });
    if (row.deleted) rec.deleted = true; else delete rec.deleted;
    rec.updatedAt = row.updated_at;
    delete rec._dirty;
    await DB().put('payments', rec);
    return true;
  }

  const wire = p => {
    const payload = Object.assign({}, p);
    delete payload._dirty; delete payload.deleted;
    return { id: p.id, payload: p.deleted ? {} : payload, updated_at: p.updatedAt, deleted: !!p.deleted };
  };

  const st = { busy: false, error: '' };
  let running = null, timer = null;

  function syncNow() {
    if (running) return running;
    running = (async () => {
      let pulled = 0, pushed = 0;
      try {
        const s = await getSession();
        if (!s) return { skipped: true };
        st.busy = true; st.error = '';
        await migrateLocal();

        // 1) receber
        let cursor = await R().settings.get('syncCursor', null);
        for (;;) {
          const path = '/rest/v1/pc_payments?select=id,payload,updated_at,deleted,synced_at&order=synced_at.asc&limit=' + PAGE +
            (cursor ? '&synced_at=gte.' + encodeURIComponent(cursor) : '');
          const rows = await api(path, { token: s.access_token });
          for (const row of rows) { if (await mergeRow(row)) pulled++; }
          if (rows.length) { cursor = rows[rows.length - 1].synced_at; await R().settings.set('syncCursor', cursor); }
          if (rows.length < PAGE) break;
        }

        // 2) enviar o que mudou aqui
        const dirty = (await DB().getAll('payments')).filter(p => p._dirty && !p.sample);
        for (let i = 0; i < dirty.length; i += CHUNK) {
          const chunk = dirty.slice(i, i + CHUNK);
          await api('/rest/v1/pc_payments?on_conflict=id', {
            method: 'POST', token: s.access_token,
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: chunk.map(wire)
          });
          for (const p of chunk) {
            const cur = await DB().get('payments', p.id);
            if (cur && cur.updatedAt === p.updatedAt) { delete cur._dirty; await DB().put('payments', cur); }
          }
          pushed += chunk.length;
        }
        await R().settings.set('lastSync', new Date().toISOString());
        if (pulled) root.dispatchEvent(new CustomEvent('pagacerto-synced', { detail: { pulled, pushed } }));
        return { pulled, pushed };
      } catch (e) {
        st.error = e.code === 'offline' ? '' : e.message;
        if (e.code === 'expired') root.dispatchEvent(new CustomEvent('pagacerto-synced', { detail: { expired: true } }));
        return { error: e.message, offline: e.code === 'offline' };
      } finally { st.busy = false; running = null; }
    })();
    return running;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { syncNow(); }, 2500);
  }

  async function info() {
    const s = await R().settings.get('session', null);
    return { email: s ? s.email : '', lastSync: await R().settings.get('lastSync', null), busy: st.busy, error: st.error };
  }

  function start() {
    root.addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    return syncNow();
  }

  root.PagaSync = { signUp, signIn, signOut, recover, updatePassword, deleteAccount, handleAuthRedirect, syncNow, schedule, info, start, markAllDirty, getSession };
}(typeof self !== 'undefined' ? self : this));
