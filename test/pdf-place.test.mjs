// PDF / AI placing: page boxes read from the file, the shared placing step of place_graphic,
// place_image and place_image_in_shape (preferences set and restored, artboard positioning).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { runTool, parses } from './harness.mjs';
import { pdfPageBoxes } from '../lib/pdf-source.js';
import { pdfPlacement, artboardScale, artboardBounds } from '../lib/pdf-place.js';
import { bleedPdf, writeBleedPdf } from '../tests/fixtures/bleed-pdf.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-pdf-'));
process.env.INDESIGN_ALLOWED_DIRS = fs.realpathSync(dir);   // read when the server loads, at the first runTool
const PAGES = [{ width: 100, height: 70, bleed: { top: 3, left: 3, bottom: 3, right: 5 } }, { width: 148, height: 105, bleed: { top: 3, left: 4, bottom: 6, right: 5 } }];
const file = writeBleedPdf(path.join(dir, 'two-pages.pdf'), PAGES);
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test('pdfPageBoxes: artboard and bleed per side, per page', () => {
  const buf = fs.readFileSync(file);
  const p2 = pdfPageBoxes(buf, 2);
  close(p2.width, 148); close(p2.height, 105);
  for (const [k, v] of Object.entries(PAGES[1].bleed)) close(p2.bleed[k], v);
  assert.equal(p2.hasBleed, true);
  close(pdfPageBoxes(buf, 1).bleed.right, 5);
  assert.throws(() => pdfPageBoxes(buf, 3), /no page 3 \(it has 2\)/);
});

test('pdfPageBoxes: inherited MediaBox, no bleed, /Rotate, object streams', () => {
  const pt = (mm) => (mm * 72 / 25.4).toFixed(3);
  // MediaBox on the page tree, nothing else: no bleed
  const flat = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 ${pt(50)} ${pt(30)}] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Rotate 90 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');
  const b = pdfPageBoxes(flat, 1);
  close(b.width, 30); close(b.height, 50);   // turned a quarter
  assert.equal(b.hasBleed, false);
  // the page dictionaries inside a compressed object stream
  const src = bleedPdf([PAGES[1]]).toString('latin1');
  const page = src.match(/(\d+) 0 obj\n(<< \/Type \/Page [\s\S]*?)\nendobj/);
  const objstm = zlib.deflateSync(Buffer.from(`${page[1]} 0 ${page[2]}`, 'latin1'));
  const packed = src.replace(page[0], `99 0 obj\n<< /Type /ObjStm /N 1 /First ${`${page[1]} 0 `.length} /Filter /FlateDecode /Length ${objstm.length} >>\nstream\n${objstm.toString('latin1')}\nendstream\nendobj`);
  const p = pdfPageBoxes(Buffer.from(packed, 'latin1'), 1);
  close(p.width, 148); close(p.bleed.bottom, 6);
});

test('pdfPlacement: defaults, checks, artboard scale and bounds', () => {
  assert.equal(pdfPlacement({}, '/x/photo.jpg'), null);
  assert.throws(() => pdfPlacement({ crop: 'trim' }, '/x/photo.jpg'), /only apply to \.pdf and \.ai/);
  assert.deepEqual(pdfPlacement({}, file).crop, 'pdf');
  assert.equal(pdfPlacement({}, file).position, null);
  assert.throws(() => pdfPlacement({ position: 'artboard' }, file), /with crop: "bleed"/);
  assert.throws(() => pdfPlacement({ crop: 'nope' }, file), /Invalid crop/);
  const p = pdfPlacement({ crop: 'bleed', pdfPage: 2 }, file);
  assert.equal(p.position, 'artboard');
  close(artboardScale(p, { width: 74 }), 0.5);
  assert.throws(() => artboardScale(p, { width: 148, height: 50 }), /keeps its proportions/);
  assert.deepEqual(artboardBounds(p, 0, 0, 1).map((v) => Math.round(v * 100) / 100), [-3, -4, 111, 153]);
});

test('the three tools set and restore the place preferences, and check the page', async () => {
  const calls = [
    ['place_graphic', { filePath: file, pdfPage: 2, crop: 'trim' }],
    ['place_image', { imagePath: file, pdfPage: 2, crop: 'trim' }],
    ['place_image_in_shape', { shapeId: 7, imagePath: file, pdfPage: 2, crop: 'trim' }],
  ];
  for (const [name, args] of calls) {
    const r = await runTool(name, args);
    assert.equal(r.error, null, `${name}: ${r.error?.message}`);
    assert.ok(parses(r.script).ok, `${name}: ${parses(r.script).message}`);
    assert.match(r.script, /__pp\.pageNumber = 2;\s*__pp\.pdfCrop = PDFCrop\.CROP_TRIM;/, name);
    assert.match(r.script, /finally \{\s*try \{ __pp\.pageNumber = __oldPage; __pp\.pdfCrop = __oldCrop; \}/, name);
    assert.match(r.script, /The file has no page 2/, name);
    assert.match(r.script, /" crop=" \+ "trim"/, name);
  }
  // an image is placed as before: no preferences touched
  const jpg = path.join(dir, 'photo.jpg');
  fs.writeFileSync(jpg, 'x');
  for (const [name, args] of [['place_image', { imagePath: jpg }], ['place_image_in_shape', { shapeId: 7, imagePath: jpg }]]) {
    assert.doesNotMatch((await runTool(name, args)).script, /pdfPlacePreferences/, name);
  }
});

test('crop bleed, position artboard: the frame is the artboard grown by the bleed; in a shape the artboard is fitted', async () => {
  const g = await runTool('place_graphic', { filePath: file, pdfPage: 2, crop: 'bleed', x: 0, y: 0, width: 148 });
  assert.equal(g.error, null, g.error?.message);
  assert.match(g.script, /rect\.geometricBounds = \[-3,-4,111,153\]/);
  assert.match(g.script, /bleed added \(mm\): top " \+ Math\.round\(3 \* \(1\)/);
  const i = await runTool('place_image', { imagePath: file, pdfPage: 2, crop: 'bleed', x: 10, y: 20, width: 74 });
  assert.match(i.script, /rect\.geometricBounds = \[18\.5,8,75\.5,86\.5\]/);
  const s = await runTool('place_image_in_shape', { shapeId: 7, imagePath: file, pdfPage: 2, crop: 'bleed', fitOption: 'PROPORTIONALLY' });
  assert.ok(parses(s.script).ok, parses(s.script).message);
  assert.match(s.script, /var __sx = Math\.min\(W \/ aw, H \/ ah\)/);
  assert.match(s.script, /Math\.round\(3 \* \(__sy\)/);
  const bleedWhole = await runTool('place_image', { imagePath: file, crop: 'bleed', position: 'bleed', x: 0, y: 0, width: 50 });
  assert.doesNotMatch(bleedWhole.script, /bleed added/);
});
