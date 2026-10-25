/* PagaCerto — modelos e lógica de datas/estados (sem DOM, testável em Node).
 * Datas guardam-se sempre como texto AAAA-MM-DD em hora local (evita erros de fuso).
 * Valores guardam-se em cêntimos (inteiros).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagaModels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = typeof self !== 'undefined' ? self : globalThis;
  const tr = (k, p) => (G.PagaI18n ? G.PagaI18n.t(k, p) : k);   // textos visíveis passam por aqui (PT é a chave)
  const loc = () => (G.PagaI18n ? G.PagaI18n.locale() : 'pt-PT');
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
      return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'EUR' }).format(v);
    } catch (e) {
      return (loc() === 'pt-PT' ? v.toFixed(2).replace('.', ',') : v.toFixed(2)) + ' €';
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
    if (diff === 0) return tr('HOJE');
    if (diff === 1) return tr('AMANHÃ');
    const [, m, d] = parts(iso);
    return `${d} ${tr(MONTH_SHORT[m - 1])}`;
  }

  function installmentLabel(p) {
    return p.installmentNo && p.installmentTotal ? `${tr('Prestação')} ${p.installmentNo}/${p.installmentTotal}` : '';
  }

  // Plano de prestações: cada prestação é um pagamento individual (referência editável).
  // A referência informada fica na 1.ª prestação; as outras ficam vazias para o utilizador preencher.
  function generateInstallments(plan) {
    const every = plan.everyMonths || 1;
    const planId = plan.planId || newId();
    const out = [];
    for (let i = 0; i < plan.count; i++) {
      out.push({
        id: newId(),
        planId,
        paymentType: plan.paymentType || 'mb',
        issuer: plan.issuer,
        amountCents: plan.amountCents,
        dueDate: addMonths(plan.firstDate, i * every),
        category: plan.category || '',
        entity: plan.entity || '',
        reference: i === 0 ? (plan.reference || '') : '',
        iban: plan.iban || '',
        invoiceNumber: '',
        description: plan.description || '',
        notes: plan.notes || '',
        installmentNo: i + 1,
        installmentTotal: plan.count,
        remindDays: plan.remindDays || [1],
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    }
    return out;
  }

  function stepMonths(frequency, customMonths) {
    const step = frequency === 'custom' ? (customMonths || 1) : FREQUENCY_MONTHS[frequency];
    if (!step) throw new Error(tr('Periodicidade desconhecida:') + ' ' + frequency);
    return step;
  }

  // Datas de um pagamento recorrente (a primeira inclusa).
  function recurringDates(firstDate, frequency, count, customMonths) {
    const step = stepMonths(frequency, customMonths);
    return Array.from({ length: count }, (_, i) => addMonths(firstDate, i * step));
  }

  // Pagamento recorrente: cria já as próximas "count" ocorrências. Cada uma guarda a data-âncora e o índice,
  // para as datas nunca derivarem (31 jan, 28 fev, 31 mar...).
  function generateRecurring(base, frequency, count, customMonths) {
    const step = stepMonths(frequency, customMonths);
    const recurrenceId = base.recurrenceId || newId();
    const anchor = base.dueDate;
    return Array.from({ length: count }, (_, i) => Object.assign({}, base, {
      id: i === 0 && base.id ? base.id : newId(),
      dueDate: addMonths(anchor, i * step),
      recurrenceId,
      recurrence: { frequency, customMonths: frequency === 'custom' ? step : null, anchor, index: i },
      reference: i === 0 ? base.reference : '',
      invoiceNumber: i === 0 ? base.invoiceNumber : '',
      status: 'pending',
      createdAt: new Date().toISOString()
    }));
  }

  // Quando uma ocorrência é paga, repõe-se o número de ocorrências por pagar (mantém-se sempre "target" à frente).
  function recurrenceTopUp(list, target) {
    const pending = list.filter(p => p.status !== 'paid').length;
    const need = target - pending;
    if (need <= 0 || !list.length) return [];
    const last = list.reduce((a, b) => (b.recurrence.index > a.recurrence.index ? b : a));
    const rec = last.recurrence;
    const step = stepMonths(rec.frequency, rec.customMonths);
    return Array.from({ length: need }, (_, k) => {
      const idx = rec.index + 1 + k;
      const np = Object.assign({}, last, {
        id: newId(),
        dueDate: addMonths(rec.anchor, step * idx),
        recurrence: Object.assign({}, rec, { index: idx }),
        reference: '', invoiceNumber: '', status: 'pending', createdAt: new Date().toISOString()
      });
      delete np.paidAt; delete np.paidMethod; delete np.sample;
      return np;
    });
  }

  // Pesquisa global: ignora acentos e maiúsculas; todos os termos têm de aparecer em algum campo.
  const fold = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ /g, ' ');
  function matches(p, query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const inst = installmentLabel(p);
    const hay = fold([
      p.issuer, p.description, p.category, p.notes, p.invoiceNumber, p.entity, p.reference, formatReference(p.reference),
      inst, inst.replace('/', ' de '), inst.replace('/', ' of '), 'Prestação ' + (p.installmentNo || ''), formatEUR(p.amountCents), centsToInput(p.amountCents), formatDate(p.dueDate)
    ].join(' | '));
    return terms.every(t => hay.includes(t));
  }

  // Totais (em cêntimos) por estado, para o histórico.
  function summarize(list, today) {
    const s = { count: list.length, total: 0, paid: 0, pending: 0, overdue: 0 };
    for (const p of list) {
      const c = p.amountCents || 0;
      s.total += c;
      s[effectiveStatus(p, today)] += c;
    }
    return s;
  }

  // ---------- dados do painel (dashboard) ----------
  // Por mês de vencimento. Em atraso = por pagar com data anterior a hoje; por pagar = o resto do que não está pago.
  function monthSummary(list, ym, today) {
    const s = { ym, count: 0, total: 0, paid: 0, pending: 0, overdue: 0 };
    for (const p of list) {
      if (!p.dueDate || p.dueDate.slice(0, 7) !== ym) continue;
      const c = p.amountCents || 0;
      s.count++; s.total += c;
      s[effectiveStatus(p, today)] += c;
    }
    return s;
  }

  // Total por pagar em cada um dos "days" dias a partir de "fromISO" (inclui em atraso só no próprio dia).
  function dailyTotals(list, fromISO, days) {
    const out = Array.from({ length: days }, (_, i) => ({ date: addDays(fromISO, i), cents: 0, count: 0 }));
    const idx = {};
    out.forEach((d, i) => { idx[d.date] = i; });
    for (const p of list) {
      if (p.status === 'paid' || !(p.dueDate in idx)) continue;
      const d = out[idx[p.dueDate]];
      d.cents += p.amountCents || 0; d.count++;
    }
    return out;
  }

  // Totais por categoria num mês (todos os estados), do maior para o menor.
  function categoryTotals(list, ym) {
    const m = {};
    for (const p of list) {
      if (!p.dueDate || p.dueDate.slice(0, 7) !== ym) continue;
      const k = p.category || 'Outros';
      m[k] = (m[k] || 0) + (p.amountCents || 0);
    }
    return Object.keys(m).map(category => ({ category, cents: m[category] })).sort((a, b) => b.cents - a.cents);
  }

  // Últimos "n" meses até "endYm" (inclusive): total e parte já paga.
  function monthlyTotals(list, endYm, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push({ ym: addMonths(endYm + '-01', -i).slice(0, 7), total: 0, paid: 0 });
    const idx = {};
    out.forEach((m, i) => { idx[m.ym] = i; });
    for (const p of list) {
      const k = p.dueDate && p.dueDate.slice(0, 7);
      if (!(k in idx)) continue;
      const c = p.amountCents || 0;
      out[idx[k]].total += c;
      if (p.status === 'paid') out[idx[k]].paid += c;
    }
    return out;
  }

  // Células do calendário de um mês (AAAA-MM), a semana começa à segunda-feira.
  function calendarCells(ym) {
    const [y, m] = ym.split('-').map(Number);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const cells = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) cells.push(fmt(y, m, d));
    return cells;
  }

  // Tipo de pagamento: 'mb' (entidade + referência), 'state' (só referência de 15 dígitos, ao Estado),
  // 'other' (transferência, MB Way, etc.). Pagamentos antigos sem tipo são deduzidos.
  function paymentTypeOf(p) {
    if (p.paymentType) return p.paymentType;
    if (p.entity) return 'mb';
    if (p.reference && p.reference.length === 15) return 'state';
    return p.reference ? 'mb' : 'other';
  }

  function formatReference(ref) {
    return String(ref || '').replace(/\s/g, '').replace(/(\d{3})(?=\d)/g, '$1 ');
  }

  // Ligação que abre o Google Calendar com o evento (dia inteiro) já preenchido. Sem login nem API.
  function googleCalendarUrl(p) {
    const ymd = iso => iso.replace(/-/g, '');
    const inst = installmentLabel(p);
    const title = `${tr('Pagar')} ${p.issuer || tr('pagamento')}${inst ? ' (' + inst.toLowerCase() + ')' : ''} · ${formatEUR(p.amountCents)}`;
    const lines = [`${tr('Valor')}: ${formatEUR(p.amountCents)}`];
    if (p.entity) lines.push(`${tr('Entidade')}: ${p.entity}`);
    if (p.reference) lines.push(`${tr('Referência')}: ${formatReference(p.reference)}`);
    if (p.iban) lines.push(`IBAN: ${p.iban}`);
    if (p.invoiceNumber) lines.push(`${tr('Fatura')}: ${p.invoiceNumber}`);
    if (p.description) lines.push(p.description);
    if (p.notes) lines.push(p.notes);
    const q = new URLSearchParams({
      action: 'TEMPLATE', text: title,
      dates: `${ymd(p.dueDate)}/${ymd(addDays(p.dueDate, 1))}`,
      details: lines.join('\n') + '\n\n(PagaCerto)'
    });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  function emptyPayment() {
    return {
      id: newId(), paymentType: 'mb', issuer: '', amountCents: null, dueDate: '', entity: '', reference: '', iban: '',
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
    generateInstallments, recurringDates, generateRecurring, recurrenceTopUp, matches, summarize, calendarCells,
    monthSummary, dailyTotals, categoryTotals, monthlyTotals,
    emptyPayment, googleCalendarUrl, activeCount, paymentTypeOf, formatReference
  };
}));
