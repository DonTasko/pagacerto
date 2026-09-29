/* PagaCerto — extrair texto de um PDF, no próprio dispositivo (pdf.js da Mozilla, incluído em lib/pdfjs, sem CDN).
 * O PDF nunca sai do dispositivo. PDFs que são só imagem (digitalizados) não têm texto: pede-se foto/OCR (fase seguinte).
 */
(function (root) {
  'use strict';
  let libPromise = null;

  function base() { return new URL('lib/pdfjs/', document.baseURI).href; }

  function load() {
    if (!libPromise) {
      libPromise = import(base() + 'pdf.min.mjs').then(lib => {
        lib.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs';
        return lib;
      });
      libPromise.catch(() => { libPromise = null; });
    }
    return libPromise;
  }

  class PdfError extends Error { constructor(message, code) { super(message); this.code = code; } }

  // Junta os pedaços de texto em linhas (mesma altura = mesma linha, da esquerda para a direita).
  function linesOf(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map(r => {
      r.parts.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const p of r.parts) {
        if (end !== null && p.x - end > 1.5) out += ' ';
        out += p.s;
        end = p.x + p.w;
      }
      return out.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  /** bytes: Uint8Array | ArrayBuffer. askPassword(wrong:boolean) => string | null (null = cancelar). */
  async function extractText(bytes, askPassword) {
    const lib = await load();
    const task = lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false });
    let cancelled = false;
    task.onPassword = (update, reason) => {
      const pw = askPassword ? askPassword(reason === lib.PasswordResponses.INCORRECT_PASSWORD) : null;
      if (pw == null || pw === '') { cancelled = true; task.destroy(); } else update(pw);
    };
    let pdf;
    try {
      pdf = await task.promise;
    } catch (e) {
      if (cancelled) throw new PdfError('Importação cancelada: o PDF tem palavra-passe.', 'password');
      if (e && e.name === 'InvalidPDFException') throw new PdfError('Este ficheiro não parece ser um PDF válido.', 'invalid');
      throw new PdfError('Não foi possível ler o PDF.', 'read');
    }
    const pages = [];
    const n = Math.min(pdf.numPages, 10); // faturas têm poucas páginas
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(linesOf(content.items).join('\n'));
    }
    try { await task.destroy(); } catch (e) { /* já libertado */ }
    return pages.join('\n\n').trim();
  }

  root.PagaPdf = { extractText, PdfError };
}(typeof self !== 'undefined' ? self : this));
