/* PagaCerto — parser de texto de faturas em português de Portugal.
 * Funciona no browser (window.PagaParser) e em Node (require), sem dependências.
 *
 * parseInvoiceText(texto, opções) devolve:
 *   { fields, confidence, warnings }
 * - fields: issuer, amountCents, dueDate (AAAA-MM-DD), invoiceDate, entity, reference,
 *           iban, ibanValid, invoiceNumber, installmentNo, installmentTotal, category
 * - confidence[campo]: 'high' | 'low'  (low => a interface pede confirmação explícita)
 * Campos não encontrados ficam vazios (''/null). Nunca se inventa um valor.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagaParser = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- utilitários ----------
  const pad = n => String(n).padStart(2, '0');

  function isValidDate(y, m, d) {
    if (y < 2000 || y > 2100) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function normalize(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  // "87,43" | "€87.43" | "1.234,56" | "87 EUR" -> cêntimos (inteiro) ou null
  function parseAmountToCents(str) {
    if (str == null) return null;
    let s = String(str).replace(/[€\s]|EUR|euros?/gi, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [int, dec = ''] = s.split('.');
    return parseInt(int, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  }

  function ibanValid(iban) {
    const s = String(iban || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    if (s.startsWith('PT') && s.length !== 25) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of r) {
      const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const d of v) rem = (rem * 10 + Number(d)) % 97;
    }
    return rem === 1;
  }

  // texto imediatamente antes de idx, na mesma linha, sem passar de "limit"
  function ctxBefore(text, idx, len, limit) {
    let start = Math.max(0, idx - len, limit || 0);
    const nl = text.lastIndexOf('\n', idx - 1);
    if (idx > 0 && nl >= start) start = nl + 1;
    return text.slice(start, idx).toLowerCase();
  }

  // ---------- valor ----------
  const NUM = '(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const AMOUNT_CUR = new RegExp('(?:€|EUR)\\s*(' + NUM + ')(?![\\d])|(' + NUM + ')\\s*(?:€|EUR\\b|euros?\\b)', 'gi');
  const AMOUNT_LABELED = new RegExp('(total\\s+a\\s+pagar|valor\\s+a\\s+pagar|montante(?:\\s+a\\s+pagar)?|valor|total)\\s*[:\\-]?\\s*(' + NUM + ')(?![\\d/.\\-])', 'gi');

  function scoreAmountCtx(ctx) {
    let score = 0;
    if (/total\s+a\s+pagar|valor\s+a\s+pagar|montante\s+a\s+pagar|a\s+pagar/.test(ctx)) score = 6;
    else if (/montante|valor|total|pagar/.test(ctx)) score = 3;
    if (/\biva\b|desconto|juros|taxa|multa|coima|poupan|saldo|anterior/.test(ctx)) score -= 4;
    return score;
  }

  function findAmount(text) {
    const cands = [];
    let m;
    AMOUNT_CUR.lastIndex = 0;
    while ((m = AMOUNT_CUR.exec(text))) {
      const cents = parseAmountToCents(m[1] || m[2]);
      if (cents == null) continue;
      cands.push({ cents, score: scoreAmountCtx(ctxBefore(text, m.index, 35)), index: m.index });
    }
    if (!cands.length) {
      AMOUNT_LABELED.lastIndex = 0;
      while ((m = AMOUNT_LABELED.exec(text))) {
        const cents = parseAmountToCents(m[2]);
        if (cents == null) continue;
        cands.push({ cents, score: 1, index: m.index, noCurrency: true });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score || a.index - b.index);
    const best = cands[0];
    const rival = cands.find(c => c.cents !== best.cents && c.score === best.score);
    return { cents: best.cents, high: best.score >= 3 && !rival && !best.noCurrency, ambiguous: !!rival };
  }

  // ---------- datas ----------
  const MONTHS = {
    janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
    agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12
  };

  function findDates(text) {
    const found = [];
    let m;
    const numeric = /(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?!\d)/g;
    while ((m = numeric.exec(text))) {
      const d = +m[1], mo = +m[2], y = +m[3];
      if (isValidDate(y, mo, d)) found.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, end: m.index + m[0].length });
    }
    const isoRe = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
    while ((m = isoRe.exec(text))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (isValidDate(y, mo, d)) found.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, end: m.index + m[0].length });
    }
    const textual = /(?<!\d)(\d{1,2})\s+(?:de\s+)?([A-Za-zçÇ]{3,9})\.?\s+(?:de\s+)?(\d{4})(?!\d)/g;
    while ((m = textual.exec(text))) {
      const mo = MONTHS[m[2].toLowerCase()];
      const d = +m[1], y = +m[3];
      if (mo && isValidDate(y, mo, d)) found.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index, end: m.index + m[0].length });
    }
    return found.sort((a, b) => a.index - b.index);
  }

  const DUE_RE = /vencimento|vence\b|vencimen|venc\.|data\s+limite|limite|pagar\s+at[ée]|pagamento\s+at[ée]|at[ée]\s+ao\s+dia|prazo/;
  const ISSUE_RE = /emiss[ãa]o|emitid|data\s+da\s+fatura|fatura\s+de\b|data\s+do\s+documento/;

  function findDates2(text) {
    const dates = findDates(text);
    let prevEnd = 0;
    for (const d of dates) {
      const ctx = ctxBefore(text, d.index, 40, prevEnd);
      d.due = DUE_RE.test(ctx);
      d.issue = ISSUE_RE.test(ctx) && !d.due;
      prevEnd = d.end;
    }
    let due = null, invoice = null;
    const dueC = dates.filter(d => d.due);
    if (dueC.length) due = { iso: dueC[0].iso, high: true };
    const issC = dates.filter(d => d.issue);
    if (issC.length) invoice = issC[0].iso;
    if (!due) {
      const rest = dates.filter(d => !d.issue);
      if (rest.length === 1) due = { iso: rest[0].iso, high: false };
      else if (rest.length > 1) due = { iso: rest[rest.length - 1].iso, high: false, ambiguous: true };
    }
    return { due, invoice };
  }

  // ---------- entidade / referência Multibanco ----------
  function findEntity(text) {
    let m = /\bentidade(?:\s+(?:multibanco|mb))?\s*[:\-]?\s*(\d{5})(?!\d)/i.exec(text);
    if (!m) m = /\bent\.?\s*[:\-]\s*(\d{5})(?!\d)/i.exec(text);
    return m ? m[1] : '';
  }

  const NOT_A_REFERENCE = /tel|telem|telef|contacto|contato|nif|nipc|contribuinte|cliente|contrato|apoio|linha|fax|conta\s+n/;

  function findReference(text, hasEntity) {
    const labeled = /\b(?:refer[êe]ncia|ref\.?)(?:\s+(?:multibanco|mb|de\s+pagamento|pagamento))?\s*[:\-]?\s*(\d(?:[ .]?\d){8})(?!\d)/i.exec(text);
    if (labeled) return { value: labeled[1].replace(/\D/g, ''), high: true };
    if (!hasEntity) return null;
    const re = /(?<!\d)(\d{3}) (\d{3}) (\d{3})(?!\d)/g;
    let m;
    while ((m = re.exec(text))) {
      const ctx = ctxBefore(text, m.index, 40);
      if (NOT_A_REFERENCE.test(ctx)) continue;
      const v = m[1] + m[2] + m[3];
      if (/^(2|9[1236])/.test(v)) continue; // parece número de telefone
      return { value: v, high: false };
    }
    return null;
  }

  // ---------- IBAN ----------
  function findIban(text) {
    const m = /(?<![A-Za-z0-9])(PT\s?\d{2}(?: ?\d){21})(?!\d)/i.exec(text);
    if (!m) return null;
    const iban = m[1].replace(/\s/g, '').toUpperCase();
    return { iban, valid: ibanValid(iban) };
  }

  // ---------- nº de fatura ----------
  function findInvoiceNumber(text) {
    const labeled = /(?:n[úu]mero\s+(?:da|de)\s+fatura|n(?:\.?[º°]|\.º)\s*(?:da|de)?\s*fatura|fatura\s+n(?:\.?[º°]|\.º|úmero))\s*[:\-]?\s*([A-Za-z]{0,3} ?[\dA-Za-z][\w\/\-]*)/i.exec(text);
    if (labeled) return { value: labeled[1].replace(/[.\-\/]+$/, '').trim(), high: true };
    const series = /\b(F[TRSA]|NC|ND)\s?(\d{4}\/\d+)\b/.exec(text);
    if (series) return { value: `${series[1]} ${series[2]}`, high: false };
    return null;
  }

  // ---------- prestações ----------
  function findInstallment(text) {
    let m = /presta[çc][ãa]o\s*(?:n[º°.]*\s*)?(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})/i.exec(text);
    if (!m) m = /(?<!\d)(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})\s*presta/i.exec(text);
    if (!m) return null;
    const no = +m[1], total = +m[2];
    if (no < 1 || total < 1 || no > total) return null;
    return { no, total };
  }

  // ---------- emissor ----------
  const KNOWN_ISSUERS = [
    [/\bEDP\b/, 'EDP', 'Eletricidade'],
    [/vodafone/i, 'Vodafone', 'Telecomunicações'],
    [/\bMEO\b/, 'MEO', 'Telecomunicações'],
    [/\bNOS\b/, 'NOS', 'Telecomunicações'],
    [/\bNOWO\b/i, 'NOWO', 'Telecomunicações'],
    [/endesa/i, 'Endesa', 'Eletricidade'],
    [/iberdrola/i, 'Iberdrola', 'Eletricidade'],
    [/\bgalp\b/i, 'Galp', 'Casa'],
    [/seguran[çc]a\s+social/i, 'Segurança Social', 'Segurança Social'],
    [/autoridade\s+tribut[áa]ria|portal\s+das\s+finan[çc]as/i, 'Autoridade Tributária', 'Impostos'],
    [/via\s+verde/i, 'Via Verde', 'Outros'],
    [/fidelidade|tranquilidade|allianz|ageas/i, null, 'Seguros']
  ];

  function findIssuer(text, opts, entity) {
    if (entity && opts.knownEntities && opts.knownEntities[entity]) {
      return { name: opts.knownEntities[entity], high: true, source: 'learned' };
    }
    const labeled = /(?:entidade\s+emissora|emissor|fornecedor|credor)\s*:\s*([^\n]{2,60})/i.exec(text);
    if (labeled) return { name: labeled[1].trim().replace(/[.,;]+$/, ''), high: true };
    const hay = (opts.subject ? opts.subject + '\n' : '') + text;
    for (const [re, name] of KNOWN_ISSUERS) {
      const m = re.exec(hay);
      if (m && name) return { name, high: true };
      if (m && !name) return { name: m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase(), high: false };
    }
    return null;
  }

  function categoryFor(issuerName) {
    for (const [, name, cat] of KNOWN_ISSUERS) if (name && name === issuerName) return cat;
    return '';
  }

  // ---------- API principal ----------
  function parseInvoiceText(input, opts) {
    opts = opts || {};
    const text = normalize(input);
    const warnings = [];
    const confidence = {};

    const amount = findAmount(text);
    const dates = findDates2(text);
    const entity = findEntity(text);
    const ref = findReference(text, !!entity);
    const iban = findIban(text);
    const inv = findInvoiceNumber(text);
    const inst = findInstallment(text);
    const issuer = findIssuer(text, opts, entity);

    const fields = {
      issuer: issuer ? issuer.name : '',
      amountCents: amount ? amount.cents : null,
      dueDate: dates.due ? dates.due.iso : '',
      invoiceDate: dates.invoice || '',
      entity: entity,
      reference: ref ? ref.value : '',
      iban: iban ? iban.iban : '',
      ibanValid: iban ? iban.valid : null,
      invoiceNumber: inv ? inv.value : '',
      installmentNo: inst ? inst.no : null,
      installmentTotal: inst ? inst.total : null,
      category: issuer ? categoryFor(issuer.name) : ''
    };

    confidence.issuer = issuer && issuer.high ? 'high' : 'low';
    confidence.amountCents = amount && amount.high ? 'high' : 'low';
    confidence.dueDate = dates.due && dates.due.high ? 'high' : 'low';
    confidence.entity = entity ? 'high' : 'low';
    confidence.reference = ref && ref.high ? 'high' : 'low';
    confidence.iban = iban && iban.valid ? 'high' : 'low';
    confidence.invoiceNumber = inv && inv.high ? 'high' : 'low';
    confidence.category = 'low';

    if (amount && amount.ambiguous) warnings.push('Foram encontrados vários valores. Confirme qual é o total a pagar.');
    if (dates.due && dates.due.ambiguous) warnings.push('Foram encontradas várias datas. Confirme a data de vencimento.');
    if (ref && !ref.high) warnings.push('A referência não tinha etiqueta. Confirme se é mesmo a referência Multibanco.');
    if (iban && !iban.valid) warnings.push('O IBAN encontrado não passa a validação. Confirme cada dígito.');
    if (entity && !ref) warnings.push('Foi encontrada a entidade, mas não a referência Multibanco.');

    return { fields, confidence, warnings };
  }

  return { parseInvoiceText, parseAmountToCents, ibanValid, findDates };
}));
