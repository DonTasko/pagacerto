const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const M = require('../js/mail.js');

const b64 = buf => Buffer.from(buf).toString('base64').replace(/(.{76})/g, '$1\r\n');

function eml() {
  const pdf1 = Buffer.from('%PDF-1.4 um');
  const pdf2 = Buffer.from('%PDF-1.4 dois');
  return Buffer.from([
    'From: =?utf-8?Q?Contabilidade_Jos=C3=A9?= <conta@exemplo.pt>',
    'Subject: =?utf-8?B?UGFnYW1lbnRvcyBhbyBFc3RhZG8gLSBPdXR1YnJv?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="AAA"',
    '',
    'preâmbulo',
    '--AAA',
    'Content-Type: multipart/alternative; boundary="BBB"',
    '',
    '--BBB',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Seguem os pagamentos de Outubro. Total =E2=82=AC 1.234,56',
    '--BBB',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>html</p>',
    '--BBB--',
    '--AAA',
    'Content-Type: application/pdf; name="IVA 2026-10.pdf"',
    'Content-Disposition: attachment; filename="IVA 2026-10.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(pdf1),
    '--AAA',
    'Content-Type: application/pdf',
    "Content-Disposition: attachment; filename*=utf-8''Seguran%C3%A7a%20Social.pdf",
    'Content-Transfer-Encoding: base64',
    '',
    b64(pdf2),
    '--AAA--',
    ''
  ].join('\r\n'), 'latin1');
}

test('parseEml: assunto, texto e anexos (base64, QP, RFC 2231)', () => {
  const r = M.parseEml(new Uint8Array(eml()));
  assert.strictEqual(r.subject, 'Pagamentos ao Estado - Outubro');
  assert.match(r.from, /José/);
  assert.match(r.text, /Total € 1\.234,56/);
  assert.strictEqual(r.attachments.length, 2);
  assert.strictEqual(r.attachments[0].name, 'IVA 2026-10.pdf');
  assert.strictEqual(Buffer.from(r.attachments[0].bytes).toString(), '%PDF-1.4 um');
  assert.strictEqual(r.attachments[1].name, 'Segurança Social.pdf');
  assert.strictEqual(Buffer.from(r.attachments[1].bytes).toString(), '%PDF-1.4 dois');
});

test('parseEml: email só com HTML devolve texto limpo', () => {
  const r = M.parseEml(new Uint8Array(Buffer.from('Subject: x\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<div>Olá<br>Total&nbsp;10 &euro;</div><style>a{}</style>')));
  assert.match(r.text, /Olá\nTotal 10 €/);
  assert.strictEqual(r.attachments.length, 0);
});

function zip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, data, method] of files) {
    const nb = Buffer.from(name), comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

test('readZip: guardado e deflate, ignora pastas e __MACOSX', async () => {
  const z = zip([
    ['pasta/a.pdf', Buffer.from('AAAA'), 0],
    ['b.pdf', Buffer.from('B'.repeat(5000)), 8],
    ['__MACOSX/._b.pdf', Buffer.from('x'), 0],
    ['pasta/', Buffer.alloc(0), 0]
  ]);
  const r = await M.readZip(z);
  assert.deepStrictEqual(r.map(f => f.name), ['a.pdf', 'b.pdf']);
  assert.strictEqual(Buffer.from(r[1].bytes).toString(), 'B'.repeat(5000));
});

test('readZip: recusa ZIP que expande acima do limite', async () => {
  const z = zip([['x.bin', Buffer.alloc(300000, 1), 8]]);
  const r = await M.readZip(z, { maxOne: 1000 });
  assert.strictEqual(r.length, 0); // ficheiro acima do limite é ignorado
});

test('readZip: lixo não é ZIP', async () => {
  await assert.rejects(() => M.readZip(new Uint8Array(100)), /zip-invalid/);
});

test('parseEml: nome de ficheiro com UTF-8 em bruto', () => {
  const raw = Buffer.from('Subject: Olá\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n--X\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="Segurança.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nQUJD\r\n--X--\r\n');
  const r = M.parseEml(new Uint8Array(raw));
  assert.strictEqual(r.subject, 'Olá');
  assert.strictEqual(r.attachments[0].name, 'Segurança.pdf');
});
