/* PagaCerto — anúncios (só na app Android, versão gratuita). O trabalho pesado é nativo (AdMob + consentimento UMP);
 * aqui só se conta quantos pagamentos foram guardados e se pede o anúncio de ecrã inteiro a cada N.
 * O interruptor "premium" (futura subscrição) desliga todos os anúncios.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.PagaAds = factory(root);
}(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';
  const EVERY = 5;

  // Lógica pura: conta guardados e diz quando mostrar.
  function tick(count, every) {
    const n = (count || 0) + 1;
    const e = every || EVERY;
    return n >= e ? { count: 0, show: true } : { count: n, show: false };
  }

  const cap = () => (win && win.Capacitor ? win.Capacitor : null);
  const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  const plugin = () => (isNative() && cap().Plugins && cap().Plugins.PagaShare) || null;

  async function sync() {
    const p = plugin();
    if (!p || !p.setAdsEnabled) return;
    const premium = await win.PagaRepo.settings.get('premium', false);
    await p.setAdsEnabled({ enabled: !premium });
  }

  // Chamar depois de guardar um pagamento NOVO (não em edições, nem importações, nem "marcar como pago").
  async function onSaved() {
    const p = plugin();
    if (!p || !p.showInterstitial) return false;
    if (await win.PagaRepo.settings.get('premium', false)) return false;
    const r = tick(await win.PagaRepo.settings.get('adsSaves', 0), EVERY);
    await win.PagaRepo.settings.set('adsSaves', r.count);
    if (!r.show) return false;
    setTimeout(() => { p.showInterstitial().catch(() => {}); }, 600);
    return true;
  }

  async function state() {
    const p = plugin();
    if (!p || !p.adsState) return { available: false };
    try { return await p.adsState(); } catch (e) { return { available: false }; }
  }

  async function privacyOptions() {
    const p = plugin();
    if (p && p.showPrivacyOptions) await p.showPrivacyOptions();
  }

  return { EVERY, tick, isNative, sync, onSaved, state, privacyOptions };
}));
