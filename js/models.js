/* PagaCerto — modelos e lógica de datas/estados (sem DOM, testável em Node).
 * Datas guardam-se sempre como texto AAAA-MM-DD em hora local (evita erros de fuso).
 * Valores guardam-se em cêntimos (inteiros).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagaModels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  const CATEGORIES = [
    'Casa', 'Eletricidade', 'Água', 'Gás', 'Telecomunicações', 'Impostos', 'Segurança Social',
    'Seguros', 'Financiamentos', 'Empréstimos', 'Rendas', 'Subscrições', 'Compras', 'Outros'
  ];

  const FREQUENCY_MONTHS = { monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12 };
  const REMIND_OPTIONS = [0, 1, 3, 5, 7]; // dias antes do vencimento

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function todayISO(now) {
    const d = now || new Date();
    return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // ISO completo (UTC) -> AAAA-MM-DD em hora local
  function localDateOf(isoTimestamp) {
    return todayISO(new Date(isoTimestamp));
  }

  function parts(iso) { return iso.split('-').map(Number); }

  function addDays(iso, n) {
    const [y, m, d] = parts(iso);
    const dt = new Date(y, m - 1, d + n);
    return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  // Soma meses mantendo o dia; se o mês não tiver esse dia usa o último (31 jan +1m = 28 fev).
  function addMonths(iso, n) {
    const [y, m, d] = parts(iso);
    const total = (m - 1) + n;
    const ny = y + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12;
    const last = new Date(ny, nm + 1, 0).getDate();
    return fmt(ny, nm + 1, Math.min(d, last));
  }

  function diffDays(aISO, bISO) {
    const [ay, am, ad] = parts(aISO), [by, bm, bd] = parts(bISO);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
  }

  // Estado efetivo: "overdue" calcula-se, nunca se guarda.
  function effectiveStatus(p, today) {
    if (p.status === 'paid') return 'paid';
    return p.dueDate < (today || todayISO()) ? 'overdue' : 'pending';
  }

  const STATUS_LABEL = { pending: 'Pendente', paid: 'Pago', overdue: 'Em atraso' };

  function formatEUR(cents) {
    const v = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v);
    } catch (e) {
      return v.toFixed(2).replace('.', ',') + ' €';
    }
  }

  function centsToInput(cents) {
    return cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = parts(iso);
    return `${pad(d)}/${pad(m)}/${y}`;
  }

  const MONTH_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  function formatDayLabel(iso, today) {
    const diff = diffDays(iso, today || todayISO());
    if (diff === 0) return 'HOJE';
    if (diff === 1) return 'AMANHÃ';
    const [, m, d] = parts(iso);
    return `${d} ${MONTH_SHORT[m - 1]}`;
  }

  function installmentLabel(p) {
    return p.installmentNo && p.installmentTotal ? `Prestação ${p.installmentNo}/${p.installmentTotal}` : '';
  }

  // Plano de prestações: cada prestação é um pagamento individual (referência editável).
  function generateInstallments(plan) {
    const every = plan.everyMonths || 1;
    const planId = plan.planId || newId();
    const out = [];
    for (let i = 0; i < plan.count; i++) {
      out.push({
        id: newId(),
        planId,
        issuer: plan.issuer,
        amountCents: plan.amountCents,
        dueDate: addMonths(plan.firstDate, i * every),
        category: plan.category || '',
        entity: plan.entity || '',
        reference: '',
        iban: plan.iban || '',
        invoiceNumber: '',
        description: plan.description || '',
        notes: '',
        installmentNo: i + 1,
        installmentTotal: plan.count,
        remindDays: plan.remindDays || [1],
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    }
    return out;
  }

  // Datas de um pagamento recorrente (a primeira inclusa).
  function recurringDates(firstDate, frequency, count, customMonths) {
    const step = frequency === 'custom' ? (customMonths || 1) : FREQUENCY_MONTHS[frequency];
    if (!step) throw new Error('Periodicidade desconhecida: ' + frequency);
    return Array.from({ length: count }, (_, i) => addMonths(firstDate, i * step));
  }

  function emptyPayment() {
    return {
      id: newId(), issuer: '', amountCents: null, dueDate: '', entity: '', reference: '', iban: '',
      invoiceNumber: '', description: '', category: '', notes: '', installmentNo: null,
      installmentTotal: null, remindDays: [1, 0], status: 'pending', createdAt: new Date().toISOString()
    };
  }

  // Limite do plano gratuito (preparado para a versão premium; ainda não aplicado).
  const FREE_LIMIT_ACTIVE_PAYMENTS = 20;
  // Conta planos, não prestações: um financiamento de 48 prestações conta como 1.
  function activeCount(payments) {
    const seen = new Set();
    for (const p of payments) {
      if (p.status === 'paid') continue;
      seen.add(p.planId || p.id);
    }
    return seen.size;
  }

  return {
    CATEGORIES, FREQUENCY_MONTHS, REMIND_OPTIONS, STATUS_LABEL, FREE_LIMIT_ACTIVE_PAYMENTS,
    newId, todayISO, localDateOf, addDays, addMonths, diffDays, effectiveStatus,
    formatEUR, centsToInput, formatDate, formatDayLabel, installmentLabel,
    generateInstallments, recurringDates, emptyPayment, activeCount
  };
}));
