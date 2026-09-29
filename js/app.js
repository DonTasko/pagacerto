/* PagaCerto — interface. Sem frameworks: rotas por hash, HTML em template strings.
 * TODO texto do utilizador passa por esc() antes de entrar em innerHTML.
 */
(function () {
  'use strict';
  const P = window.PagaParser, M = window.PagaModels, R = window.PagaRepo;
  const $app = document.getElementById('app');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Rascunho vindo de "colar texto" / partilha: { payment, confidence, warnings }
  let draft = null;
  let listFilter = 'open';

  const REMIND_LABEL = { 0: 'No próprio dia', 1: '1 dia antes', 3: '3 dias antes', 5: '5 dias antes', 7: '7 dias antes' };

  // ---------- ponto de entrada para partilha (Android/PWA chamam isto) ----------
  async function handleSharedText(text, subject) {
    const entities = await R.entities.map();
    const res = P.parseInvoiceText(text, { subject: subject || '', knownEntities: entities });
    const f = res.fields;
    const p = M.emptyPayment();
    Object.assign(p, {
      issuer: f.issuer, amountCents: f.amountCents, dueDate: f.dueDate, entity: f.entity,
      reference: f.reference, iban: f.iban, invoiceNumber: f.invoiceNumber, category: f.category,
      installmentNo: f.installmentNo, installmentTotal: f.installmentTotal,
      description: subject || ''
    });
    draft = { payment: p, confidence: res.confidence, warnings: res.warnings, fromParse: true };
    if (location.hash === '#/new') render(); else location.hash = '#/new';
  }
  window.PagaApp = { handleSharedText };

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

  function paymentItem(p, today) {
    const st = M.effectiveStatus(p, today);
    const inst = M.installmentLabel(p);
    return `<a class="item card" href="#/p/${esc(p.id)}"><div class="row">
      <span class="dot ${st}"></span>
      <div class="grow"><div class="title">${esc(p.issuer || 'Sem nome')}</div>
        <div class="sub">${inst ? esc(inst) + ' · ' : ''}${M.formatDate(p.dueDate)}</div></div>
      <div class="amount">${M.formatEUR(p.amountCents)}</div></div></a>`;
  }

  const plural = (n, one, many) => n === 1 ? one : many;

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

  async function viewPayments() {
    const list = await R.payments.list();
    const today = M.todayISO();
    const filtered = list.filter(p => listFilter === 'all' ? true : listFilter === 'paid' ? p.status === 'paid' : p.status !== 'paid');
    if (listFilter === 'paid') filtered.reverse();
    const chip = (key, label) => `<button class="chip ${listFilter === key ? 'active' : ''}" data-action="filter" data-arg="${key}">${label}</button>`;
    $app.innerHTML = layout('payments', `
      <h1>Pagamentos</h1>
      <div class="chips" style="margin:12px 0">${chip('open', 'Por pagar')}${chip('paid', 'Pagos')}${chip('all', 'Todos')}</div>
      ${filtered.length ? filtered.map(p => paymentItem(p, today)).join('') : '<div class="empty">Nada por aqui.</div>'}`);
  }

  async function viewDetail(id) {
    const p = await R.payments.get(id);
    if (!p) { location.hash = '#/payments'; return; }
    const st = M.effectiveStatus(p);
    const row = (label, val) => val ? `<dt>${label}</dt><dd>${esc(val)}</dd>` : '';
    const paidInfo = p.paidAt ? new Date(p.paidAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '';
    $app.innerHTML = layout('payments', `
      <a href="#/payments" class="muted">← Pagamentos</a>
      <div class="card" style="margin-top:12px">
        <div class="row"><h1 class="grow" style="margin:0">${esc(p.issuer || 'Sem nome')}</h1><span class="badge ${st}">${M.STATUS_LABEL[st]}</span></div>
        <div class="amount" style="font-size:28px;margin:6px 0 0">${M.formatEUR(p.amountCents)}</div>
        <dl class="detail" style="margin:0">
          ${row('Vencimento', M.formatDate(p.dueDate))}
          ${row('Prestação', M.installmentLabel(p))}
          ${row('Entidade', p.entity)}
          ${row('Referência', p.reference ? p.reference.replace(/(\d{3})(?=\d)/g, '$1 ') : '')}
          ${row('IBAN', p.iban)}
          ${row('Número da fatura', p.invoiceNumber)}
          ${row('Categoria', p.category)}
          ${row('Descrição', p.description)}
          ${row('Notas', p.notes)}
          ${row('Pago em', paidInfo)}
          ${row('Lembretes', (p.remindDays || []).length ? p.remindDays.map(d => REMIND_LABEL[d]).join(', ') : 'Sem lembretes')}
        </dl></div>
      ${p.status === 'paid'
        ? `<button class="btn secondary" data-action="reopen" data-arg="${esc(p.id)}">Reabrir (voltar a pendente)</button>`
        : `<button class="btn green" data-action="pay" data-arg="${esc(p.id)}">Marcar como pago</button>`}
      <a class="btn secondary" href="#/edit/${esc(p.id)}">Editar</a>
      <button class="btn danger" data-action="delete" data-arg="${esc(p.id)}">Eliminar</button>`);
  }

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
      parsed = true;
    } else {
      p = M.emptyPayment();
    }
    const cats = await R.categories.list();
    const low = k => conf[k] === 'low';
    const isInst = !!(p.installmentNo && p.installmentTotal);

    const paste = existingId ? '' : `
      <div class="card">
        <label for="f-paste" style="margin-top:0">Colar texto da fatura</label>
        <textarea id="f-paste" placeholder="Cole aqui o texto do email ou da fatura. O PagaCerto tenta preencher os campos, e você confirma."></textarea>
        <button class="btn secondary small" data-action="parse">Reconhecer dados</button>
      </div>`;

    const found = parsed ? `<div class="alert blue"><b>PAGAMENTO ENCONTRADO</b><br>Confira cada campo antes de guardar. Os campos a laranja precisam da sua confirmação.</div>` : '';
    const warn = warnings && warnings.length ? `<div class="alert">${warnings.map(w => esc(w)).join('<br>')}</div>` : '';

    $app.innerHTML = layout('payments', `
      <a href="#/${existingId ? 'p/' + esc(existingId) : ''}" class="muted" data-action="cancel">← Cancelar</a>
      <h1 style="margin-top:8px">${existingId ? 'Editar pagamento' : 'Novo pagamento'}</h1>
      ${paste}${found}${warn}
      <div id="form-error" role="alert"></div>
      <form id="pay-form" novalidate>
        ${fieldHtml('f-issuer', 'Nome / Emissor', p.issuer, { parsed, low: low('issuer'), ph: 'Ex.: Vodafone' })}
        ${fieldHtml('f-amount', 'Valor (€)', M.centsToInput(p.amountCents), { parsed, low: low('amountCents'), mode: 'decimal', ph: '0,00' })}
        ${fieldHtml('f-due', 'Data de vencimento', p.dueDate, { parsed, low: low('dueDate'), type: 'date' })}
        ${fieldHtml('f-entity', 'Entidade (Multibanco, 5 dígitos)', p.entity, { parsed, low: low('entity'), mode: 'numeric' })}
        ${fieldHtml('f-ref', 'Referência (Multibanco, 9 dígitos)', p.reference ? p.reference.replace(/(\d{3})(?=\d)/g, '$1 ') : '', { parsed, low: low('reference'), mode: 'numeric' })}
        ${fieldHtml('f-iban', 'IBAN (opcional)', p.iban, { parsed: parsed && !!p.iban, low: low('iban') })}
        ${fieldHtml('f-inv', 'Número da fatura (opcional)', p.invoiceNumber, { parsed: parsed && !!p.invoiceNumber, low: low('invoiceNumber') })}
        ${fieldHtml('f-desc', 'Descrição (opcional)', p.description)}
        <label for="f-cat">Categoria</label>
        <select id="f-cat"><option value="">—</option>${cats.map(c => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label for="f-notes">Notas (opcional)</label>
        <textarea id="f-notes" style="min-height:64px">${esc(p.notes)}</textarea>

        <label class="check"><input type="checkbox" id="f-inst" ${isInst ? 'checked' : ''}> É uma prestação</label>
        <div id="inst-box" class="inline" style="${isInst ? '' : 'display:none'}">
          <input id="f-inst-no" type="number" min="1" inputmode="numeric" placeholder="3" value="${p.installmentNo || ''}">
          <span>de</span>
          <input id="f-inst-total" type="number" min="1" inputmode="numeric" placeholder="12" value="${p.installmentTotal || ''}">
        </div>

        <label class="check"><input type="checkbox" id="f-remind" ${(p.remindDays || []).length ? 'checked' : ''}> Criar lembrete</label>
        <div class="chips">${M.REMIND_OPTIONS.map(d =>
          `<label class="chip"><input type="checkbox" class="f-rd" value="${d}" ${(p.remindDays || []).includes(d) ? 'checked' : ''}>${REMIND_LABEL[d]}</label>`).join('')}</div>
        <button type="submit" class="btn" style="margin-top:22px">${existingId ? 'GUARDAR' : 'ADICIONAR PAGAMENTO'}</button>
      </form>`, { noFab: true });

    const inst = document.getElementById('f-inst');
    inst.addEventListener('change', () => { document.getElementById('inst-box').style.display = inst.checked ? '' : 'none'; });
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
    const entity = v('f-entity').replace(/\s/g, '');
    const reference = v('f-ref').replace(/[\s.]/g, '');
    const iban = v('f-iban').replace(/\s/g, '').toUpperCase();
    const isInst = document.getElementById('f-inst').checked;
    const instNo = parseInt(v('f-inst-no'), 10), instTotal = parseInt(v('f-inst-total'), 10);

    if (!v('f-issuer')) return showFormError('Indique o nome de quem emite o pagamento.');
    if (cents == null || cents <= 0) return showFormError('Indique um valor válido, por exemplo 87,43.');
    if (!due) return showFormError('Indique a data de vencimento.');
    if (entity && !/^\d{5}$/.test(entity)) return showFormError('A entidade Multibanco tem 5 dígitos.');
    if (reference && !/^\d{9}$/.test(reference)) return showFormError('A referência Multibanco tem 9 dígitos.');
    if (iban && !P.ibanValid(iban)) return showFormError('O IBAN não é válido. Confirme cada dígito ou apague o campo.');
    if (isInst && !(instNo >= 1 && instTotal >= instNo)) return showFormError('Indique a prestação, por exemplo 3 de 12.');

    const remind = document.getElementById('f-remind').checked
      ? Array.from(document.querySelectorAll('.f-rd:checked')).map(x => +x.value).sort((a, b) => b - a) : [];

    const out = Object.assign({}, base, {
      issuer: v('f-issuer'), amountCents: cents, dueDate: due, entity, reference, iban,
      invoiceNumber: v('f-inv'), description: v('f-desc'), category: document.getElementById('f-cat').value,
      notes: v('f-notes'), installmentNo: isInst ? instNo : null, installmentTotal: isInst ? instTotal : null,
      remindDays: remind, status: existing ? existing.status : 'pending'
    });
    delete out.sample;
    await R.payments.save(out);
    if (entity) await R.entities.remember(entity, out.issuer); // aprende "12345 = EDP"
    draft = null;
    location.hash = existing ? '#/p/' + out.id : '#/';
  }

  async function viewSettings() {
    const list = await R.payments.list();
    const samples = list.filter(p => p.sample).length;
    $app.innerHTML = layout('settings', `
      <h1>Definições</h1>
      <div class="alert blue" style="margin-top:14px"><b>Privacidade</b><br>Os seus pagamentos ficam apenas neste dispositivo. Nada é enviado para servidores e não é pedido acesso ao email nem ao banco.</div>
      <h2>Dados de exemplo</h2>
      ${samples
        ? `<button class="btn secondary" data-action="clear-samples">Remover dados de exemplo (${samples})</button>`
        : `<button class="btn secondary" data-action="sample">Carregar dados de exemplo</button>`}
      <h2>Dados</h2>
      <button class="btn danger" data-action="wipe">Apagar todos os dados</button>
      <p class="muted" style="margin-top:18px">PagaCerto · versão 0.1 (fase 1)</p>`);
  }

  function viewSoon(active, title, text) {
    $app.innerHTML = layout(active, `<h1>${title}</h1><div class="empty">${text}</div>`);
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
    async pay(id) { await R.payments.markPaid(id); render(); },
    async reopen(id) { await R.payments.reopen(id); render(); },
    async delete(id) {
      if (!confirm('Eliminar este pagamento? Esta ação não pode ser desfeita.')) return;
      await R.payments.remove(id); location.hash = '#/payments';
    },
    async sample() { await R.seedSamples(); render(); },
    async 'clear-samples'() { await R.payments.removeSamples(); render(); },
    async wipe() {
      if (!confirm('Apagar TODOS os pagamentos deste dispositivo? Esta ação não pode ser desfeita.')) return;
      await R.wipeEverything(); render();
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
        case 'calendar': return viewSoon('calendar', 'Calendário', 'Chega na fase 3.');
        case 'history': return viewSoon('history', 'Histórico', 'Chega na fase 3.');
        case 'settings': return await viewSettings();
        default: location.hash = '#/';
      }
    } catch (err) { showFatal(err); }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  // Partilha via PWA (share_target, método GET): ?title=...&text=...
  async function boot() {
    const q = new URLSearchParams(location.search);
    const shared = [q.get('text'), q.get('url')].filter(Boolean).join('\n');
    if (shared || q.get('title')) {
      history.replaceState(null, '', location.pathname);
      await R.settings.set('onboarded', true); // veio de uma partilha: não interromper com o ecrã de boas-vindas
      await handleSharedText(shared, q.get('title') || '');
      return;
    }
    render();
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot().catch(showFatal);
}());
