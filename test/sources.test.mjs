// Client files: Word and PDF readers (fixtures are built in memory, no binary files in the repo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDocx } from '../lib/docx.js';
import { readZip } from '../lib/xml-lite.js';
import { openPdf, readAnnotations, readPdfText, pdfDate } from '../lib/pdf-source.js';
import { grepNeedle, pdfNeedles, pdfFeedbackTable, docxFeedbackTables, pdfTarget } from '../tools/source-tools.js';

// ---- tiny ZIP writer (stored entries) -------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), nm = Buffer.from(name, 'utf8'), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data);
    centrals.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const run = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;

function sampleDocx() {
  const body = [
    para(run('Fiche transport'), '<w:pStyle w:val="Heading1"/>'),
    para(run('Constat', '<w:b/>')),
    para(`${run('Le ')}<w:del w:id="1" w:author="Alice"><w:r><w:delText>stock</w:delText></w:r></w:del><w:ins w:id="2" w:author="Alice"><w:r><w:t>magasin central</w:t></w:r></w:ins>${run(' de Nantes a réorganisé ses flux.')}`),
    para(`<w:commentRangeStart w:id="7"/>${run('Prix : 12 € & taxes')}<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r>`),
    para(run('Cartographier les flux.'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    para(`<w:hyperlink r:id="rId9">${run('le site')}</w:hyperlink>`),
    '<w:tbl><w:tr><w:tc>' + para(run('Catégorie')) + '</w:tc><w:tc>' + para(run('Unité')) + '</w:tc></w:tr><w:tr><w:tc>' + para(run('Flux')) + '</w:tc><w:tc>' + para(run('%')) + '</w:tc></w:tr></w:tbl>',
  ].join('');
  return zip({
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    'word/comments.xml': `<w:comments ${W}><w:comment w:id="7" w:author="Chloé" w:date="2026-06-01T10:00:00Z"><w:p w14:paraId="AA01">${run('Mettre 15 €')}</w:p></w:comment><w:comment w:id="8" w:author="David"><w:p w14:paraId="AA02">${run('OK pour moi')}</w:p></w:comment></w:comments>`,
    'word/commentsExtended.xml': `<w15:commentsEx ${W}><w15:commentEx w15:paraId="AA01" w15:done="0"/><w15:commentEx w15:paraId="AA02" w15:paraIdParent="AA01" w15:done="0"/></w15:commentsEx>`,
    'word/_rels/document.xml.rels': '<Relationships><Relationship Id="rId9" Target="https://example.org/page"/></Relationships>',
  });
}

test('zip reader lists and inflates entries', () => {
  const z = readZip(zip({ 'a.txt': 'bonjour', 'dir/b.xml': '<x/>' }));
  assert.deepEqual([...z.keys()], ['a.txt', 'dir/b.xml']);
  assert.equal(z.get('a.txt')().toString(), 'bonjour');
});

test('docx: headings, lists, tables, links, entities', () => {
  const d = readDocx(sampleDocx());
  assert.match(d.markdown, /^# Fiche transport/m);
  assert.match(d.markdown, /^- Cartographier les flux\./m);
  assert.match(d.markdown, /\[le site\]\(https:\/\/example\.org\/page\)/);
  assert.match(d.markdown, /\| Catégorie \| Unité \|\n\| --- \| --- \|\n\| Flux \| % \|/);
  assert.match(d.markdown, /Prix : 12 € & taxes\[C1\]/);
  assert.deepEqual(d.outline.map((o) => [o.level, o.text, !!o.inferred]), [[1, 'Fiche transport', false], [2, 'Constat', true]]);
});

test('docx: tracked changes become before/after rows with a search probe', () => {
  const d = readDocx(sampleDocx());
  assert.match(d.markdown, /Le \[-stock-\]\[\+magasin central\+\] de Nantes/);
  assert.equal(d.changes.length, 1);
  const c = d.changes[0];
  assert.equal(c.section, 'Fiche transport › Constat');
  assert.equal(c.before, 'Le ~~stock~~ de Nantes a réorganisé ses flux.');
  assert.equal(c.after, 'Le **magasin central** de Nantes a réorganisé ses flux.');
  assert.deepEqual(c.probe, { before: 'Le stock de Nantes a réorganisé', after: 'Le magasin central de Nantes a réorganisé' });
  assert.deepEqual(c.authors, ['Alice']);
});

test('docx: comments keep their anchor, section and replies', () => {
  const d = readDocx(sampleDocx());
  assert.equal(d.comments.length, 2);
  const [c, r] = d.comments;
  assert.equal(c.anchor, 'Prix : 12 € & taxes');
  assert.equal(c.section, 'Fiche transport › Constat');
  assert.equal(r.parent, c.id);
  const table = docxFeedbackTables(d, null);
  assert.match(table, /\| C1 \| Fiche transport › Constat \| «Prix : 12 € & taxes» \| Mettre 15 € \/ ↳ David : OK pour moi \| Chloé \|/);
  assert.match(table, /\| M1 \| .* \| Le ~~stock~~ de Nantes .* \| Le \*\*magasin central\*\* de Nantes .* \| Alice \|/);
});

// ---- minimal PDF with review annotations ----------------------------------------------------------
const hex16 = (s) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}>`;
function samplePdf({ spread = false } = {}) {
  const w = spread ? 1190 : 595, x0 = 72;
  const content = `BT /F1 12 Tf ${x0} 700 Td (Le prix est de 12 euros) Tj ET BT /F1 9 Tf ${spread ? 290 : x0} 30 Td (4) Tj ET`;
  const annots = [
    `<< /Type /Annot /Subtype /StrikeOut /Rect [146 697 162 711] /QuadPoints [146 711 162 711 146 697 162 697] /T (Alice) /Contents () /M (D:20260626115329+02'00') >>`,
    `<< /Type /Annot /Subtype /Caret /Rect [162 692 166 700] /T (Alice) /Contents (TTC) >>`,
    `<< /Type /Annot /Subtype /Text /Rect [300 690 320 710] /T ${hex16('Chloé')} /Contents ${hex16('Vérifier le prix')} /NM (n1) >>`,
    `<< /Type /Annot /Subtype /Text /Rect [300 690 320 710] /T (Bob) /Contents (OK) /IRT 7 0 R /RT /R >>`,
    `<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] >>`,
  ];
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R 9 0 R 7 0 R 8 0 R 10 0 R] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    annots[0], annots[2], annots[3], annots[1], annots[4],
  ];
  let pdf = '%PDF-1.7\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('pdf: annotations point at their text, replies are threaded, links skipped', async () => {
  const items = await readAnnotations(await openPdf(samplePdf()));
  assert.equal(items.length, 3, 'strike-out, caret, note (reply folded in, link skipped)');
  const strike = items.find((a) => a.type === 'StrikeOut');
  assert.equal(strike.target, '12');
  assert.match(strike.context, /de «12» euros/);
  assert.equal(strike.date, '2026-06-26 11:53');
  const caret = items.find((a) => a.type === 'Caret');
  assert.equal(caret.insert, 'TTC');
  assert.match(caret.context, /12 ?‸ ?euros/);
  const note = items.find((a) => a.type === 'Text');
  assert.equal(note.author, 'Chloé');
  assert.equal(note.near, 'Le prix est de 12 euros');
  assert.deepEqual(note.replies.map((r) => [r.author, r.comment]), [['Bob', 'OK']]);
  assert.equal(strike.folio, '4');
});

test('pdf: feedback table and InDesign needles', async () => {
  const items = await readAnnotations(await openPdf(samplePdf()));
  const table = pdfFeedbackTable(items, new Map([[1, 'p.4 #120']]));
  assert.match(table, /\| 1 \| 4 \| Supprimer \| «12» dans «Le prix est de «12» euros[^|]*» \| supprimer \| Alice \| p\.4 #120 \|/);
  assert.match(table, /Insérer .* insérer «TTC»/);
  assert.match(table, /Note \| près de «Le prix est de 12 euros» \| Vérifier le prix \/ ↳ Bob : OK \| Chloé/);
  const strike = items.find((a) => a.type === 'StrikeOut');
  const nd = pdfNeedles(strike);
  assert.equal(nd.before, 'prix\\s+est\\s+de\\s+12\\s+euros');
  assert.equal(nd.after, 'prix\\s+est\\s+de\\s+euros');
  assert.equal(pdfTarget({ kind: 'note', near: 'x' }), 'près de «x»');
});

test('pdf: spreads are read as left and right pages', async () => {
  const doc = await openPdf(samplePdf({ spread: true }));
  const { pages } = await readPdfText(doc);
  assert.deepEqual(pages.map((p) => p.side), ['left', 'right']);
  assert.match(pages[0].text, /Le prix est de 12 euros/);
  const items = await readAnnotations(doc);
  assert.ok(items.every((a) => a.side === 'left'));
});

test('grep needles: escaped, flexible spaces, bullets dropped', () => {
  assert.equal(grepNeedle('Prix (TTC) : 12.5 €'), 'Prix\\s+\\(TTC\\)\\s+:\\s+12\\.5\\s+€');
  assert.equal(grepNeedle('• Source A. • Source B, Travaux sur'), 'Source\\s+B,\\s+Travaux\\s+sur');
  assert.equal(grepNeedle('à'), null);
  assert.equal(pdfDate("D:20260623163231+02'00'"), '2026-06-23 16:32');
});
