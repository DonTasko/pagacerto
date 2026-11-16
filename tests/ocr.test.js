const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('ocr.js e pdftext.js têm sintaxe válida e exportam PagaOcr', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ocr.js'), 'utf8');
  assert.match(src, /root\.PagaOcr\s*=/);
  new Function(src);
});

test('ficheiros OCR existem e batem com SHA256SUMS', () => {
  const dir = path.join(__dirname, '..', 'lib', 'ocr');
  const crypto = require('crypto');
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.ok(sums.length >= 5);
  for (const line of sums) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, m[2]))).digest('hex');
    assert.strictEqual(h, m[1], m[2]);
  }
});

test('sw.js lista ocr.js na shell', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /js\/ocr\.js/);
});
