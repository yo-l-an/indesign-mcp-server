// Offline tests for the review workflow (no InDesign): PNG codec, pixel diff, inventory diff,
// change table, page name resolution, backup names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, decodePng, encodePng } from '../lib/png.js';
import {
  pixelDiffRegions, diffInventories, textDiffCells, changeRows, changesTable, groupRows, labelsFor,
  cropRectFor, cropImage, boundsToRect, fillRect, buildPageComposite, drawGutter, ORANGE, GREEN,
} from '../lib/review-diff.js';
import { resolvePageRefs, backupFileName, slugify, pageSummary } from '../tools/review-tools.js';

test('PNG encode/decode round trip keeps pixels', () => {
  const img = createImage(37, 21, [255, 255, 255, 255]);
  fillRect(img, 5, 3, 10, 8, [200, 10, 30]);
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 37);
  assert.equal(back.height, 21);
  assert.deepEqual(Array.from(back.data), Array.from(img.data));
});

test('pixel diff finds one region where a block changed, none for identical images', () => {
  const a = createImage(200, 100);
  const b = createImage(200, 100);
  assert.deepEqual(pixelDiffRegions(a, b), []);
  fillRect(b, 120, 40, 30, 20, [0, 0, 0]);
  const r = pixelDiffRegions(a, b);
  assert.equal(r.length, 1);
  assert.ok(r[0].x <= 120 && r[0].x + r[0].w >= 150 && r[0].y <= 40 && r[0].y + r[0].h >= 60);
});

test('pixel diff ignores faint anti-aliasing noise', () => {
  const a = createImage(100, 100);
  const b = createImage(100, 100);
  fillRect(b, 10, 10, 50, 50, [235, 235, 235]);
  assert.deepEqual(pixelDiffRegions(a, b), []);
});

const page = (id, number, items) => ({ id, index: number - 1, number, name: String(number), widthMm: 210, heightMm: 297, items });
const inv = (pages, doc = {}) => ({ document: { pageCount: pages.length, allPageIds: pages.map((p) => p.id), ...doc }, pages });

test('inventory diff: modified text, moved object, added and removed objects', () => {
  const before = inv([page(1, 1, [
    { id: 10, type: 'TextFrame', bounds: [10, 10, 20, 100], text: 'Prix : 12 euros' },
    { id: 11, type: 'Rectangle', bounds: [50, 10, 80, 60], fill: 'Blue' },
    { id: 12, type: 'Oval', bounds: [100, 10, 110, 20] },
  ])]);
  const after = inv([page(1, 1, [
    { id: 10, type: 'TextFrame', bounds: [10, 10, 20, 100], text: 'Prix : 15 euros' },
    { id: 11, type: 'Rectangle', bounds: [55, 10, 85, 60], fill: 'Blue' },
    { id: 13, type: 'TextFrame', bounds: [200, 10, 210, 100], text: 'Nouveau' },
  ])]);
  const d = diffInventories(before, after);
  const byId = Object.fromEntries(d.changes.map((c) => [c.id, c]));
  assert.equal(byId[10].kind, 'modified');
  assert.deepEqual(byId[10].props.map((p) => p.prop), ['text']);
  assert.deepEqual(byId[11].props.map((p) => p.prop), ['bounds']);
  assert.equal(byId[12].kind, 'removed');
  assert.equal(byId[13].kind, 'added');
  // zones are numbered top to bottom
  assert.deepEqual(d.changes.map((c) => c.id), [10, 11, 12, 13]);
  assert.deepEqual(d.changes.map((c) => c.zone), [1, 2, 3, 4]);
});

test('word diff marks only the changed words and keeps them together', () => {
  const t = textDiffCells('Organisation | Taux de flux mutualisés', 'Organisation | Part des flux mutualisés');
  assert.match(t.before, /~~Taux de~~ flux/);
  assert.match(t.after, /\*\*Part des\*\* flux/);
});

test('long unchanged text is shortened around the change', () => {
  const words = Array.from({ length: 80 }, (_, i) => `mot${i}`);
  const a = words.join(' ');
  const b = words.map((w, i) => (i === 40 ? 'CHANGE' : w)).join(' ');
  const t = textDiffCells(a, b);
  assert.ok(t.after.length < 150, t.after);
  assert.match(t.after, /… .*\*\*CHANGE\*\*.* …/);
});

test('change table: one row per property, pipes escaped once, document rows show changed keys only', () => {
  const L = labelsFor('fr');
  const before = inv([page(1, 1, [{ id: 10, type: 'TextFrame', bounds: [0, 0, 10, 10], text: 'a | b', pointSize: [11] }])],
    { paragraphStyles: [{ name: 'Corps', value: { font: 'Arial', size: 11, leading: 13 } }] });
  const after = inv([page(1, 1, [{ id: 10, type: 'TextFrame', bounds: [0, 0, 10, 10], text: 'a | c', pointSize: [8, 11] }])],
    { paragraphStyles: [{ name: 'Corps', value: { font: 'Arial', size: 8, leading: 13 } }] });
  const rows = changeRows(diffInventories(before, after), [], L);
  const md = changesTable(rows, L);
  assert.match(md, /^\| # \| Page \| Élément \| Propriété \| Avant \| Après \| Type \|/);
  assert.match(md, /a \\\| ~~b~~/);
  assert.doesNotMatch(md, /\\\\\|/);
  assert.match(md, /8 pt, 11 pt/);
  assert.match(md, /\| size: 11 \| size: 8 \|/);
  assert.doesNotMatch(md, /NaN/);
});

test('identical changes on many objects are grouped into one row', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ zone: String(i + 1), page: String(i + 2), element: `Bloc texte #${i}`, property: 'Corps', before: '11 pt', after: '8 pt', kind: 'Modifié' }));
  rows.push({ zone: '6', page: '9', element: 'Image #9', property: 'Position / taille', before: 'x', after: 'y', kind: 'Modifié' });
  const g = groupRows(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].zone, '1–5');
  assert.equal(g[0].element, '5 × Bloc texte');
});

