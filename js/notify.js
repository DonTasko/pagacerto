/* PagaCerto — lembretes locais. A lógica (plan) é pura e testável em Node; o resto só corre na app Android (Capacitor).
 * Cada pagamento por pagar gera notificações "N dias antes" e no dia, à hora escolhida, mais um aviso de atraso no dia seguinte.
 * Os alarmes são sempre recalculados de raiz: cancela-se tudo e volta-se a agendar (barato e sem estados perdidos).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./models.js'));
  else root.PagaNotify = factory(root.PagaModels);
}(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const MAX_SCHEDULED = 60;   // margem de segurança nos limites do sistema
  const CHANNEL = 'pagamentos';

  // id numérico estável (as notificações do Android usam inteiros de 32 bits)
  function notifId(paymentId, days) {
    const s = paymentId + '|' + days;
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h % 2147483646) + 1;
  }

  function atLocal(iso, hour) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0);
  }

  function body(p, days) {
    if (days === -1) return 'Em atraso desde ' + M.formatDate(p.dueDate) + '. Abra a app para pagar ou marcar como pago.';
    if (days === 0) return 'Vence hoje (' + M.formatDate(p.dueDate) + ').';
    if (days === 1) return 'Vence amanhã (' + M.formatDate(p.dueDate) + ').';
    return 'Vence em ' + days + ' dias (' + M.formatDate(p.dueDate) + ').';
  }

  // payments -> [{ id, paymentId, at: Date, title, body }] (só o futuro, por ordem, no máximo MAX_SCHEDULED)
  function plan(payments, o) {
    o = o || {};
    const now = o.now || new Date();
    const hour = o.hour == null ? 9 : o.hour;
    const out = [];
    for (const p of payments) {
      if (p.deleted || p.status === 'paid' || !p.dueDate) continue;
      const days = (p.remindDays || []).filter(n => Number.isInteger(n) && n >= 0);
      if (!days.length) continue;                       // "Criar lembrete" desligado
      const inst = M.installmentLabel(p);
      const title = (p.issuer || 'Pagamento') + ' · ' + M.formatEUR(p.amountCents) + (inst ? ' · ' + inst.toLowerCase() : '');
      const all = Array.from(new Set(days)).concat([-1]); // -1 = aviso de atraso
      for (const d of all) {
        const dayISO = d === -1 ? M.addDays(p.dueDate, 1) : M.addDays(p.dueDate, -d);
        const at = atLocal(dayISO, hour);
        if (at.getTime() <= now.getTime() + 5000) continue;
        out.push({ id: notifId(p.id, d), paymentId: p.id, at, title, body: body(p, d) });
      }
    }
    out.sort((a, b) => a.at - b.at);
    return out.slice(0, MAX_SCHEDULED);
  }

  // ---------- parte nativa (só no browser, dentro da app Android) ----------
  const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
  const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  const LN = () => cap().Plugins.LocalNotifications;
  let timer = null, wired = false;

  async function status() {
    if (!isNative()) return { native: false };
    const perm = await LN().checkPermissions();
    const pend = await LN().getPending();
    return { native: true, granted: perm.display === 'granted', pending: pend.notifications.length };
  }

  async function requestPermission() {
    if (!isNative()) return false;
    let perm = await LN().checkPermissions();
    if (perm.display !== 'granted') perm = await LN().requestPermissions();
    return perm.display === 'granted';
  }

  async function apply() {
    if (!isNative()) return { skipped: true };
    const R = window.PagaRepo;
    const perm = await LN().checkPermissions();
    const pend = await LN().getPending();
    if (pend.notifications.length) await LN().cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
    if (perm.display !== 'granted') return { granted: false, scheduled: 0 };
    if (!(await R.settings.get('remindersOn', true))) return { granted: true, scheduled: 0 };
    const hour = await R.settings.get('remindHour', 9);
    const list = plan(await R.payments.list(), { hour });
    try { await LN().createChannel({ id: CHANNEL, name: 'Pagamentos', description: 'Lembretes de pagamentos', importance: 4, visibility: 0 }); } catch (e) { /* já existe */ }
    if (list.length) {
      await LN().schedule({
        notifications: list.map(n => ({
          id: n.id, title: n.title, body: n.body, channelId: CHANNEL, smallIcon: 'ic_stat_pagacerto',
          schedule: { at: n.at, allowWhileIdle: true }, extra: { paymentId: n.paymentId }
        }))
      });
    }
    return { granted: true, scheduled: list.length };
  }

  function schedule() {
    if (!isNative()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { apply().catch(e => console.error('lembretes:', e)); }, 1500);
  }

  async function sendTest() {
    if (!(await requestPermission())) return false;
    try { await LN().createChannel({ id: CHANNEL, name: 'Pagamentos', description: 'Lembretes de pagamentos', importance: 4, visibility: 0 }); } catch (e) { /* já existe */ }
    await LN().schedule({ notifications: [{
      id: 2147483000, title: 'PagaCerto', body: 'Assim vão aparecer os seus lembretes.', channelId: CHANNEL,
      smallIcon: 'ic_stat_pagacerto', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }
    }] });
    return true;
  }

  // Tocar numa notificação abre o pagamento.
  function start() {
    if (!isNative() || wired) return;
    wired = true;
    LN().addListener('localNotificationActionPerformed', ev => {
      const id = ev && ev.notification && ev.notification.extra && ev.notification.extra.paymentId;
      if (id) location.hash = '#/p/' + id;
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
    schedule();
  }

  return { plan, notifId, isNative, status, requestPermission, apply, schedule, sendTest, start };
}));
