/* PagaCerto — interface. Sem frameworks: rotas por hash, HTML em template strings.
 * Todo o texto do utilizador passa por esc() antes de entrar em innerHTML.
 */
(function () {
  'use strict';
  const P = window.PagaParser, M = window.PagaModels, R = window.PagaRepo, S = window.PagaSync, N = window.PagaNotify, Pdf = window.PagaPdf;
  const $app = document.getElementById('app');
  const I = window.PagaI18n;
  const t = (k, p) => I.t(k, p);
  document.documentElement.lang = I.lang() === 'en' ? 'en' : 'pt-PT';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- estado da interface ----------
  let draft = null;              // rascunho vindo de "colar texto" / partilha: { payment, confidence, warnings }
  let listFilter = 'open';       // Pagamentos: open | paid | all
  let payQ = '';                 // Pagamentos: pesquisa
  let payList = [];              // Pagamentos: última lista carregada (a pesquisa filtra sem recarregar)
  let calMonth = null;           // Calendário: AAAA-MM (null = mês atual)
  let calDay = null;             // Calendário: dia selecionado
  const hist = { status: 'all', month: '', issuer: '', category: '', q: '' };
  let histList = [];
  let accMsg = null;             // Conta: { type: 'error'|'ok', text }
  let accEmail = '';             // Conta: email escrito (não se perde ao re-renderizar)
  let remMsg = null;             // Lembretes: { type, text }
  let recovering = false;        // Conta: veio de um link de recuperação de palavra-passe

  const RECUR_TARGET = 12;       // ocorrências por pagar que se mantêm criadas num pagamento recorrente
  const REMIND_LABEL = { 0: t('No próprio dia'), 1: t('1 dia antes'), 3: t('3 dias antes'), 5: t('5 dias antes'), 7: t('7 dias antes') };
  const TYPE_LABEL = { mb: t('Multibanco (entidade e referência)'), state: t('Pagamento ao Estado (só referência)'), other: t('Transferência ou outro') };
  const FREQ_LABEL = { monthly: t('Mensal'), bimonthly: t('Bimestral'), quarterly: t('Trimestral'), semiannual: t('Semestral'), annual: t('Anual'), custom: t('Personalizado') };
  const EVERY_LABEL = { 1: t('Mensal'), 2: t('Bimestral'), 3: t('Trimestral'), 6: t('Semestral'), 12: t('Anual') };
  const STATE_HOWTO = t('No Multibanco: Pagamentos e outros serviços → Estado e sector público → Pagamentos ao Estado. Introduza a referência e confirme o montante.');

  // O browser só oferece "instalar" quando considera a página instalável; guardamos o pedido.
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    if (location.hash === '#/settings') render();
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; });

  // ---------- ponto de entrada para partilha (Android/PWA chamam isto) ----------
  async function handleSharedText(text, subject) {
    const entities = await R.entities.map();
    const res = P.parseInvoiceText(text, { subject: subject || '', knownEntities: entities });
    const f = res.fields;
    const p = M.emptyPayment();
    Object.assign(p, {
      paymentType: f.paymentType || 'mb',
      issuer: f.issuer, amountCents: f.amountCents, dueDate: f.dueDate, entity: f.entity,
      reference: f.reference, iban: f.iban, invoiceNumber: f.invoiceNumber, category: f.category,
      installmentNo: f.installmentNo, installmentTotal: f.installmentTotal,
      description: f.description || subject || ''
    });
    draft = { payment: p, confidence: res.confidence, warnings: res.warnings, fromParse: true };
    if (location.hash === '#/new') render(); else location.hash = '#/new';
  }

  // ---------- importar PDF ----------
  const askPdfPassword = wrong => prompt(wrong ? t('Palavra-passe incorreta. Tente outra vez:') : t('Este PDF tem palavra-passe. Introduza-a para o ler:'));

  async function importPdfBytes(bytes, name) {
    const status = document.getElementById('pdf-status');
    if (status) status.textContent = t('A ler o PDF…');
    let warning = null;
    try {
      const text = await Pdf.extractText(bytes, askPdfPassword);
      if (text) { await handleSharedText(text, String(name || '').replace(/\.pdf$/i, '')); return; }
      warning = t('Este PDF não tem texto (parece uma imagem digitalizada). Por agora escreva os dados à mão. A leitura de fotografias chega numa próxima versão.');
    } catch (e) {
      warning = e && e.message ? t(e.message) : t('Não foi possível ler o PDF.');
    }
    draft = { payment: M.emptyPayment(), confidence: {}, warnings: [warning], fromParse: false };
    if (location.hash === '#/new') render(); else location.hash = '#/new';
  }

  function b64ToBytes(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  document.addEventListener('change', e => {
    if (!e.target || e.target.id !== 'f-pdf') return;
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return showFormError(t('O PDF é demasiado grande (máximo 15 MB).'));
    f.arrayBuffer().then(buf => importPdfBytes(buf, f.name)).catch(showFatal);
  });

  // Android: o texto partilhado fica guardado no código nativo até a parte web o pedir.
  async function checkNativeShare() {
    const cap = window.Capacitor;
    if (!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.PagaShare)) return false;
    const r = await cap.Plugins.PagaShare.take();
    if (r && (r.pdf || r.pdfError)) {
      await R.settings.set('onboarded', true);
      if (r.pdfError) { draft = { payment: M.emptyPayment(), confidence: {}, warnings: [r.pdfError], fromParse: false }; if (location.hash === '#/new') render(); else location.hash = '#/new'; }
      else await importPdfBytes(b64ToBytes(r.pdf), r.name || '');
      return true;
    }
    if (r && r.text) {
      await R.settings.set('onboarded', true);
      await handleSharedText(r.text, r.subject || '');
      return true;
    }
    return false;
  }
  window.PagaApp = { handleSharedText, checkNativeShare };

  // ---------- peças de UI ----------
  function layout(active, inner, opts) {
    opts = opts || {};
    const nav = [
      ['#/', t('Início'), '🏠', 'home'], ['#/calendar', t('Calendário'), '📅', 'calendar'],
      ['#/payments', t('Pagamentos'), '💳', 'payments'], ['#/history', t('Histórico'), '📊', 'history'],
      ['#/settings', t('Definições'), '⚙️', 'settings']
    ].map(([href, label, ic, key]) =>
      `<a href="${href}" class="${key === active ? 'active' : ''}"><span class="ic">${ic}</span>${label}</a>`).join('');
    return `<main>${inner}</main>${opts.noFab ? '' : `<a class="fab" href="#/new" aria-label="${t('Novo pagamento')}">+</a>`}<nav class="bottom">${nav}</nav>`;
  }

  function dotFor(p, today) {
    const st = M.effectiveStatus(p, today);
    return st === 'pending' && p.recurrenceId ? 'recurring' : st;
  }

  function paymentItem(p, today) {
    const inst = M.installmentLabel(p);
    return `<a class="item card" href="#/p/${esc(p.id)}"><div class="row">
      <span class="dot ${dotFor(p, today)}"></span>
      <div class="grow"><div class="title">${esc(p.issuer || t('Sem nome'))}</div>
        <div class="sub">${inst ? esc(inst) + ' · ' : ''}${M.formatDate(p.dueDate)}</div></div>
      <div class="amount">${M.formatEUR(p.amountCents)}</div></div></a>`;
  }

  const plural = (n, one, many) => t(n === 1 ? one : many);
  const monthLabel = ym => {
    const s = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString(I.locale(), { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // ---------- painel da página inicial (SVG/CSS simples, sem bibliotecas) ----------
  const eurShort = cents => {
    const n = Math.round((cents || 0) / 100);
    const s = n >= 10000 ? Math.round(n / 1000) + 'k' : String(n);
    return I.lang() === 'en' ? '€' + s : s + ' €';
  };
  const CAT_COLORS = ['#2f6fdb', '#1f9d55', '#e8890c', '#8a5cd6', '#14a3b8', '#d64545'];

  function donutSvg(s) {
    const R = 38, C = 2 * Math.PI * R;
    const parts = [['var(--green)', s.paid], ['var(--blue)', s.pending], ['var(--red)', s.overdue]];
    let off = 0, arcs = '';
    if (s.total > 0) {
      for (const [col, v] of parts) {
        if (v <= 0) continue;
        const len = (v / s.total) * C;
        arcs += `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${col}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
        off += len;
      }
    }
    return `<svg viewBox="0 0 100 100" class="donut" aria-hidden="true"><circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--line)" stroke-width="14"/>${arcs}</svg>`;
  }

  function summaryCol(s) {
    return `<div class="sumcol">
      <div class="sumhead">${esc(monthLabel(s.ym))}</div>
      <div class="donutbox">${donutSvg(s)}<div class="donutc">${eurShort(s.total)}</div></div>
      <div class="sumrow"><i class="dot paid"></i><span>${t('Pago')}</span><b>${M.formatEUR(s.paid)}</b></div>
      <div class="sumrow"><i class="dot blue"></i><span>${t('Por pagar')}</span><b>${M.formatEUR(s.pending)}</b></div>
      <div class="sumrow"><i class="dot overdue"></i><span>${t('Em atraso')}</span><b class="${s.overdue ? 'red' : ''}">${M.formatEUR(s.overdue)}</b></div>
    </div>`;
  }

  function dashboardHtml(list, today) {
    const ym = today.slice(0, 7), prevYm = M.addMonths(today, -1).slice(0, 7);
    const cur = M.monthSummary(list, ym, today), prev = M.monthSummary(list, prevYm, today);

    const days = M.dailyTotals(list, today, 7);
    const maxD = Math.max.apply(null, days.map(d => d.cents).concat([1]));
    const dayBars = days.map(d => `<div class="bcol"><div class="bval">${d.cents ? eurShort(d.cents) : ''}</div>
      <div class="btrack"><div class="bar ${d.cents ? '' : 'zero'}" style="height:${d.cents ? Math.max(6, Math.round(d.cents / maxD * 100)) : 2}%"></div></div>
      <div class="blab">${d.date.slice(8)}/${d.date.slice(5, 7)}</div></div>`).join('');

    const cats = M.categoryTotals(list, ym).slice(0, 5);
    const maxC = cats.length ? cats[0].cents : 1;
    const catRows = cats.length ? cats.map((c, i) => `<div class="hrow"><div class="hlab">${esc(t(c.category))}</div>
      <div class="htrack"><div class="hbar" style="width:${Math.max(3, Math.round(c.cents / maxC * 100))}%;background:${CAT_COLORS[i % CAT_COLORS.length]}"></div></div>
      <div class="hval">${M.formatEUR(c.cents)}</div></div>`).join('') : `<div class="muted">${t('Sem pagamentos para mostrar.')}</div>`;

    const months = M.monthlyTotals(list, ym, 6);
    const maxM = Math.max.apply(null, months.map(m => m.total).concat([1]));
    const monthBars = months.map(m => {
      const h = m.total ? Math.max(6, Math.round(m.total / maxM * 100)) : 2;
      const paidPct = m.total ? Math.round(m.paid / m.total * 100) : 0;
      const lab = new Date(+m.ym.slice(0, 4), +m.ym.slice(5, 7) - 1, 1).toLocaleDateString(I.locale(), { month: 'short' }).replace('.', '');
      return `<div class="bcol"><div class="bval">${m.total ? eurShort(m.total) : ''}</div>
        <div class="btrack"><div class="bar stack ${m.total ? '' : 'zero'}" style="height:${h}%"><div class="barpaid" style="height:${paidPct}%"></div></div></div>
        <div class="blab">${esc(lab)}</div></div>`;
    }).join('');

    return `<div class="card dash"><div class="dtitle">${t('Resumo')}</div><div class="sumgrid">${summaryCol(cur)}${summaryCol(prev)}</div></div>
      <div class="card dash"><div class="dtitle">${t('Próximos 7 dias')}</div><div class="bars">${dayBars}</div></div>
      <div class="card dash"><div class="dtitle">${t('Por categoria este mês')}</div>${catRows}</div>
      <div class="card dash"><div class="dtitle">${t('Últimos 6 meses')}</div><div class="bars">${monthBars}</div>
        <div class="legend2"><span><i class="dot paid"></i> ${t('Pago')}</span><span><i class="dot blue"></i> ${t('Por pagar')}</span></div></div>`;
  }

  // ---------- vistas ----------
  function viewOnboarding() {
    $app.innerHTML = `<div class="onboard">
      <h1>${t('Não volte a esquecer um pagamento.')}</h1>
      <div class="step"><b>1</b><span>${t('Receba a fatura')}</span></div>
      <div class="step"><b>2</b><span>${t('Partilhe com o PagaCerto')}</span></div>
      <div class="step"><b>3</b><span>${t('Nós ajudamos a criar o lembrete')}</span></div>
      <p class="muted" style="margin-top:12px">${t('Os seus dados ficam só neste telemóvel. Não pedimos acesso ao seu email nem ao seu banco.')}</p>
      <button class="btn" data-action="start">${t('COMEÇAR')}</button></div>`;
  }

  async function viewHome() {
    const list = await R.payments.list();
    const today = M.todayISO();
    const month = today.slice(0, 7);
    const hour = new Date().getHours();
    const greeting = t(hour < 12 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite');

    const open = list.filter(p => p.status !== 'paid');
    const overdue = open.filter(p => M.effectiveStatus(p, today) === 'overdue');
    const toPay = open.filter(p => p.dueDate.slice(0, 7) === month).reduce((s, p) => s + (p.amountCents || 0), 0);
    const paid = list.filter(p => p.status === 'paid' && p.paidAt && M.localDateOf(p.paidAt).slice(0, 7) === month)
      .reduce((s, p) => s + (p.amountCents || 0), 0);
    const overdueTotal = overdue.reduce((s, p) => s + (p.amountCents || 0), 0);
    const next7 = open.filter(p => { const d = M.diffDays(p.dueDate, today); return d >= 0 && d <= 7; });

    let alerts = '';
    if (overdue.length) alerts += `<div class="alert red">🔴 ${t(overdue.length === 1 ? 'Tem {n} pagamento em atraso: {names}.' : 'Tem {n} pagamentos em atraso: {names}.', { n: overdue.length, names: esc(overdue.slice(0, 3).map(p => p.issuer || t('Sem nome')).join(', ')) + (overdue.length > 3 ? '…' : '') })}</div>`;
    if (next7.length) alerts += `<div class="alert">⚠️ ${t('Pagamentos próximos')}<br><span style="font-weight:400">${t(next7.length === 1 ? 'Tem {n} pagamento nos próximos 7 dias.' : 'Tem {n} pagamentos nos próximos 7 dias.', { n: next7.length })}</span></div>`;

    const upcoming = open.filter(p => M.diffDays(p.dueDate, today) <= 30);
    const shown = upcoming.slice(0, 10);
    let listHtml = '', lastLabel = null;
    for (const p of shown) {
      const isOver = M.effectiveStatus(p, today) === 'overdue';
      const label = isOver ? t('EM ATRASO') : M.formatDayLabel(p.dueDate, today);
      if (label !== lastLabel) { listHtml += `<div class="daylabel ${isOver ? 'red' : ''}">${esc(label)}</div>`; lastLabel = label; }
      listHtml += paymentItem(p, today);
    }
    if (!shown.length) listHtml = `<div class="empty">${t('Sem pagamentos por pagar nos próximos 30 dias.')}<br>${t('Toque em <b>+</b> para adicionar o primeiro.')}</div>`;
    if (upcoming.length > shown.length) listHtml += `<a class="btn secondary small" href="#/payments">${t('Ver todos')}</a>`;

    $app.innerHTML = layout('home', `
      <h1>${greeting}</h1><p class="muted">${t('O que tem para pagar')}</p>
      ${alerts}
      ${dashboardHtml(list, today)}
      <h2>${t('Próximos pagamentos')}</h2>${listHtml}`);
  }

  // ----- Pagamentos (com pesquisa global) -----
  function paymentsBody() {
    const today = M.todayISO();
    const q = payQ.trim();
    let rows, note = '';
    if (q) {
      // A pesquisa procura em TODOS os pagamentos, ignorando o filtro por estado.
      rows = payList.filter(p => M.matches(p, q));
      note = `<p class="muted">${t(rows.length === 1 ? '{n} resultado em todos os pagamentos' : '{n} resultados em todos os pagamentos', { n: rows.length })}</p>`;
    } else {
      rows = payList.filter(p => listFilter === 'all' ? true : listFilter === 'paid' ? p.status === 'paid' : p.status !== 'paid');
      if (listFilter === 'paid') rows = rows.slice().reverse();
    }
    return note + (rows.length ? rows.map(p => paymentItem(p, today)).join('') : `<div class="empty">${t('Nada por aqui.')}</div>`);
  }

  async function viewPayments() {
    payList = await R.payments.list();
    const chip = (key, label) => `<button class="chip ${listFilter === key ? 'active' : ''}" data-action="filter" data-arg="${key}">${label}</button>`;
    $app.innerHTML = layout('payments', `
      <h1>${t('Pagamentos')}</h1>
      <input type="search" data-bind="pay-q" placeholder="${esc(t('Pesquisar: Vodafone, 120, Prestação 3…'))}" value="${esc(payQ)}" style="margin-top:12px">
      <div class="chips" style="margin:12px 0">${chip('open', t('Por pagar'))}${chip('paid', t('Pagos'))}${chip('all', t('Todos'))}</div>
      <div id="pay-body">${paymentsBody()}</div>`);
  }

  // ----- Detalhe -----
  async function viewDetail(id) {
    const p = await R.payments.get(id);
    if (!p) { location.hash = '#/payments'; return; }
    const today = M.todayISO();
    const st = M.effectiveStatus(p, today);
    const row = (label, val) => val ? `<dt>${label}</dt><dd>${esc(val)}</dd>` : '';
    const paidInfo = p.paidAt ? new Date(p.paidAt).toLocaleString(I.locale(), { dateStyle: 'short', timeStyle: 'short' }) : '';
    const type = M.paymentTypeOf(p);

    // Outras prestações / ocorrências do mesmo grupo
    let groupHtml = '';
    const gid = p.planId || p.recurrenceId;
    if (gid) {
      const all = await R.payments.list();
      const group = all.filter(x => (p.planId ? x.planId === gid : x.recurrenceId === gid));
      const title = p.planId ? t('Plano de prestações') : `${t('Repetição')} ${p.recurrence ? '(' + (FREQ_LABEL[p.recurrence.frequency] || '').toLowerCase() + ')' : ''}`;
      groupHtml = `<h2>${esc(title)}</h2>` + group.map(x => `
        <a class="item card ${x.id === p.id ? 'current' : ''}" href="#/p/${esc(x.id)}"><div class="row">
          <span class="dot ${dotFor(x, today)}"></span>
          <div class="grow"><div class="title">${esc(M.installmentLabel(x) || M.formatDate(x.dueDate))}</div>
            <div class="sub">${M.formatDate(x.dueDate)}${x.reference ? ' · ' + t('ref.') + ' ' + esc(M.formatReference(x.reference)) : ''}</div></div>
          <div class="amount">${M.formatEUR(x.amountCents)}</div></div></a>`).join('');
    }

    $app.innerHTML = layout('payments', `
      <a href="#/payments" class="muted">← ${t('Pagamentos')}</a>
      <div class="card" style="margin-top:12px">
        <div class="row"><h1 class="grow" style="margin:0">${esc(p.issuer || t('Sem nome'))}</h1><span class="badge ${st}">${t(M.STATUS_LABEL[st])}</span></div>
        <div class="amount" style="font-size:28px;margin:6px 0 0">${M.formatEUR(p.amountCents)}</div>
        <dl class="detail" style="margin:0">
          ${row(t('Vencimento'), M.formatDate(p.dueDate))}
          ${row(t('Tipo'), TYPE_LABEL[type])}
          ${row(t('Prestação'), M.installmentLabel(p))}
          ${type === 'mb' ? row(t('Entidade'), p.entity) : ''}
          ${row(t('Referência'), M.formatReference(p.reference))}
          ${row('IBAN', p.iban)}
          ${row(t('Número da fatura'), p.invoiceNumber)}
          ${row(t('Categoria'), p.category && t(p.category))}
          ${row(t('Descrição'), p.description)}
          ${row(t('Notas'), p.notes)}
          ${row(t('Pago em'), paidInfo)}
          ${row(t('Lembretes'), (p.remindDays || []).length ? p.remindDays.map(d => REMIND_LABEL[d]).join(', ') : t('Sem lembretes'))}
        </dl></div>
      ${type === 'state' && p.status !== 'paid' ? `<div class="alert blue">${esc(STATE_HOWTO)}</div>` : ''}
      ${p.status === 'paid'
        ? `<button class="btn secondary" data-action="reopen" data-arg="${esc(p.id)}">${t('Reabrir (voltar a pendente)')}</button>`
        : `<button class="btn green" data-action="pay" data-arg="${esc(p.id)}">${t('Marcar como pago')}</button>`}
      <a class="btn secondary" href="${esc(M.googleCalendarUrl(p))}" target="_blank" rel="noopener">📅 ${t('Adicionar ao Google Calendar')}</a>
      <a class="btn secondary" href="#/edit/${esc(p.id)}">${t('Editar')}</a>
      <button class="btn danger" data-action="delete" data-arg="${esc(p.id)}">${t('Eliminar')}</button>
      ${groupHtml}`);
  }

  // ----- Formulário -----
  function fieldHtml(id, label, value, o) {
    o = o || {};
    let cls = '', hint = '';
    if (o.parsed) {
      if (!value) { cls = 'needs-check'; hint = t('Não encontrado. Preencha à mão.'); }
      else if (o.low) { cls = 'needs-check'; hint = t('Confirme este campo.'); }
    }
    return `<label for="${id}">${label}</label>
      <input id="${id}" type="${o.type || 'text'}" ${o.mode ? `inputmode="${o.mode}"` : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}
        value="${esc(value)}" class="${cls}" autocomplete="off">${hint ? `<div class="hint">${hint}</div>` : ''}`;
  }

  async function viewForm(existingId) {
    let p, conf = {}, warnings = [], parsed = false;
    if (existingId) {
      p = await R.payments.get(existingId);
      if (!p) { location.hash = '#/payments'; return; }
    } else if (draft) {
      ({ payment: p, confidence: conf, warnings } = draft);
      parsed = draft.fromParse !== false;
    } else {
      p = M.emptyPayment();
    }
    const cats = await R.categories.list();
    const low = k => conf[k] === 'low';
    const isInst = !!(p.installmentNo && p.installmentTotal);
    const ptype = M.paymentTypeOf(p);

    const paste = existingId ? '' : `
      <div class="card">
        <label for="f-paste" style="margin-top:0">${t('Colar texto da fatura')}</label>
        <textarea id="f-paste" placeholder="${esc(t('Cole aqui o texto do email ou da fatura. O PagaCerto tenta preencher os campos, e você confirma.'))}"></textarea>
        <button class="btn secondary small" data-action="parse">${t('Reconhecer dados')}</button>
        <label class="btn secondary small" for="f-pdf" style="cursor:pointer">📄 ${t('Importar PDF')}</label>
        <input id="f-pdf" type="file" accept="application/pdf,.pdf" style="display:none">
        <div id="pdf-status" class="hint" style="color:var(--muted)"></div>
      </div>`;

    const found = parsed ? `<div class="alert blue"><b>${t('PAGAMENTO ENCONTRADO')}</b><br>${t('Confira cada campo antes de guardar. Os campos a laranja precisam da sua confirmação.')}</div>` : '';
    const warn = warnings && warnings.length ? `<div class="alert">${warnings.map(w => esc(t(w))).join('<br>')}</div>` : '';

    // Repetição: só em pagamentos novos. Editar mexe apenas neste pagamento.
    const repetition = existingId ? '' : `
        <label for="f-rep">${t('Repetição')}</label>
        <select id="f-rep">
          <option value="once">${t('Só este pagamento')}</option>
          <option value="plan">${t('Plano de prestações (criar todas)')}</option>
          <option value="recurring">${t('Pagamento recorrente')}</option>
        </select>
        <div id="box-plan" style="display:none">
          <label for="f-plan-n">${t('Número de prestações')}</label>
          <input id="f-plan-n" type="number" min="2" max="120" inputmode="numeric" value="12">
          <label for="f-plan-every">${t('Periodicidade')}</label>
          <select id="f-plan-every">${Object.keys(EVERY_LABEL).map(k => `<option value="${k}">${EVERY_LABEL[k]}</option>`).join('')}</select>
          <div class="hint" style="color:var(--muted)">${t('O valor e a data acima são os da 1.ª prestação. Cada prestação fica individual, e pode editar a referência de cada uma.')}</div>
        </div>
        <div id="box-rec" style="display:none">
          <label for="f-rec-freq">${t('Repete-se')}</label>
          <select id="f-rec-freq">${Object.keys(FREQ_LABEL).map(k => `<option value="${k}">${FREQ_LABEL[k]}</option>`).join('')}</select>
          <div id="box-rec-custom" style="display:none">
            <label for="f-rec-custom">${t('De quantos em quantos meses')}</label>
            <input id="f-rec-custom" type="number" min="1" max="60" inputmode="numeric" value="1">
          </div>
          <div class="hint" style="color:var(--muted)">${t('Cria já as próximas {n} ocorrências e junta uma nova sempre que pagar uma.', { n: RECUR_TARGET })}</div>
        </div>`;

    $app.innerHTML = layout('payments', `
      <a href="#/${existingId ? 'p/' + esc(existingId) : ''}" class="muted" data-action="cancel">← ${t('Cancelar')}</a>
      <h1 style="margin-top:8px">${existingId ? t('Editar pagamento') : t('Novo pagamento')}</h1>
      ${paste}${found}${warn}
      <div id="form-error" role="alert"></div>
      <form id="pay-form" novalidate>
        ${fieldHtml('f-issuer', t('Nome / Emissor'), p.issuer, { parsed, low: low('issuer'), ph: t('Ex.: Vodafone') })}
        ${fieldHtml('f-amount', t('Valor (€)'), M.centsToInput(p.amountCents), { parsed, low: low('amountCents'), mode: 'decimal', ph: '0,00' })}
        ${fieldHtml('f-due', t('Data de vencimento'), p.dueDate, { parsed, low: low('dueDate'), type: 'date' })}
        <label for="f-type">${t('Tipo de pagamento')}</label>
        <select id="f-type">${Object.keys(TYPE_LABEL).map(k => `<option value="${k}" ${k === ptype ? 'selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select>
        <div id="type-hint" class="hint" style="color:var(--muted)"></div>
        <div id="box-entity">${fieldHtml('f-entity', t('Entidade (Multibanco, 5 dígitos)'), p.entity, { parsed: parsed && ptype === 'mb', low: low('entity'), mode: 'numeric' })}</div>
        ${fieldHtml('f-ref', t('Referência (Multibanco, 9 dígitos)'), M.formatReference(p.reference), { parsed, low: low('reference'), mode: 'numeric' })}
        ${fieldHtml('f-iban', t('IBAN (opcional)'), p.iban, { parsed: parsed && !!p.iban, low: low('iban') })}
        ${fieldHtml('f-inv', t('Número da fatura (opcional)'), p.invoiceNumber, { parsed: parsed && !!p.invoiceNumber, low: low('invoiceNumber') })}
        ${fieldHtml('f-desc', t('Descrição (opcional)'), p.description)}
        <label for="f-cat">${t('Categoria')}</label>
        <select id="f-cat"><option value="">—</option>${cats.map(c => `<option value="${esc(c)}" ${c === p.category ? 'selected' : ''}>${esc(t(c))}</option>`).join('')}</select>
        <label for="f-notes">${t('Notas (opcional)')}</label>
        <textarea id="f-notes" style="min-height:64px">${esc(p.notes)}</textarea>

        ${repetition}
        <div id="box-once">
          <label class="check"><input type="checkbox" id="f-inst" ${isInst ? 'checked' : ''}> ${t('Este pagamento é uma prestação')}</label>
          <div id="inst-box" class="inline" style="${isInst ? '' : 'display:none'}">
            <input id="f-inst-no" type="number" min="1" inputmode="numeric" placeholder="3" value="${p.installmentNo || ''}">
            <span>${t('de')}</span>
            <input id="f-inst-total" type="number" min="1" inputmode="numeric" placeholder="12" value="${p.installmentTotal || ''}">
          </div>
        </div>

        <label class="check"><input type="checkbox" id="f-remind" ${(p.remindDays || []).length ? 'checked' : ''}> ${t('Criar lembrete')}</label>
        <div class="chips">${M.REMIND_OPTIONS.map(d =>
          `<label class="chip"><input type="checkbox" class="f-rd" value="${d}" ${(p.remindDays || []).includes(d) ? 'checked' : ''}>${REMIND_LABEL[d]}</label>`).join('')}</div>
        <button type="submit" class="btn" style="margin-top:22px">${existingId ? t('GUARDAR') : t('ADICIONAR PAGAMENTO')}</button>
      </form>`, { noFab: true });

    const inst = document.getElementById('f-inst');
    inst.addEventListener('change', () => { document.getElementById('inst-box').style.display = inst.checked ? '' : 'none'; });

    // O tipo decide que campos aparecem: Multibanco = entidade + referência; Estado = só referência (15 dígitos).
    const typeSel = document.getElementById('f-type');
    const applyType = () => {
      const tp = typeSel.value;
      document.getElementById('box-entity').style.display = tp === 'mb' ? '' : 'none';
      document.querySelector('label[for="f-ref"]').textContent =
        tp === 'mb' ? t('Referência (Multibanco, 9 dígitos)') : tp === 'state' ? t('Referência para pagamento (15 dígitos)') : t('Referência (opcional)');
      document.getElementById('type-hint').textContent = tp === 'state' ? STATE_HOWTO : '';
    };
    typeSel.addEventListener('change', applyType);
    applyType();

    // Repetição: mostra só o bloco que interessa.
    const rep = document.getElementById('f-rep');
    if (rep) {
      const applyRep = () => {
        document.getElementById('box-plan').style.display = rep.value === 'plan' ? '' : 'none';
        document.getElementById('box-rec').style.display = rep.value === 'recurring' ? '' : 'none';
        document.getElementById('box-once').style.display = rep.value === 'once' ? '' : 'none';
      };
      rep.addEventListener('change', applyRep);
      const freq = document.getElementById('f-rec-freq');
      freq.addEventListener('change', () => { document.getElementById('box-rec-custom').style.display = freq.value === 'custom' ? '' : 'none'; });
      applyRep();
    }
    document.getElementById('pay-form').addEventListener('submit', e => { e.preventDefault(); savePayment(existingId ? p : null, p); });
  }

  function showFormError(msg) {
    const box = document.getElementById('form-error');
    box.innerHTML = `<div class="error">${esc(msg)}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function savePayment(existing, base) {
    const v = id => document.getElementById(id).value.trim();
    const cents = P.parseAmountToCents(v('f-amount'));
    const due = v('f-due');
    const type = v('f-type');
    const entity = type === 'mb' ? v('f-entity').replace(/\s/g, '') : '';
    const reference = v('f-ref').replace(/[\s.]/g, '');
    const iban = v('f-iban').replace(/\s/g, '').toUpperCase();
    const rep = existing ? 'once' : v('f-rep');
    const isInst = rep === 'once' && document.getElementById('f-inst').checked;
    const instNo = parseInt(v('f-inst-no'), 10), instTotal = parseInt(v('f-inst-total'), 10);
    const planN = parseInt(rep === 'plan' ? v('f-plan-n') : '0', 10);
    const recCustom = parseInt(rep === 'recurring' ? v('f-rec-custom') : '0', 10);
    const recFreq = rep === 'recurring' ? v('f-rec-freq') : '';

    if (!v('f-issuer')) return showFormError(t('Indique o nome de quem emite o pagamento.'));
    if (cents == null || cents <= 0) return showFormError(t('Indique um valor válido, por exemplo 87,43.'));
    if (!due) return showFormError(t('Indique a data de vencimento.'));
    if (type === 'mb' && entity && !/^\d{5}$/.test(entity)) return showFormError(t('A entidade Multibanco tem 5 dígitos.'));
    if (type === 'mb' && reference && !/^\d{9}$/.test(reference)) return showFormError(t('A referência Multibanco tem 9 dígitos.'));
    if (type === 'state' && !/^\d{15}$/.test(reference)) return showFormError(t('A referência de um pagamento ao Estado tem 15 dígitos. Confira o documento.'));
    if (type === 'other' && reference && !/^\d+$/.test(reference)) return showFormError(t('A referência só pode ter dígitos.'));
    if (iban && !P.ibanValid(iban)) return showFormError(t('O IBAN não é válido. Confirme cada dígito ou apague o campo.'));
    if (isInst && !(instNo >= 1 && instTotal >= instNo)) return showFormError(t('Indique a prestação, por exemplo 3 de 12.'));
    if (rep === 'plan' && !(planN >= 2 && planN <= 120)) return showFormError(t('O plano tem de ter entre 2 e 120 prestações.'));
    if (recFreq === 'custom' && !(recCustom >= 1 && recCustom <= 60)) return showFormError(t('Indique de quantos em quantos meses (1 a 60).'));

    const remind = document.getElementById('f-remind').checked
      ? Array.from(document.querySelectorAll('.f-rd:checked')).map(x => +x.value).sort((a, b) => b - a) : [];

    const out = Object.assign({}, base, {
      issuer: v('f-issuer'), paymentType: type, amountCents: cents, dueDate: due, entity, reference, iban,
      invoiceNumber: v('f-inv'), description: v('f-desc'), category: document.getElementById('f-cat').value,
      notes: v('f-notes'), installmentNo: isInst ? instNo : null, installmentTotal: isInst ? instTotal : null,
      remindDays: remind, status: existing ? existing.status : 'pending'
    });
    delete out.sample;

    if (rep === 'plan') {
      const list = M.generateInstallments({
        issuer: out.issuer, amountCents: cents, firstDate: due, count: planN, everyMonths: +v('f-plan-every'),
        paymentType: type, entity, reference, iban, category: out.category, description: out.description,
        notes: out.notes, remindDays: remind
      });
      list[0].invoiceNumber = out.invoiceNumber;
      await R.payments.saveMany(list);
    } else if (rep === 'recurring') {
      out.installmentNo = null; out.installmentTotal = null;
      await R.payments.saveMany(M.generateRecurring(out, recFreq, RECUR_TARGET, recCustom));
    } else {
      await R.payments.save(out);
    }
    if (entity) await R.entities.remember(entity, out.issuer); // aprende "12345 = EDP"
    draft = null;
    if (!existing && window.PagaAds) window.PagaAds.onSaved().catch(() => {}); // anúncio de ecrã inteiro a cada N novos
    location.hash = existing ? '#/p/' + out.id : '#/';
  }

  // ----- Calendário -----
  async function viewCalendar() {
    const list = await R.payments.list();
    const today = M.todayISO();
    const month = calMonth || today.slice(0, 7);
    const selected = calDay && calDay.slice(0, 7) === month ? calDay : (today.slice(0, 7) === month ? today : null);
    const byDay = {};
    list.forEach(p => { (byDay[p.dueDate] = byDay[p.dueDate] || []).push(p); });

    const cells = M.calendarCells(month).map(iso => {
      if (!iso) return '<div class="cal-cell empty"></div>';
      const items = byDay[iso] || [];
      return `<button class="cal-cell ${iso === today ? 'today' : ''} ${iso === selected ? 'sel' : ''}" data-action="calday" data-arg="${iso}" aria-label="${M.formatDate(iso)}">
        <span class="n">${+iso.slice(8)}</span>
        <span class="dots">${items.slice(0, 4).map(p => `<i class="dot2 ${dotFor(p, today)}"></i>`).join('')}</span></button>`;
    }).join('');

    const monthItems = list.filter(p => p.dueDate.slice(0, 7) === month);
    const monthPending = monthItems.filter(p => p.status !== 'paid').reduce((s, p) => s + (p.amountCents || 0), 0);
    const dayItems = selected ? (byDay[selected] || []) : [];

    $app.innerHTML = layout('calendar', `
      <div class="row" style="margin-bottom:4px">
        <button class="chip" data-action="calprev" aria-label="${t('Mês anterior')}">‹</button>
        <h1 class="grow" style="text-align:center;margin:0;font-size:20px">${esc(monthLabel(month))}</h1>
        <button class="chip" data-action="calnext" aria-label="${t('Mês seguinte')}">›</button>
      </div>
      <p class="muted" style="text-align:center">${t(monthItems.length === 1 ? '{n} pagamento · por pagar {amount}' : '{n} pagamentos · por pagar {amount}', { n: monthItems.length, amount: M.formatEUR(monthPending) })}</p>
      <div class="cal">
        ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<div class="cal-head">${t(d)}</div>`).join('')}
        ${cells}
      </div>
      <div class="legend"><span><i class="dot2 paid"></i> ${t('Pago')}</span><span><i class="dot2 pending"></i> ${t('Próximo')}</span><span><i class="dot2 overdue"></i> ${t('Em atraso')}</span><span><i class="dot2 recurring"></i> ${t('Recorrente')}</span></div>
      ${(calMonth && calMonth !== today.slice(0, 7)) ? `<button class="btn secondary small" data-action="caltoday">${t('Voltar a este mês')}</button>` : ''}
      ${selected ? `<h2>${M.formatDate(selected)}</h2>${dayItems.length ? dayItems.map(p => paymentItem(p, today)).join('') : `<div class="empty" style="padding:12px">${t('Sem pagamentos neste dia.')}</div>`}` : `<h2>${t('Toque num dia')}</h2>`}`);
  }

  // ----- Histórico -----
  function historyRows() {
    const today = M.todayISO();
    return histList.filter(p =>
      (hist.status === 'all' || M.effectiveStatus(p, today) === hist.status) &&
      (!hist.month || p.dueDate.slice(0, 7) === hist.month) &&
      (!hist.issuer || p.issuer === hist.issuer) &&
      (!hist.category || p.category === hist.category) &&
      M.matches(p, hist.q)
    ).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }

  function historyBody() {
    const today = M.todayISO();
    const rows = historyRows();
    const s = M.summarize(rows, today);
    return `<div class="stats">
        <div class="stat"><div class="label">${t(s.count === 1 ? '{n} pagamento' : '{n} pagamentos', { n: s.count })}</div><div class="value">${M.formatEUR(s.total)}</div></div>
        <div class="stat green"><div class="label">${t('Pago')}</div><div class="value">${M.formatEUR(s.paid)}</div></div>
        <div class="stat ${s.overdue ? 'red' : ''}"><div class="label">${t('Por pagar')}</div><div class="value">${M.formatEUR(s.pending + s.overdue)}</div></div>
      </div>` + (rows.length ? rows.map(p => paymentItem(p, today)).join('') : `<div class="empty">${t('Nenhum pagamento com estes filtros.')}</div>`);
  }

  async function viewHistory() {
    histList = await R.payments.list();
    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
    const months = uniq(histList.map(p => p.dueDate.slice(0, 7))).sort().reverse();
    const issuers = uniq(histList.map(p => p.issuer)).sort((a, b) => a.localeCompare(b, I.lang()));
    const cats = uniq(histList.map(p => p.category)).sort((a, b) => a.localeCompare(b, I.lang()));
    const chip = (key, label) => `<button class="chip ${hist.status === key ? 'active' : ''}" data-action="hstatus" data-arg="${key}">${label}</button>`;
    const sel = (bind, all, cur, opts) => `<select data-bind="${bind}"><option value="">${all}</option>${opts.map(([val, label]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    $app.innerHTML = layout('history', `
      <h1>${t('Histórico')}</h1>
      <input type="search" data-bind="hist-q" placeholder="${esc(t('Pesquisar em todos os pagamentos…'))}" value="${esc(hist.q)}" style="margin-top:12px">
      <div class="chips" style="margin:12px 0">${chip('all', t('Todos'))}${chip('paid', t('Pagos'))}${chip('pending', t('Pendentes'))}${chip('overdue', t('Em atraso'))}</div>
      <div class="filters">
        ${sel('hist-month', t('Todos os meses'), hist.month, months.map(m => [m, monthLabel(m)]))}
        ${sel('hist-issuer', t('Todas as entidades'), hist.issuer, issuers.map(i => [i, i]))}
        ${sel('hist-cat', t('Todas as categorias'), hist.category, cats.map(c => [c, t(c)]))}
      </div>
      <div id="hist-body" style="margin-top:12px">${historyBody()}</div>`);
  }

  // ----- Definições -----
  async function viewSettings() {
    const list = await R.payments.list();
    const samples = list.filter(p => p.sample).length;

    // Instalação: mostra o que o browser está a ver, para se perceber porque não aparece "Instalar".
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    let swState = t('não suportado neste browser');
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      swState = t(reg && reg.active ? 'ativo' : 'ainda não ativo');
    }
    const ua = navigator.userAgent;
    const inApp = /FBAN|FBAV|Instagram|GSA\/|; wv\)|Line\//.test(ua);
    const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : t('outro');
    const installHtml = standalone
      ? `<div class="alert blue">${t('A app já está instalada e a abrir em ecrã inteiro.')}</div>`
      : deferredInstall
        ? `<button class="btn green" data-action="install">${t('Instalar no ecrã inicial')}</button>`
        : `<div class="alert">${t('O browser ainda não ofereceu a instalação.')}</div>
           <p class="muted">${t('Ligação segura (HTTPS):')} <b>${t(window.isSecureContext ? 'sim' : 'não')}</b><br>
           Service worker: <b>${swState}</b><br>
           Browser: <b>${browser}${inApp ? ' ' + t('(parece estar dentro de outra app)') : ''}</b></p>
           <p class="muted">${t('Abra este endereço diretamente no Chrome (se veio de um link dentro de outra app, copie o endereço e cole no Chrome). Depois procure "Instalar app" no menu ⋮.')}</p>`;

    $app.innerHTML = layout('settings', `
      <h1>${t('Definições')}</h1>
      <div class="alert blue" style="margin-top:14px"><b>${t('Privacidade')}</b><br>${t('Por omissão, os seus pagamentos ficam apenas neste dispositivo. Só se criar conta (opcional) é que são guardados na nuvem, cifrados com uma frase-passe só sua. Nunca é pedido acesso ao seu email nem ao banco. Na app Android gratuita há anúncios (Google AdMob), sujeitos ao seu consentimento.')}<br><a href="https://dontasko.github.io/pagacerto/${I.lang() === 'en' ? 'privacidade-en.html' : 'privacidade.html'}">${t('Política de Privacidade')}</a> · <a href="https://dontasko.github.io/pagacerto/${I.lang() === 'en' ? 'termos-en.html' : 'termos.html'}">${t('Termos de Utilização')}</a></div>
      <h2>${t('Idioma')}</h2>
      <select id="lang-sel" data-bind="lang">${I.LANGS.map(([c, n]) => `<option value="${c}" ${c === I.setting() ? 'selected' : ''}>${n === 'auto' ? t('Automático') : n}</option>`).join('')}</select>
      ${await reminderHtml()}
      ${await adsHtml()}
      ${await accountHtml()}
      ${N.isNative() ? '' : '<h2>' + t('Instalar') + '</h2>' + installHtml}
      <h2>${t('Dados de exemplo')}</h2>
      ${samples
        ? `<button class="btn secondary" data-action="clear-samples">${t('Remover dados de exemplo')} (${samples})</button>`
        : `<button class="btn secondary" data-action="sample">${t('Carregar dados de exemplo')}</button>`}
      <h2>${t('Dados')}</h2>
      <button class="btn danger" data-action="wipe">${t('Apagar todos os dados')}</button>
      <p class="muted" style="margin-top:18px">PagaCerto · ${t('versão 0.7 (versão gratuita)')}</p>`);
  }



  // ----- Anúncios (só na app Android gratuita) -----
  async function adsHtml() {
    if (!window.PagaAds || !window.PagaAds.isNative()) return '';
    const st = await window.PagaAds.state();
    if (!st.available || !st.enabled) return '';
    return `<h2>${t('Anúncios')}</h2>
      <p class="muted">${t('A versão gratuita mostra um banner em baixo e, de vez em quando, um anúncio de ecrã inteiro depois de guardar pagamentos. Os seus pagamentos nunca são usados para escolher anúncios.')}</p>
      ${st.privacyOptionsRequired ? `<button class="btn secondary small" data-action="ads-privacy">${t('Preferências de anúncios e privacidade')}</button>` : ''}`;
  }

  // ----- Lembretes (só na app Android) -----
  async function reminderHtml() {
    const msg = remMsg ? `<div class="${remMsg.type === 'error' ? 'error' : 'alert blue'}">${esc(remMsg.text)}</div>` : '';
    remMsg = null;
    const st = await N.status();
    if (!st.native) {
      return `<h2>${t('Lembretes')}</h2>${msg}<div class="alert">${t('Os lembretes funcionam na app Android. No browser não são fiáveis, porque o browser não acorda em segundo plano.')}</div>`;
    }
    const on = await R.settings.get('remindersOn', true);
    const hour = await R.settings.get('remindHour', 9);
    if (!st.granted) {
      return `<h2>${t('Lembretes')}</h2>${msg}<div class="alert">${t('As notificações estão desligadas. Sem elas a app não o pode avisar.')}</div>
        <button class="btn green" data-action="rem-perm">${t('Permitir notificações')}</button>`;
    }
    const opts = Array.from({ length: 16 }, (_, i) => i + 6).map(h => `<option value="${h}" ${h === hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
    return `<h2>${t('Lembretes')}</h2>${msg}
      <p class="muted">${on ? t('{n} lembrete(s) agendado(s).', { n: st.pending }) : t('Lembretes desligados.')}</p>
      <label for="rem-hour">${t('Hora dos avisos')}</label>
      <select id="rem-hour" data-bind="rem-hour">${opts}</select>
      <button class="btn secondary" data-action="rem-toggle">${on ? t('Desligar lembretes') : t('Ligar lembretes')}</button>
      <button class="btn secondary small" data-action="rem-test">${t('Enviar notificação de teste')}</button>`;
  }

  // ----- Conta e sincronização (opcional) -----
  async function accountHtml() {
    const info = await S.info();
    const msg = accMsg ? `<div class="${accMsg.type === 'error' ? 'error' : 'alert blue'}">${esc(accMsg.text)}</div>` : '';
    accMsg = null;
    if (recovering) {
      return `<h2>${t('Conta e sincronização')}</h2>${msg}
        <div class="alert blue">${t('Escolha a nova palavra-passe.')}</div>
        <label for="acc-newpass">${t('Nova palavra-passe (mínimo 8 caracteres)')}</label>
        <input id="acc-newpass" type="password" autocomplete="new-password">
        <button class="btn" data-action="acc-setpass">${t('Guardar palavra-passe')}</button>`;
    }
    if (info.email) {
      const ks = await S.keyStatus();
      if (ks === 'setup' || ks === 'unlock') return `<h2>${t('Conta e sincronização')}</h2>${msg}
        <div class="card"><b>${esc(info.email)}</b></div>
        ${keyPanelHtml(ks)}
        <button class="btn small secondary" data-action="acc-signout">${t('Sair da conta')}</button>`;
      const last = info.lastSync ? new Date(info.lastSync).toLocaleString(I.locale(), { dateStyle: 'short', timeStyle: 'short' }) : t('ainda não');
      return `<h2>${t('Conta e sincronização')}</h2>${msg}
        <div class="card"><b>${esc(info.email)}</b><br><span class="muted">${t('Última sincronização:')} ${esc(last)}${info.error ? '<br>' + esc(t(info.error)) : ''}</span></div>
        <button class="btn green" data-action="acc-sync">${t('Sincronizar agora')}</button>
        <button class="btn secondary" data-action="acc-signout">${t('Sair da conta')}</button>
        <button class="btn danger" data-action="acc-delete">${t('Apagar conta e dados na nuvem')}</button>
        <p class="muted">${t('Os pagamentos desta conta são guardados em servidores na Europa (Londres) para aparecerem nos seus outros dispositivos.')}</p>`;
    }
    return `<h2>${t('Conta e sincronização')}</h2>${msg}
      <p class="muted">${t('Opcional. Sem conta, tudo fica só neste dispositivo. Com conta, os seus pagamentos são guardados na nuvem e aparecem em todos os dispositivos onde entrar.')}</p>
      <label for="acc-email">${t('Email')}</label>
      <input id="acc-email" type="email" autocomplete="email" value="${esc(accEmail)}">
      <label for="acc-pass">${t('Palavra-passe (mínimo 8 caracteres)')}</label>
      <input id="acc-pass" type="password" autocomplete="current-password">
      <button class="btn" data-action="acc-signin">${t('Entrar')}</button>
      <button class="btn secondary" data-action="acc-signup">${t('Criar conta')}</button>
      <button class="btn small secondary" data-action="acc-forgot">${t('Esqueci a palavra-passe')}</button>`;
  }

  let showReset = false;
  function keyPanelHtml(ks) {
    const warn = `<div class="alert"><b>${t('Atenção:')}</b> ${t('a frase-passe não pode ser recuperada por nós. Se a perder, os dados guardados na nuvem ficam ilegíveis (os dispositivos onde já entrou mantêm os seus dados).')}</div>`;
    if (ks === 'setup' || showReset) {
      return `<div class="alert blue">${showReset ? t('Vai apagar os dados cifrados na nuvem e criar uma nova frase-passe. Os pagamentos deste dispositivo voltam a ser enviados.') : t('Para proteger os seus pagamentos, escolha uma <b>frase-passe</b>. Os dados são cifrados neste dispositivo antes de irem para a nuvem: nem nós os conseguimos ler.')}</div>
        ${warn}
        <label for="acc-pp1">${t('Frase-passe (mínimo 10 caracteres)')}</label>
        <input id="acc-pp1" type="password" autocomplete="new-password">
        <label for="acc-pp2">${t('Repita a frase-passe')}</label>
        <input id="acc-pp2" type="password" autocomplete="new-password">
        <button class="btn" data-action="${showReset ? 'acc-keyreset' : 'acc-keysetup'}">${showReset ? t('Apagar nuvem e criar nova frase-passe') : t('Ativar cifragem e sincronizar')}</button>
        ${showReset ? `<button class="btn small secondary" data-action="acc-keyresetcancel">${t('Cancelar')}</button>` : ''}`;
    }
    return `<div class="alert blue">${t('Introduza a frase-passe desta conta para ver e sincronizar os seus pagamentos neste dispositivo.')}</div>
      <label for="acc-pp1">${t('Frase-passe')}</label>
      <input id="acc-pp1" type="password" autocomplete="current-password">
      <button class="btn" data-action="acc-keyunlock">${t('Desbloquear')}</button>
      <button class="btn small secondary" data-action="acc-keyresetask">${t('Perdi a frase-passe')}</button>`;
  }

  const accInputs = () => {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    accEmail = g('acc-email').trim() || accEmail;
    return { email: accEmail, pass: g('acc-pass') };
  };
  const accFail = e => { accMsg = { type: 'error', text: e && e.message ? t(e.message) : String(e) }; };

  // Depois de entrar: se o dispositivo tinha dados de outra conta, pergunta antes de os juntar.
  async function afterLogin(session) {
    const prev = await R.settings.get('syncUser', null);
    if (prev !== session.user_id) {
      if (prev) {
        const n = (await R.payments.list()).filter(p => !p.sample).length;
        if (n && !confirm(t('Este dispositivo já esteve ligado a outra conta. Os pagamentos locais serão apagados e substituídos pelos desta conta. Continuar?'))) {
          await S.signOut();
          throw new Error(t('Entrada cancelada.'));
        }
        await R.payments.hardClear();
      }
      await R.settings.set('syncCursor', null);
      await R.settings.set('syncUser', session.user_id);
      await S.markAllDirty();
    }
    const r = await S.syncNow();
    if (r && r.error && !r.offline) throw new Error(r.error);
  }

  // ---------- ações ----------
  const actions = {
    async start() { await R.settings.set('onboarded', true); try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} location.hash = '#/'; render(); },
    async parse() {
      const text = document.getElementById('f-paste').value;
      if (!text.trim()) return showFormError(t('Cole primeiro o texto da fatura.'));
      await handleSharedText(text, '');
    },
    filter(arg) { listFilter = arg; render(); },
    hstatus(arg) { hist.status = arg; render(); },
    calprev() { calMonth = M.addMonths((calMonth || M.todayISO().slice(0, 7)) + '-01', -1).slice(0, 7); calDay = null; render(); },
    calnext() { calMonth = M.addMonths((calMonth || M.todayISO().slice(0, 7)) + '-01', 1).slice(0, 7); calDay = null; render(); },
    calday(arg) { calDay = arg; render(); },
    caltoday() { calMonth = null; calDay = null; render(); },
    async install() {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      render();
    },
    async pay(id) {
      const p = await R.payments.markPaid(id);
      // Pagamento recorrente: repõe as ocorrências por pagar (mantém sempre RECUR_TARGET à frente).
      if (p && p.recurrenceId) {
        const group = (await R.payments.list()).filter(x => x.recurrenceId === p.recurrenceId);
        const extra = M.recurrenceTopUp(group, RECUR_TARGET);
        if (extra.length) await R.payments.saveMany(extra);
      }
      render();
    },
    async reopen(id) { await R.payments.reopen(id); render(); },
    async delete(id) {
      const p = await R.payments.get(id);
      if (!p) return;
      if (!confirm(t('Eliminar este pagamento? Esta ação não pode ser desfeita.'))) return;
      let ids = [id];
      const gid = p.planId || p.recurrenceId;
      if (gid && confirm(t('Este pagamento faz parte de um plano ou de uma repetição.\n\nOK: eliminar também os seguintes que ainda estão por pagar.\nCancelar: eliminar só este.'))) {
        const all = await R.payments.list();
        ids = all.filter(x => (x.planId === gid || x.recurrenceId === gid) && x.status !== 'paid' && x.dueDate >= p.dueDate).map(x => x.id);
      }
      await R.payments.removeMany(ids);
      location.hash = '#/payments';
    },
    async sample() { await R.seedSamples(); render(); },
    async 'clear-samples'() { await R.payments.removeSamples(); render(); },
    async wipe() {
      const cloud = (await S.info()).email;
      if (!confirm(cloud ? t('Apagar TODOS os pagamentos? Como tem conta, também serão apagados nos seus outros dispositivos e na nuvem. Não pode ser desfeito.') : t('Apagar TODOS os pagamentos deste dispositivo? Esta ação não pode ser desfeita.'))) return;
      await R.wipeEverything(); render();
    },
    async 'rem-perm'() {
      const ok = await N.requestPermission();
      remMsg = ok ? { type: 'ok', text: t('Notificações permitidas.') } : { type: 'error', text: t('Permissão recusada. Ative em Definições do Android → Apps → PagaCerto → Notificações.') };
      await N.apply(); render();
    },
    async 'rem-toggle'() {
      await R.settings.set('remindersOn', !(await R.settings.get('remindersOn', true)));
      await N.apply(); render();
    },
    async 'ads-privacy'() { await window.PagaAds.privacyOptions(); },
    async 'rem-test'() {
      const ok = await N.sendTest();
      remMsg = ok ? { type: 'ok', text: t('Vai receber uma notificação daqui a 5 segundos. Pode sair da app para ver como aparece.') } : { type: 'error', text: t('Sem permissão para notificações.') };
      render();
    },
    async 'acc-signup'() {
      const { email, pass } = accInputs();
      if (!email || !pass) { accMsg = { type: 'error', text: t('Preencha o email e a palavra-passe.') }; return render(); }
      if (pass.length < 8) { accMsg = { type: 'error', text: t('A palavra-passe tem de ter pelo menos 8 caracteres.') }; return render(); }
      try {
        const r = await S.signUp(email, pass);
        if (r.session) await afterLogin(r.session);
        else accMsg = { type: 'ok', text: t('Enviámos um email de confirmação para {email}. Abra o link (veja também o spam) e depois volte aqui para entrar.', { email }) };
      } catch (e) { accFail(e); }
      render();
    },
    async 'acc-signin'() {
      const { email, pass } = accInputs();
      if (!email || !pass) { accMsg = { type: 'error', text: t('Preencha o email e a palavra-passe.') }; return render(); }
      try { await afterLogin(await S.signIn(email, pass)); } catch (e) { accFail(e); }
      render();
    },
    async 'acc-forgot'() {
      const { email } = accInputs();
      if (!email) { accMsg = { type: 'error', text: t('Escreva primeiro o seu email.') }; return render(); }
      try { await S.recover(email); accMsg = { type: 'ok', text: t('Se existir uma conta com esse email, enviámos um link para escolher nova palavra-passe.') }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-setpass'() {
      const el = document.getElementById('acc-newpass');
      const pw = el ? el.value : '';
      if (pw.length < 8) { accMsg = { type: 'error', text: t('A palavra-passe tem de ter pelo menos 8 caracteres.') }; return render(); }
      try { await S.updatePassword(pw); recovering = false; accMsg = { type: 'ok', text: t('Palavra-passe alterada.') }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-keysetup'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '', b = (document.getElementById('acc-pp2') || {}).value || '';
      if (a !== b) { accMsg = { type: 'error', text: t('As duas frases-passe não coincidem.') }; return render(); }
      try { await S.setupPassphrase(a); accMsg = { type: 'ok', text: t('Cifragem ativada. Guarde a frase-passe num local seguro.') }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-keyunlock'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '';
      try { await S.unlock(a); accMsg = { type: 'ok', text: t('Desbloqueado. Dados sincronizados.') }; } catch (e) { accFail(e); }
      render();
    },
    'acc-keyresetask'() { showReset = true; render(); },
    'acc-keyresetcancel'() { showReset = false; render(); },
    async 'acc-keyreset'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '', b = (document.getElementById('acc-pp2') || {}).value || '';
      if (a !== b) { accMsg = { type: 'error', text: t('As duas frases-passe não coincidem.') }; return render(); }
      if (!confirm(t('Isto apaga TODOS os pagamentos guardados na nuvem e recomeça com a nova frase-passe. Só os dados que existirem neste dispositivo voltam a ser enviados. Continuar?'))) return;
      try { await S.resetEncryption(a); showReset = false; accMsg = { type: 'ok', text: t('Nova frase-passe criada.') }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-sync'() {
      const r = await S.syncNow();
      accMsg = r && r.error ? { type: 'error', text: t(r.offline ? 'Sem ligação à internet.' : r.error) } : { type: 'ok', text: t('Sincronizado.') };
      render();
    },
    async 'acc-signout'() { await S.signOut(); showReset = false; accMsg = { type: 'ok', text: t('Saiu da conta. Os dados continuam neste dispositivo.') }; render(); },
    async 'acc-delete'() {
      if (!confirm(t('Apagar a conta e todos os pagamentos guardados na nuvem? Esta ação não pode ser desfeita. Os dados deste dispositivo mantêm-se.'))) return;
      if (!confirm(t('Tem a certeza? Confirme para apagar a conta definitivamente.'))) return;
      try { await S.deleteAccount(); accMsg = { type: 'ok', text: t('Conta apagada. Os pagamentos deste dispositivo mantêm-se.') }; } catch (e) { accFail(e); }
      render();
    },
    cancel() { draft = null; }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'BUTTON') e.preventDefault();
    Promise.resolve(fn(el.dataset.arg)).catch(showFatal);
  });

  // Campos de pesquisa e filtros (data-bind): a pesquisa atualiza só a lista, para não perder o foco do teclado.
  const binds = {
    'pay-q'(val) { payQ = val; document.getElementById('pay-body').innerHTML = paymentsBody(); },
    'hist-q'(val) { hist.q = val; document.getElementById('hist-body').innerHTML = historyBody(); },
    'hist-month'(val) { hist.month = val; render(); },
    'hist-issuer'(val) { hist.issuer = val; render(); },
    'hist-cat'(val) { hist.category = val; render(); },
    lang(val) { I.set(val); location.reload(); },
    'rem-hour'(val) { R.settings.set('remindHour', Number(val)).then(() => N.apply()).then(render); }
  };
  document.addEventListener('input', e => {
    const b = e.target.dataset && e.target.dataset.bind;
    if (b && binds[b]) binds[b](e.target.value);
  });

  // ---------- router ----------
  function showFatal(err) {
    console.error(err);
    $app.innerHTML = `<main><div class="error">${t('Ocorreu um erro:')} ${esc(err && err.message ? err.message : err)}</div></main>`;
  }

  async function render() {
    try {
      const onboarded = await R.settings.get('onboarded', false);
      if (!onboarded) return viewOnboarding();
      const [, route, arg] = (location.hash.replace(/^#/, '') || '/').split('/');
      if (route !== 'new' && route !== 'edit' && draft) draft = null;
      switch (route) {
        case '': case undefined: return await viewHome();
        case 'payments': return await viewPayments();
        case 'p': return await viewDetail(arg);
        case 'new': return await viewForm(null);
        case 'edit': return await viewForm(arg);
        case 'calendar': return await viewCalendar();
        case 'history': return await viewHistory();
        case 'settings': return await viewSettings();
        default: location.hash = '#/';
      }
    } catch (err) { showFatal(err); }
  }

  window.addEventListener('hashchange', () => { render().then(() => window.scrollTo(0, 0)); });

  window.addEventListener('pagacerto-synced', e => {
    const route = (location.hash.replace(/^#/, '') || '/').split('/')[1];
    if (route === 'new' || route === 'edit') return; // não interromper quem está a preencher
    N.schedule();
    if (e.detail && e.detail.expired) accMsg = { type: 'error', text: t('A sessão expirou. Entre novamente.') };
    render();
  });

  function startServices() { S.start(); N.start(); if (window.PagaAds) window.PagaAds.sync().catch(() => {}); }

  // Partilha via PWA (share_target, método GET): ?title=...&text=...
  async function boot() {
    const ar = await S.handleAuthRedirect().catch(err => ({ kind: 'error', message: err.message }));
    if (ar) {
      history.replaceState(null, '', location.pathname + location.search);
      await R.settings.set('onboarded', true);
      if (ar.kind === 'error') accMsg = { type: 'error', text: ar.message };
      else if (ar.kind === 'recovery') recovering = true;
      else { try { await afterLogin(ar.session); accMsg = { type: 'ok', text: t('Conta confirmada. Sessão iniciada.') }; } catch (err) { accFail(err); } }
      location.hash = '#/settings';
      render();
      startServices();
      return;
    }
    const q = new URLSearchParams(location.search);
    const shared = [q.get('text'), q.get('url')].filter(Boolean).join('\n');
    if (shared || q.get('title')) {
      history.replaceState(null, '', location.pathname);
      await R.settings.set('onboarded', true); // veio de uma partilha: não interromper com o ecrã de boas-vindas
      await handleSharedText(shared, q.get('title') || '');
      startServices();
      return;
    }
    if (await checkNativeShare()) { startServices(); return; }
    render();
    startServices();
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !N.isNative()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot().catch(showFatal);
}());
