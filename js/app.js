/* PagaCerto — interface. Sem frameworks: rotas por hash, HTML em template strings.
 * Todo o texto do utilizador passa por esc() antes de entrar em innerHTML.
 */
(function () {
  'use strict';
  const P = window.PagaParser, M = window.PagaModels, R = window.PagaRepo, S = window.PagaSync, N = window.PagaNotify, Pdf = window.PagaPdf;
  const $app = document.getElementById('app');

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
  const REMIND_LABEL = { 0: 'No próprio dia', 1: '1 dia antes', 3: '3 dias antes', 5: '5 dias antes', 7: '7 dias antes' };
  const TYPE_LABEL = { mb: 'Multibanco (entidade e referência)', state: 'Pagamento ao Estado (só referência)', other: 'Transferência ou outro' };
  const FREQ_LABEL = { monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado' };
  const EVERY_LABEL = { 1: 'Mensal', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' };
  const STATE_HOWTO = 'No Multibanco: Pagamentos e outros serviços → Estado e sector público → Pagamentos ao Estado. Introduza a referência e confirme o montante.';

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
  const askPdfPassword = wrong => prompt(wrong ? 'Palavra-passe incorreta. Tente outra vez:' : 'Este PDF tem palavra-passe. Introduza-a para o ler:');

  async function importPdfBytes(bytes, name) {
    const status = document.getElementById('pdf-status');
    if (status) status.textContent = 'A ler o PDF…';
    let warning = null;
    try {
      const text = await Pdf.extractText(bytes, askPdfPassword);
      if (text) { await handleSharedText(text, String(name || '').replace(/\.pdf$/i, '')); return; }
      warning = 'Este PDF não tem texto (parece uma imagem digitalizada). Por agora escreva os dados à mão. A leitura de fotografias chega numa próxima versão.';
    } catch (e) {
      warning = e && e.message ? e.message : 'Não foi possível ler o PDF.';
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
    if (f.size > 15 * 1024 * 1024) return showFormError('O PDF é demasiado grande (máximo 15 MB).');
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
      ['#/', 'Início', '🏠', 'home'], ['#/calendar', 'Calendário', '📅', 'calendar'],
      ['#/payments', 'Pagamentos', '💳', 'payments'], ['#/history', 'Histórico', '📊', 'history'],
      ['#/settings', 'Definições', '⚙️', 'settings']
    ].map(([href, label, ic, key]) =>
      `<a href="${href}" class="${key === active ? 'active' : ''}"><span class="ic">${ic}</span>${label}</a>`).join('');
    return `<main>${inner}</main>${opts.noFab ? '' : '<a class="fab" href="#/new" aria-label="Novo pagamento">+</a>'}<nav class="bottom">${nav}</nav>`;
  }

  function dotFor(p, today) {
    const st = M.effectiveStatus(p, today);
    return st === 'pending' && p.recurrenceId ? 'recurring' : st;
  }

  function paymentItem(p, today) {
    const inst = M.installmentLabel(p);
    return `<a class="item card" href="#/p/${esc(p.id)}"><div class="row">
      <span class="dot ${dotFor(p, today)}"></span>
      <div class="grow"><div class="title">${esc(p.issuer || 'Sem nome')}</div>
        <div class="sub">${inst ? esc(inst) + ' · ' : ''}${M.formatDate(p.dueDate)}</div></div>
      <div class="amount">${M.formatEUR(p.amountCents)}</div></div></a>`;
  }

  const plural = (n, one, many) => n === 1 ? one : many;
  const monthLabel = ym => {
    const s = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // ---------- vistas ----------
  function viewOnboarding() {
    $app.innerHTML = `<div class="onboard">
      <h1>Não volte a esquecer um pagamento.</h1>
      <div class="step"><b>1</b><span>Receba a fatura</span></div>
      <div class="step"><b>2</b><span>Partilhe com o PagaCerto</span></div>
      <div class="step"><b>3</b><span>Nós ajudamos a criar o lembrete</span></div>
      <p class="muted" style="margin-top:12px">Os seus dados ficam só neste telemóvel. Não pedimos acesso ao seu email nem ao seu banco.</p>
      <button class="btn" data-action="start">COMEÇAR</button></div>`;
  }

  async function viewHome() {
    const list = await R.payments.list();
    const today = M.todayISO();
    const month = today.slice(0, 7);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite';

    const open = list.filter(p => p.status !== 'paid');
    const overdue = open.filter(p => M.effectiveStatus(p, today) === 'overdue');
    const toPay = open.filter(p => p.dueDate.slice(0, 7) === month).reduce((s, p) => s + (p.amountCents || 0), 0);
    const paid = list.filter(p => p.status === 'paid' && p.paidAt && M.localDateOf(p.paidAt).slice(0, 7) === month)
      .reduce((s, p) => s + (p.amountCents || 0), 0);
    const overdueTotal = overdue.reduce((s, p) => s + (p.amountCents || 0), 0);
    const next7 = open.filter(p => { const d = M.diffDays(p.dueDate, today); return d >= 0 && d <= 7; });

    let alerts = '';
    if (overdue.length) alerts += `<div class="alert red">🔴 Tem ${overdue.length} ${plural(overdue.length, 'pagamento em atraso', 'pagamentos em atraso')}: ${esc(overdue.slice(0, 3).map(p => p.issuer || 'Sem nome').join(', '))}${overdue.length > 3 ? '…' : ''}.</div>`;
    if (next7.length) alerts += `<div class="alert">⚠️ Pagamentos próximos<br><span style="font-weight:400">Tem ${next7.length} ${plural(next7.length, 'pagamento', 'pagamentos')} nos próximos 7 dias.</span></div>`;

    const upcoming = open.filter(p => M.diffDays(p.dueDate, today) <= 30);
    const shown = upcoming.slice(0, 10);
    let listHtml = '', lastLabel = null;
    for (const p of shown) {
      const isOver = M.effectiveStatus(p, today) === 'overdue';
      const label = isOver ? 'EM ATRASO' : M.formatDayLabel(p.dueDate, today);
      if (label !== lastLabel) { listHtml += `<div class="daylabel ${isOver ? 'red' : ''}">${esc(label)}</div>`; lastLabel = label; }
      listHtml += paymentItem(p, today);
    }
    if (!shown.length) listHtml = `<div class="empty">Sem pagamentos por pagar nos próximos 30 dias.<br>Toque em <b>+</b> para adicionar o primeiro.</div>`;
    if (upcoming.length > shown.length) listHtml += `<a class="btn secondary small" href="#/payments">Ver todos</a>`;

    $app.innerHTML = layout('home', `
      <h1>${greeting}</h1><p class="muted">O que tem para pagar</p>
      ${alerts}
      <div class="stats">
        <div class="stat"><div class="label">A pagar este mês</div><div class="value">${M.formatEUR(toPay)}</div></div>
        <div class="stat green"><div class="label">Já pago</div><div class="value">${M.formatEUR(paid)}</div></div>
        <div class="stat ${overdueTotal ? 'red' : ''}"><div class="label">Em atraso</div><div class="value">${M.formatEUR(overdueTotal)}</div></div>
      </div>
      <h2>Próximos pagamentos</h2>${listHtml}`);
  }

  // ----- Pagamentos (com pesquisa global) -----
  function paymentsBody() {
    const today = M.todayISO();
    const q = payQ.trim();
    let rows, note = '';
    if (q) {
      // A pesquisa procura em TODOS os pagamentos, ignorando o filtro por estado.
      rows = payList.filter(p => M.matches(p, q));
      note = `<p class="muted">${rows.length} ${plural(rows.length, 'resultado', 'resultados')} em todos os pagamentos</p>`;
    } else {
      rows = payList.filter(p => listFilter === 'all' ? true : listFilter === 'paid' ? p.status === 'paid' : p.status !== 'paid');
      if (listFilter === 'paid') rows = rows.slice().reverse();
    }
    return note + (rows.length ? rows.map(p => paymentItem(p, today)).join('') : '<div class="empty">Nada por aqui.</div>');
  }

  async function viewPayments() {
    payList = await R.payments.list();
    const chip = (key, label) => `<button class="chip ${listFilter === key ? 'active' : ''}" data-action="filter" data-arg="${key}">${label}</button>`;
    $app.innerHTML = layout('payments', `
      <h1>Pagamentos</h1>
      <input type="search" data-bind="pay-q" placeholder="Pesquisar: Vodafone, 120, Prestação 3…" value="${esc(payQ)}" style="margin-top:12px">
      <div class="chips" style="margin:12px 0">${chip('open', 'Por pagar')}${chip('paid', 'Pagos')}${chip('all', 'Todos')}</div>
      <div id="pay-body">${paymentsBody()}</div>`);
  }

  // ----- Detalhe -----
  async function viewDetail(id) {
    const p = await R.payments.get(id);
    if (!p) { location.hash = '#/payments'; return; }
    const today = M.todayISO();
    const st = M.effectiveStatus(p, today);
    const row = (label, val) => val ? `<dt>${label}</dt><dd>${esc(val)}</dd>` : '';
    const paidInfo = p.paidAt ? new Date(p.paidAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const type = M.paymentTypeOf(p);

    // Outras prestações / ocorrências do mesmo grupo
    let groupHtml = '';
    const gid = p.planId || p.recurrenceId;
    if (gid) {
      const all = await R.payments.list();
      const group = all.filter(x => (p.planId ? x.planId === gid : x.recurrenceId === gid));
      const title = p.planId ? 'Plano de prestações' : `Repetição ${p.recurrence ? '(' + (FREQ_LABEL[p.recurrence.frequency] || '').toLowerCase() + ')' : ''}`;
      groupHtml = `<h2>${esc(title)}</h2>` + group.map(x => `
        <a class="item card ${x.id === p.id ? 'current' : ''}" href="#/p/${esc(x.id)}"><div class="row">
          <span class="dot ${dotFor(x, today)}"></span>
          <div class="grow"><div class="title">${esc(M.installmentLabel(x) || M.formatDate(x.dueDate))}</div>
            <div class="sub">${M.formatDate(x.dueDate)}${x.reference ? ' · ref. ' + esc(M.formatReference(x.reference)) : ''}</div></div>
          <div class="amount">${M.formatEUR(x.amountCents)}</div></div></a>`).join('');
    }

    $app.innerHTML = layout('payments', `
      <a href="#/payments" class="muted">← Pagamentos</a>
      <div class="card" style="margin-top:12px">
        <div class="row"><h1 class="grow" style="margin:0">${esc(p.issuer || 'Sem nome')}</h1><span class="badge ${st}">${M.STATUS_LABEL[st]}</span></div>
        <div class="amount" style="font-size:28px;margin:6px 0 0">${M.formatEUR(p.amountCents)}</div>
        <dl class="detail" style="margin:0">
          ${row('Vencimento', M.formatDate(p.dueDate))}
          ${row('Tipo', TYPE_LABEL[type])}
          ${row('Prestação', M.installmentLabel(p))}
          ${type === 'mb' ? row('Entidade', p.entity) : ''}
          ${row('Referência', M.formatReference(p.reference))}
          ${row('IBAN', p.iban)}
          ${row('Número da fatura', p.invoiceNumber)}
          ${row('Categoria', p.category)}
          ${row('Descrição', p.description)}
          ${row('Notas', p.notes)}
          ${row('Pago em', paidInfo)}
          ${row('Lembretes', (p.remindDays || []).length ? p.remindDays.map(d => REMIND_LABEL[d]).join(', ') : 'Sem lembretes')}
        </dl></div>
      ${type === 'state' && p.status !== 'paid' ? `<div class="alert blue">${esc(STATE_HOWTO)}</div>` : ''}
      ${p.status === 'paid'
        ? `<button class="btn secondary" data-action="reopen" data-arg="${esc(p.id)}">Reabrir (voltar a pendente)</button>`
        : `<button class="btn green" data-action="pay" data-arg="${esc(p.id)}">Marcar como pago</button>`}
      <a class="btn secondary" href="${esc(M.googleCalendarUrl(p))}" target="_blank" rel="noopener">📅 Adicionar ao Google Calendar</a>
      <a class="btn secondary" href="#/edit/${esc(p.id)}">Editar</a>
      <button class="btn danger" data-action="delete" data-arg="${esc(p.id)}">Eliminar</button>
      ${groupHtml}`);
  }

  // ----- Formulário -----
  function fieldHtml(id, label, value, o) {
    o = o || {};
    let cls = '', hint = '';
    if (o.parsed) {
      if (!value) { cls = 'needs-check'; hint = 'Não encontrado. Preencha à mão.'; }
      else if (o.low) { cls = 'needs-check'; hint = 'Confirme este campo.'; }
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
        <label for="f-paste" style="margin-top:0">Colar texto da fatura</label>
        <textarea id="f-paste" placeholder="Cole aqui o texto do email ou da fatura. O PagaCerto tenta preencher os campos, e você confirma."></textarea>
        <button class="btn secondary small" data-action="parse">Reconhecer dados</button>
        <label class="btn secondary small" for="f-pdf" style="cursor:pointer">📄 Importar PDF</label>
        <input id="f-pdf" type="file" accept="application/pdf,.pdf" style="display:none">
        <div id="pdf-status" class="hint" style="color:var(--muted)"></div>
      </div>`;

    const found = parsed ? `<div class="alert blue"><b>PAGAMENTO ENCONTRADO</b><br>Confira cada campo antes de guardar. Os campos a laranja precisam da sua confirmação.</div>` : '';
    const warn = warnings && warnings.length ? `<div class="alert">${warnings.map(w => esc(w)).join('<br>')}</div>` : '';

    // Repetição: só em pagamentos novos. Editar mexe apenas neste pagamento.
    const repetition = existingId ? '' : `
        <label for="f-rep">Repetição</label>
        <select id="f-rep">
          <option value="once">Só este pagamento</option>
          <option value="plan">Plano de prestações (criar todas)</option>
          <option value="recurring">Pagamento recorrente</option>
        </select>
        <div id="box-plan" style="display:none">
          <label for="f-plan-n">Número de prestações</label>
          <input id="f-plan-n" type="number" min="2" max="120" inputmode="numeric" value="12">
          <label for="f-plan-every">Periodicidade</label>
          <select id="f-plan-every">${Object.keys(EVERY_LABEL).map(k => `<option value="${k}">${EVERY_LABEL[k]}</option>`).join('')}</select>
          <div class="hint" style="color:var(--muted)">O valor e a data acima são os da 1.ª prestação. Cada prestação fica individual, e pode editar a referência de cada uma.</div>
        </div>
        <div id="box-rec" style="display:none">
          <label for="f-rec-freq">Repete-se</label>
          <select id="f-rec-freq">${Object.keys(FREQ_LABEL).map(k => `<option value="${k}">${FREQ_LABEL[k]}</option>`).join('')}</select>
          <div id="box-rec-custom" style="display:none">
            <label for="f-rec-custom">De quantos em quantos meses</label>
            <input id="f-rec-custom" type="number" min="1" max="60" inputmode="numeric" value="1">
          </div>
          <div class="hint" style="color:var(--muted)">Cria já as próximas ${RECUR_TARGET} ocorrências e junta uma nova sempre que pagar uma.</div>
        </div>`;

    $app.innerHTML = layout('payments', `
      <a href="#/${existingId ? 'p/' + esc(existingId) : ''}" class="muted" data-action="cancel">← Cancelar</a>
      <h1 style="margin-top:8px">${existingId ? 'Editar pagamento' : 'Novo pagamento'}</h1>
      ${paste}${found}${warn}
      <div id="form-error" role="alert"></div>
      <form id="pay-form" novalidate>
        ${fieldHtml('f-issuer', 'Nome / Emissor', p.issuer, { parsed, low: low('issuer'), ph: 'Ex.: Vodafone' })}
        ${fieldHtml('f-amount', 'Valor (€)', M.centsToInput(p.amountCents), { parsed, low: low('amountCents'), mode: 'decimal', ph: '0,00' })}
        ${fieldHtml('f-due', 'Data de vencimento', p.dueDate, { parsed, low: low('dueDate'), type: 'date' })}
        <label for="f-type">Tipo de pagamento</label>
        <select id="f-type">${Object.keys(TYPE_LABEL).map(k => `<option value="${k}" ${k === ptype ? 'selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select>
        <div id="type-hint" class="hint" style="color:var(--muted)"></div>
        <div id="box-entity">${fieldHtml('f-entity', 'Entidade (Multibanco, 5 dígitos)', p.entity, { parsed: parsed && ptype === 'mb', low: low('entity'), mode: 'numeric' })}</div>
        ${fieldHtml('f-ref', 'Referência (Multibanco, 9 dígitos)', M.formatReference(p.reference), { parsed, low: low('reference'), mode: 'numeric' })}
        ${fieldHtml('f-iban', 'IBAN (opcional)', p.iban, { parsed: parsed && !!p.iban, low: low('iban') })}
        ${fieldHtml('f-inv', 'Número da fatura (opcional)', p.invoiceNumber, { parsed: parsed && !!p.invoiceNumber, low: low('invoiceNumber') })}
        ${fieldHtml('f-desc', 'Descrição (opcional)', p.description)}
        <label for="f-cat">Categoria</label>
        <select id="f-cat"><option value="">—</option>${cats.map(c => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label for="f-notes">Notas (opcional)</label>
        <textarea id="f-notes" style="min-height:64px">${esc(p.notes)}</textarea>

        ${repetition}
        <div id="box-once">
          <label class="check"><input type="checkbox" id="f-inst" ${isInst ? 'checked' : ''}> Este pagamento é uma prestação</label>
          <div id="inst-box" class="inline" style="${isInst ? '' : 'display:none'}">
            <input id="f-inst-no" type="number" min="1" inputmode="numeric" placeholder="3" value="${p.installmentNo || ''}">
            <span>de</span>
            <input id="f-inst-total" type="number" min="1" inputmode="numeric" placeholder="12" value="${p.installmentTotal || ''}">
          </div>
        </div>

        <label class="check"><input type="checkbox" id="f-remind" ${(p.remindDays || []).length ? 'checked' : ''}> Criar lembrete</label>
        <div class="chips">${M.REMIND_OPTIONS.map(d =>
          `<label class="chip"><input type="checkbox" class="f-rd" value="${d}" ${(p.remindDays || []).includes(d) ? 'checked' : ''}>${REMIND_LABEL[d]}</label>`).join('')}</div>
        <button type="submit" class="btn" style="margin-top:22px">${existingId ? 'GUARDAR' : 'ADICIONAR PAGAMENTO'}</button>
      </form>`, { noFab: true });

    const inst = document.getElementById('f-inst');
    inst.addEventListener('change', () => { document.getElementById('inst-box').style.display = inst.checked ? '' : 'none'; });

    // O tipo decide que campos aparecem: Multibanco = entidade + referência; Estado = só referência (15 dígitos).
    const typeSel = document.getElementById('f-type');
    const applyType = () => {
      const t = typeSel.value;
      document.getElementById('box-entity').style.display = t === 'mb' ? '' : 'none';
      document.querySelector('label[for="f-ref"]').textContent =
        t === 'mb' ? 'Referência (Multibanco, 9 dígitos)' : t === 'state' ? 'Referência para pagamento (15 dígitos)' : 'Referência (opcional)';
      document.getElementById('type-hint').textContent = t === 'state' ? STATE_HOWTO : '';
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

    if (!v('f-issuer')) return showFormError('Indique o nome de quem emite o pagamento.');
    if (cents == null || cents <= 0) return showFormError('Indique um valor válido, por exemplo 87,43.');
    if (!due) return showFormError('Indique a data de vencimento.');
    if (type === 'mb' && entity && !/^\d{5}$/.test(entity)) return showFormError('A entidade Multibanco tem 5 dígitos.');
    if (type === 'mb' && reference && !/^\d{9}$/.test(reference)) return showFormError('A referência Multibanco tem 9 dígitos.');
    if (type === 'state' && !/^\d{15}$/.test(reference)) return showFormError('A referência de um pagamento ao Estado tem 15 dígitos. Confira o documento.');
    if (type === 'other' && reference && !/^\d+$/.test(reference)) return showFormError('A referência só pode ter dígitos.');
    if (iban && !P.ibanValid(iban)) return showFormError('O IBAN não é válido. Confirme cada dígito ou apague o campo.');
    if (isInst && !(instNo >= 1 && instTotal >= instNo)) return showFormError('Indique a prestação, por exemplo 3 de 12.');
    if (rep === 'plan' && !(planN >= 2 && planN <= 120)) return showFormError('O plano tem de ter entre 2 e 120 prestações.');
    if (recFreq === 'custom' && !(recCustom >= 1 && recCustom <= 60)) return showFormError('Indique de quantos em quantos meses (1 a 60).');

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
        <button class="chip" data-action="calprev" aria-label="Mês anterior">‹</button>
        <h1 class="grow" style="text-align:center;margin:0;font-size:20px">${esc(monthLabel(month))}</h1>
        <button class="chip" data-action="calnext" aria-label="Mês seguinte">›</button>
      </div>
      <p class="muted" style="text-align:center">${monthItems.length} ${plural(monthItems.length, 'pagamento', 'pagamentos')} · por pagar ${M.formatEUR(monthPending)}</p>
      <div class="cal">
        ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => `<div class="cal-head">${d}</div>`).join('')}
        ${cells}
      </div>
      <div class="legend"><span><i class="dot2 paid"></i> Pago</span><span><i class="dot2 pending"></i> Próximo</span><span><i class="dot2 overdue"></i> Em atraso</span><span><i class="dot2 recurring"></i> Recorrente</span></div>
      ${(calMonth && calMonth !== today.slice(0, 7)) ? '<button class="btn secondary small" data-action="caltoday">Voltar a este mês</button>' : ''}
      ${selected ? `<h2>${M.formatDate(selected)}</h2>${dayItems.length ? dayItems.map(p => paymentItem(p, today)).join('') : '<div class="empty" style="padding:12px">Sem pagamentos neste dia.</div>'}` : '<h2>Toque num dia</h2>'}`);
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
        <div class="stat"><div class="label">${s.count} ${plural(s.count, 'pagamento', 'pagamentos')}</div><div class="value">${M.formatEUR(s.total)}</div></div>
        <div class="stat green"><div class="label">Pago</div><div class="value">${M.formatEUR(s.paid)}</div></div>
        <div class="stat ${s.overdue ? 'red' : ''}"><div class="label">Por pagar</div><div class="value">${M.formatEUR(s.pending + s.overdue)}</div></div>
      </div>` + (rows.length ? rows.map(p => paymentItem(p, today)).join('') : '<div class="empty">Nenhum pagamento com estes filtros.</div>');
  }

  async function viewHistory() {
    histList = await R.payments.list();
    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
    const months = uniq(histList.map(p => p.dueDate.slice(0, 7))).sort().reverse();
    const issuers = uniq(histList.map(p => p.issuer)).sort((a, b) => a.localeCompare(b, 'pt'));
    const cats = uniq(histList.map(p => p.category)).sort((a, b) => a.localeCompare(b, 'pt'));
    const chip = (key, label) => `<button class="chip ${hist.status === key ? 'active' : ''}" data-action="hstatus" data-arg="${key}">${label}</button>`;
    const sel = (bind, all, cur, opts) => `<select data-bind="${bind}"><option value="">${all}</option>${opts.map(([val, label]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    $app.innerHTML = layout('history', `
      <h1>Histórico</h1>
      <input type="search" data-bind="hist-q" placeholder="Pesquisar em todos os pagamentos…" value="${esc(hist.q)}" style="margin-top:12px">
      <div class="chips" style="margin:12px 0">${chip('all', 'Todos')}${chip('paid', 'Pagos')}${chip('pending', 'Pendentes')}${chip('overdue', 'Em atraso')}</div>
      <div class="filters">
        ${sel('hist-month', 'Todos os meses', hist.month, months.map(m => [m, monthLabel(m)]))}
        ${sel('hist-issuer', 'Todas as entidades', hist.issuer, issuers.map(i => [i, i]))}
        ${sel('hist-cat', 'Todas as categorias', hist.category, cats.map(c => [c, c]))}
      </div>
      <div id="hist-body" style="margin-top:12px">${historyBody()}</div>`);
  }

  // ----- Definições -----
  async function viewSettings() {
    const list = await R.payments.list();
    const samples = list.filter(p => p.sample).length;

    // Instalação: mostra o que o browser está a ver, para se perceber porque não aparece "Instalar".
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    let swState = 'não suportado neste browser';
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      swState = reg && reg.active ? 'ativo' : 'ainda não ativo';
    }
    const ua = navigator.userAgent;
    const inApp = /FBAN|FBAV|Instagram|GSA\/|; wv\)|Line\//.test(ua);
    const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : 'outro';
    const installHtml = standalone
      ? '<div class="alert blue">A app já está instalada e a abrir em ecrã inteiro.</div>'
      : deferredInstall
        ? '<button class="btn green" data-action="install">Instalar no ecrã inicial</button>'
        : `<div class="alert">O browser ainda não ofereceu a instalação.</div>
           <p class="muted">Ligação segura (HTTPS): <b>${window.isSecureContext ? 'sim' : 'não'}</b><br>
           Service worker: <b>${swState}</b><br>
           Browser: <b>${browser}${inApp ? ' (parece estar dentro de outra app)' : ''}</b></p>
           <p class="muted">Abra este endereço diretamente no Chrome (se veio de um link dentro de outra app, copie o endereço e cole no Chrome). Depois procure "Instalar app" no menu ⋮.</p>`;

    $app.innerHTML = layout('settings', `
      <h1>Definições</h1>
      <div class="alert blue" style="margin-top:14px"><b>Privacidade</b><br>Por omissão, os seus pagamentos ficam apenas neste dispositivo. Só se criar conta (opcional) é que são guardados na nuvem, cifrados com uma frase-passe só sua. Nunca é pedido acesso ao seu email nem ao banco. Na app Android gratuita há anúncios (Google AdMob), sujeitos ao seu consentimento.<br><a href="https://dontasko.github.io/pagacerto/privacidade.html">Política de Privacidade</a> · <a href="https://dontasko.github.io/pagacerto/termos.html">Termos de Utilização</a></div>
      ${await reminderHtml()}
      ${await adsHtml()}
      ${await accountHtml()}
      ${N.isNative() ? '' : '<h2>Instalar</h2>' + installHtml}
      <h2>Dados de exemplo</h2>
      ${samples
        ? `<button class="btn secondary" data-action="clear-samples">Remover dados de exemplo (${samples})</button>`
        : `<button class="btn secondary" data-action="sample">Carregar dados de exemplo</button>`}
      <h2>Dados</h2>
      <button class="btn danger" data-action="wipe">Apagar todos os dados</button>
      <p class="muted" style="margin-top:18px">PagaCerto · versão 0.7 (versão gratuita)</p>`);
  }



  // ----- Anúncios (só na app Android gratuita) -----
  async function adsHtml() {
    if (!window.PagaAds || !window.PagaAds.isNative()) return '';
    const st = await window.PagaAds.state();
    if (!st.available || !st.enabled) return '';
    return `<h2>Anúncios</h2>
      <p class="muted">A versão gratuita mostra um banner em baixo e, de vez em quando, um anúncio de ecrã inteiro depois de guardar pagamentos. Os seus pagamentos nunca são usados para escolher anúncios.</p>
      ${st.privacyOptionsRequired ? '<button class="btn secondary small" data-action="ads-privacy">Preferências de anúncios e privacidade</button>' : ''}`;
  }

  // ----- Lembretes (só na app Android) -----
  async function reminderHtml() {
    const msg = remMsg ? `<div class="${remMsg.type === 'error' ? 'error' : 'alert blue'}">${esc(remMsg.text)}</div>` : '';
    remMsg = null;
    const st = await N.status();
    if (!st.native) {
      return `<h2>Lembretes</h2>${msg}<div class="alert">Os lembretes funcionam na app Android. No browser não são fiáveis, porque o browser não acorda em segundo plano.</div>`;
    }
    const on = await R.settings.get('remindersOn', true);
    const hour = await R.settings.get('remindHour', 9);
    if (!st.granted) {
      return `<h2>Lembretes</h2>${msg}<div class="alert">As notificações estão desligadas. Sem elas a app não o pode avisar.</div>
        <button class="btn green" data-action="rem-perm">Permitir notificações</button>`;
    }
    const opts = Array.from({ length: 16 }, (_, i) => i + 6).map(h => `<option value="${h}" ${h === hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
    return `<h2>Lembretes</h2>${msg}
      <p class="muted">${on ? st.pending + ' lembrete(s) agendado(s).' : 'Lembretes desligados.'}</p>
      <label for="rem-hour">Hora dos avisos</label>
      <select id="rem-hour" data-bind="rem-hour">${opts}</select>
      <button class="btn secondary" data-action="rem-toggle">${on ? 'Desligar lembretes' : 'Ligar lembretes'}</button>
      <button class="btn secondary small" data-action="rem-test">Enviar notificação de teste</button>`;
  }

  // ----- Conta e sincronização (opcional) -----
  async function accountHtml() {
    const info = await S.info();
    const msg = accMsg ? `<div class="${accMsg.type === 'error' ? 'error' : 'alert blue'}">${esc(accMsg.text)}</div>` : '';
    accMsg = null;
    if (recovering) {
      return `<h2>Conta e sincronização</h2>${msg}
        <div class="alert blue">Escolha a nova palavra-passe.</div>
        <label for="acc-newpass">Nova palavra-passe (mínimo 8 caracteres)</label>
        <input id="acc-newpass" type="password" autocomplete="new-password">
        <button class="btn" data-action="acc-setpass">Guardar palavra-passe</button>`;
    }
    if (info.email) {
      const ks = await S.keyStatus();
      if (ks === 'setup' || ks === 'unlock') return `<h2>Conta e sincronização</h2>${msg}
        <div class="card"><b>${esc(info.email)}</b></div>
        ${keyPanelHtml(ks)}
        <button class="btn small secondary" data-action="acc-signout">Sair da conta</button>`;
      const last = info.lastSync ? new Date(info.lastSync).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : 'ainda não';
      return `<h2>Conta e sincronização</h2>${msg}
        <div class="card"><b>${esc(info.email)}</b><br><span class="muted">Última sincronização: ${esc(last)}${info.error ? '<br>' + esc(info.error) : ''}</span></div>
        <button class="btn green" data-action="acc-sync">Sincronizar agora</button>
        <button class="btn secondary" data-action="acc-signout">Sair da conta</button>
        <button class="btn danger" data-action="acc-delete">Apagar conta e dados na nuvem</button>
        <p class="muted">Os pagamentos desta conta são guardados em servidores na Europa (Londres) para aparecerem nos seus outros dispositivos.</p>`;
    }
    return `<h2>Conta e sincronização</h2>${msg}
      <p class="muted">Opcional. Sem conta, tudo fica só neste dispositivo. Com conta, os seus pagamentos são guardados na nuvem e aparecem em todos os dispositivos onde entrar.</p>
      <label for="acc-email">Email</label>
      <input id="acc-email" type="email" autocomplete="email" value="${esc(accEmail)}">
      <label for="acc-pass">Palavra-passe (mínimo 8 caracteres)</label>
      <input id="acc-pass" type="password" autocomplete="current-password">
      <button class="btn" data-action="acc-signin">Entrar</button>
      <button class="btn secondary" data-action="acc-signup">Criar conta</button>
      <button class="btn small secondary" data-action="acc-forgot">Esqueci a palavra-passe</button>`;
  }

  let showReset = false;
  function keyPanelHtml(ks) {
    const warn = `<div class="alert"><b>Atenção:</b> a frase-passe não pode ser recuperada por nós. Se a perder, os dados guardados na nuvem ficam ilegíveis (os dispositivos onde já entrou mantêm os seus dados).</div>`;
    if (ks === 'setup' || showReset) {
      return `<div class="alert blue">${showReset ? 'Vai apagar os dados cifrados na nuvem e criar uma nova frase-passe. Os pagamentos deste dispositivo voltam a ser enviados.' : 'Para proteger os seus pagamentos, escolha uma <b>frase-passe</b>. Os dados são cifrados neste dispositivo antes de irem para a nuvem: nem nós os conseguimos ler.'}</div>
        ${warn}
        <label for="acc-pp1">Frase-passe (mínimo 10 caracteres)</label>
        <input id="acc-pp1" type="password" autocomplete="new-password">
        <label for="acc-pp2">Repita a frase-passe</label>
        <input id="acc-pp2" type="password" autocomplete="new-password">
        <button class="btn" data-action="${showReset ? 'acc-keyreset' : 'acc-keysetup'}">${showReset ? 'Apagar nuvem e criar nova frase-passe' : 'Ativar cifragem e sincronizar'}</button>
        ${showReset ? '<button class="btn small secondary" data-action="acc-keyresetcancel">Cancelar</button>' : ''}`;
    }
    return `<div class="alert blue">Introduza a frase-passe desta conta para ver e sincronizar os seus pagamentos neste dispositivo.</div>
      <label for="acc-pp1">Frase-passe</label>
      <input id="acc-pp1" type="password" autocomplete="current-password">
      <button class="btn" data-action="acc-keyunlock">Desbloquear</button>
      <button class="btn small secondary" data-action="acc-keyresetask">Perdi a frase-passe</button>`;
  }

  const accInputs = () => {
    const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    accEmail = g('acc-email').trim() || accEmail;
    return { email: accEmail, pass: g('acc-pass') };
  };
  const accFail = e => { accMsg = { type: 'error', text: e && e.message ? e.message : String(e) }; };

  // Depois de entrar: se o dispositivo tinha dados de outra conta, pergunta antes de os juntar.
  async function afterLogin(session) {
    const prev = await R.settings.get('syncUser', null);
    if (prev !== session.user_id) {
      if (prev) {
        const n = (await R.payments.list()).filter(p => !p.sample).length;
        if (n && !confirm('Este dispositivo já esteve ligado a outra conta. Os pagamentos locais serão apagados e substituídos pelos desta conta. Continuar?')) {
          await S.signOut();
          throw new Error('Entrada cancelada.');
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
      if (!text.trim()) return showFormError('Cole primeiro o texto da fatura.');
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
      if (!confirm('Eliminar este pagamento? Esta ação não pode ser desfeita.')) return;
      let ids = [id];
      const gid = p.planId || p.recurrenceId;
      if (gid && confirm('Este pagamento faz parte de um plano ou de uma repetição.\n\nOK: eliminar também os seguintes que ainda estão por pagar.\nCancelar: eliminar só este.')) {
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
      if (!confirm(cloud ? 'Apagar TODOS os pagamentos? Como tem conta, também serão apagados nos seus outros dispositivos e na nuvem. Não pode ser desfeito.' : 'Apagar TODOS os pagamentos deste dispositivo? Esta ação não pode ser desfeita.')) return;
      await R.wipeEverything(); render();
    },
    async 'rem-perm'() {
      const ok = await N.requestPermission();
      remMsg = ok ? { type: 'ok', text: 'Notificações permitidas.' } : { type: 'error', text: 'Permissão recusada. Ative em Definições do Android → Apps → PagaCerto → Notificações.' };
      await N.apply(); render();
    },
    async 'rem-toggle'() {
      await R.settings.set('remindersOn', !(await R.settings.get('remindersOn', true)));
      await N.apply(); render();
    },
    async 'ads-privacy'() { await window.PagaAds.privacyOptions(); },
    async 'rem-test'() {
      const ok = await N.sendTest();
      remMsg = ok ? { type: 'ok', text: 'Vai receber uma notificação daqui a 5 segundos. Pode sair da app para ver como aparece.' } : { type: 'error', text: 'Sem permissão para notificações.' };
      render();
    },
    async 'acc-signup'() {
      const { email, pass } = accInputs();
      if (!email || !pass) { accMsg = { type: 'error', text: 'Preencha o email e a palavra-passe.' }; return render(); }
      if (pass.length < 8) { accMsg = { type: 'error', text: 'A palavra-passe tem de ter pelo menos 8 caracteres.' }; return render(); }
      try {
        const r = await S.signUp(email, pass);
        if (r.session) await afterLogin(r.session);
        else accMsg = { type: 'ok', text: 'Enviámos um email de confirmação para ' + email + '. Abra o link (veja também o spam) e depois volte aqui para entrar.' };
      } catch (e) { accFail(e); }
      render();
    },
    async 'acc-signin'() {
      const { email, pass } = accInputs();
      if (!email || !pass) { accMsg = { type: 'error', text: 'Preencha o email e a palavra-passe.' }; return render(); }
      try { await afterLogin(await S.signIn(email, pass)); } catch (e) { accFail(e); }
      render();
    },
    async 'acc-forgot'() {
      const { email } = accInputs();
      if (!email) { accMsg = { type: 'error', text: 'Escreva primeiro o seu email.' }; return render(); }
      try { await S.recover(email); accMsg = { type: 'ok', text: 'Se existir uma conta com esse email, enviámos um link para escolher nova palavra-passe.' }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-setpass'() {
      const el = document.getElementById('acc-newpass');
      const pw = el ? el.value : '';
      if (pw.length < 8) { accMsg = { type: 'error', text: 'A palavra-passe tem de ter pelo menos 8 caracteres.' }; return render(); }
      try { await S.updatePassword(pw); recovering = false; accMsg = { type: 'ok', text: 'Palavra-passe alterada.' }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-keysetup'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '', b = (document.getElementById('acc-pp2') || {}).value || '';
      if (a !== b) { accMsg = { type: 'error', text: 'As duas frases-passe não coincidem.' }; return render(); }
      try { await S.setupPassphrase(a); accMsg = { type: 'ok', text: 'Cifragem ativada. Guarde a frase-passe num local seguro.' }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-keyunlock'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '';
      try { await S.unlock(a); accMsg = { type: 'ok', text: 'Desbloqueado. Dados sincronizados.' }; } catch (e) { accFail(e); }
      render();
    },
    'acc-keyresetask'() { showReset = true; render(); },
    'acc-keyresetcancel'() { showReset = false; render(); },
    async 'acc-keyreset'() {
      const a = (document.getElementById('acc-pp1') || {}).value || '', b = (document.getElementById('acc-pp2') || {}).value || '';
      if (a !== b) { accMsg = { type: 'error', text: 'As duas frases-passe não coincidem.' }; return render(); }
      if (!confirm('Isto apaga TODOS os pagamentos guardados na nuvem e recomeça com a nova frase-passe. Só os dados que existirem neste dispositivo voltam a ser enviados. Continuar?')) return;
      try { await S.resetEncryption(a); showReset = false; accMsg = { type: 'ok', text: 'Nova frase-passe criada.' }; } catch (e) { accFail(e); }
      render();
    },
    async 'acc-sync'() {
      const r = await S.syncNow();
      accMsg = r && r.error ? { type: 'error', text: r.offline ? 'Sem ligação à internet.' : r.error } : { type: 'ok', text: 'Sincronizado.' };
      render();
    },
    async 'acc-signout'() { await S.signOut(); showReset = false; accMsg = { type: 'ok', text: 'Saiu da conta. Os dados continuam neste dispositivo.' }; render(); },
    async 'acc-delete'() {
      if (!confirm('Apagar a conta e todos os pagamentos guardados na nuvem? Esta ação não pode ser desfeita. Os dados deste dispositivo mantêm-se.')) return;
      if (!confirm('Tem a certeza? Confirme para apagar a conta definitivamente.')) return;
      try { await S.deleteAccount(); accMsg = { type: 'ok', text: 'Conta apagada. Os pagamentos deste dispositivo mantêm-se.' }; } catch (e) { accFail(e); }
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
    'rem-hour'(val) { R.settings.set('remindHour', Number(val)).then(() => N.apply()).then(render); }
  };
  document.addEventListener('input', e => {
    const b = e.target.dataset && e.target.dataset.bind;
    if (b && binds[b]) binds[b](e.target.value);
  });

  // ---------- router ----------
  function showFatal(err) {
    console.error(err);
    $app.innerHTML = `<main><div class="error">Ocorreu um erro: ${esc(err && err.message ? err.message : err)}</div></main>`;
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
    if (e.detail && e.detail.expired) accMsg = { type: 'error', text: 'A sessão expirou. Entre novamente.' };
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
      else { try { await afterLogin(ar.session); accMsg = { type: 'ok', text: 'Conta confirmada. Sessão iniciada.' }; } catch (err) { accFail(err); } }
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
