/* PagaCerto — extrair texto de um PDF, no próprio dispositivo (pdf.js da Mozilla, incluído em lib/pdfjs, sem CDN).
 * O PDF nunca sai do dispositivo. PDFs que são só imagem (digitalizados) são lidos com o OCR (js/ocr.js), se for passado.
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
  async function extractText(bytes, askPassword, ocr) {
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
    let text = pages.join('\n\n').trim();
    // PDF digitalizado (só imagem): desenha as primeiras páginas e lê-as com o OCR do dispositivo.
    if (!text && ocr) {
      const outs = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 2200 / Math.max(base.width, 1)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        outs.push(await ocr(canvas));
      }
      text = outs.join('\n\n').trim();
    }
    try { await task.destroy(); } catch (e) { /* já libertado */ }
    return text;
  }

  root.PagaPdf = { extractText, PdfError };
}(typeof self !== 'undefined' ? self : this));
