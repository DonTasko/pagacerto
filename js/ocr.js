/* PagaCerto — ler texto de uma imagem (print, foto, PDF digitalizado) no próprio dispositivo.
 * tesseract.js (em lib/ocr, sem CDN). A imagem nunca sai do dispositivo; o texto lido segue para o parser de faturas.
 * Só se carrega (≈4 MB) quando o utilizador usa esta função pela primeira vez.
 */
(function (root) {
  'use strict';
  const BASE = () => new URL('lib/ocr/', document.baseURI).href;
  const MAX_SIDE = 2600;     // imagens maiores são reduzidas (memória do telemóvel)
  const MIN_WIDTH = 1400;    // imagens pequenas (prints) são ampliadas: o OCR lê melhor com letra grande
  let libPromise = null, worker = null, busy = Promise.resolve();

  class OcrError extends Error { constructor(message, code) { super(message); this.code = code; } }

  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = BASE() + 'tesseract.min.js';
        s.onload = () => resolve(root.Tesseract);
        s.onerror = () => reject(new OcrError('Não foi possível carregar o leitor de imagens.', 'load'));
        document.head.appendChild(s);
      });
      libPromise.catch(() => { libPromise = null; });
    }
    return libPromise;
  }

  async function getWorker(onProgress) {
    if (worker) return worker;
    const T = await loadLib();
    worker = await T.createWorker('por', 1, {
      workerPath: BASE() + 'worker.min.js',
      corePath: BASE().replace(/\/$/, ''),
      langPath: BASE().replace(/\/$/, ''),
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: m => { if (onProgress && m && m.status === 'recognizing text') onProgress(m.progress); }
    });
    return worker;
  }

  async function terminate() {
    const w = worker; worker = null;
    if (w) { try { await w.terminate(); } catch (e) { /* já terminado */ } }
  }

  // Imagem (File/Blob) -> canvas em tons de cinzento, com contraste melhorado e tamanho adequado.
  async function prepare(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) { throw new OcrError('Não foi possível abrir a imagem.', 'image'); }
    const long = Math.max(bmp.width, bmp.height);
    let scale = 1;
    if (long > MAX_SIDE) scale = MAX_SIDE / long;
    else if (bmp.width < MIN_WIDTH) scale = Math.min(MIN_WIDTH / bmp.width, 3);
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // fundo branco (PNG com transparência)
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    // Fundo escuro (modo escuro do telemóvel)? Decide-se pela luminosidade média.
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    const invert = lum / (w * h) < 110;
    // Tons de cinzento que mantêm visíveis os textos coloridos (logótipos a vermelho, azul...):
    // fundo claro -> canal mais escuro; fundo escuro -> canal mais claro.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g1 = d[i + 1], b = d[i + 2];
      const g = invert ? Math.max(r, g1, b) : Math.min(r, g1, b);
      d[i] = g; hist[g]++;
    }
    // esticar o contraste (ignora 1% de extremos)
    const total = w * h; let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      let g = Math.max(0, Math.min(255, ((d[i] - lo) * 255 / span) | 0));
      if (invert) g = 255 - g;
      d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Limpeza leve do texto lido: tira linhas só de ruído e normaliza espaços.
  function clean(text) {
    return String(text || '').replace(/\r/g, '').split('\n')
      .map(l => l.replace(/[|¦]/g, ' ').replace(/[ \t]+/g, ' ').trim())
      .filter(l => /[A-Za-z0-9À-ÿ]{2}/.test(l))
      .join('\n');
  }

  /** source: File | Blob | HTMLCanvasElement. onProgress(0..1). Devolve o texto lido ('' se nada). */
  function recognize(source, onProgress) {
    const run = async () => {
      const canvas = source instanceof HTMLCanvasElement ? source : await prepare(source);
      const w = await getWorker(onProgress);
      try {
        const res = await w.recognize(canvas);
        return clean(res && res.data && res.data.text);
      } catch (e) {
        await terminate();
        throw new OcrError('Não foi possível ler a imagem.', 'read');
      } finally {
        if (canvas.width) { canvas.width = 1; canvas.height = 1; }
      }
    };
    busy = busy.then(run, run);  // uma leitura de cada vez
    return busy;
  }

  root.PagaOcr = { recognize, terminate, OcrError, clean };
}(typeof self !== 'undefined' ? self : this));