test('crop keeps a local change area and gives up when changes cover the page', () => {
  const r = cropRectFor([{ x: 100, y: 100, w: 50, h: 20 }], 600, 800);
  assert.ok(r && r.w < 600 && r.h < 800 && r.x <= 100 && r.y <= 100);
  assert.equal(cropRectFor([{ x: 0, y: 0, w: 600, h: 800 }], 600, 800), null);
  const img = createImage(600, 800);
  const c = cropImage(img, r);
  assert.equal(c.width, r.w);
});

test('bounds in mm map to pixels and off-page objects are dropped', () => {
  const img = createImage(595, 842);
  const r = boundsToRect([10, 10, 20, 110], 210, img);
  assert.ok(Math.abs(r.x - 28) <= 1 && Math.abs(r.w - 283) <= 2);
  assert.equal(boundsToRect([10, -100, 20, -50], 210, img), null);
});

test('composite: transparent gap, gutters on opposite sides, page on paper white', () => {
  const page = { width: 200, height: 280, data: new Uint8Array(200 * 280 * 4) };   // fully transparent export
  const zone = { rect: { x: 50, y: 100, w: 40, h: 20 }, zone: 1, kind: 'modified' };
  const out = buildPageComposite({ before: page, after: page, beforeZones: [zone], afterZones: [zone], pageNumber: '5', L: labelsFor('fr') });
  const px = (x, y) => Array.from(out.data.slice((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));
  const header = out.height - 280;
  assert.equal(px(Math.floor(out.width / 2), header + 50)[3], 0, 'gap is transparent');
  assert.deepEqual(px(40, header + 10), [255, 255, 255, 255], 'page falls back to paper white');
  // before: gutter on the left edge, bar at the zone height; after: gutter on the right edge
  assert.deepEqual(px(4, header + 110).slice(0, 3), ORANGE);
  assert.deepEqual(px(4, header + 50), [255, 255, 255, 255]);
  assert.deepEqual(px(out.width - 5, header + 110).slice(0, 3), ORANGE);
});

test('gutter puts overlapping zones in separate lanes', () => {
  const img = createImage(20, 100, [0, 0, 0, 0]);
  drawGutter(img, 0, 0, 20, 100, [
    { rect: { x: 0, y: 10, w: 5, h: 60 }, kind: 'modified' },
    { rect: { x: 0, y: 30, w: 5, h: 5 }, kind: 'added' },
  ]);
  const row = (y) => Array.from({ length: 20 }, (_, x) => img.data[(y * 20 + x) * 4 + 1]);
  assert.ok(row(32).includes(ORANGE[1]) && row(32).includes(GREEN[1]), 'both bars visible side by side');
});

test('composite draws both panels, also for an added page', () => {
  const a = createImage(100, 140);
  const out = buildPageComposite({ before: null, after: a, beforeZones: [], afterZones: [{ rect: { x: 10, y: 10, w: 20, h: 20 }, zone: 1 }], pageNumber: '3', L: labelsFor('fr') });
  assert.ok(out.width > 200 && out.height > 140);
});

test('page references resolve by page name, "+N", and explain ambiguity', () => {
  const pages = [{ id: 1, name: 'i', index: 0 }, { id: 2, name: '1', index: 1 }, { id: 3, name: '2', index: 2 }, { id: 4, name: '1', index: 3 }];
  assert.deepEqual(resolvePageRefs(['2'], pages).map((p) => p.id), [3]);
  assert.deepEqual(resolvePageRefs([2], pages).map((p) => p.id), [3]);
  assert.deepEqual(resolvePageRefs(['+1'], pages).map((p) => p.id), [1]);
  assert.throws(() => resolvePageRefs(['1'], pages), /used 2 times.*"\+2", "\+4"/);
  assert.throws(() => resolvePageRefs(['9'], pages), /not found/);
});

test('backup names are dated, slugged and keep the document name', () => {
  const name = backupFileName('Brochure été.indd', 'Avant correction des prix p12 !', new Date(2026, 10, 16, 14, 5, 9));
  assert.equal(name, 'Brochure été__2026-11-16_14h05m09__avant-correction-des-prix-p12.indd');
  assert.equal(slugify(''), '');
});

test('page summary folds small shapes and shows text excerpts', () => {
  const s = pageSummary(page(1, 5, [
    { id: 1, type: 'TextFrame', bounds: [10, 10, 50, 100], text: 'Titre\rCorps', paragraphStyles: ['Titre'] },
    { id: 2, type: 'Polygon', bounds: [0, 0, 3, 3], fill: 'Paper' },
    { id: 3, type: 'Polygon', bounds: [0, 0, 3, 3], fill: 'Paper' },
  ]));
  assert.match(s, /id=1 TextFrame x10 y10 90×40 \[Titre\] «Titre ¶ Corps»/);
  assert.match(s, /\+ 2 small shapes .*ids 2, 3/);
});
