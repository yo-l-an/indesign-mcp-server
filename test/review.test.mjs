// Offline tests for the review workflow (no InDesign): PNG codec, pixel diff, inventory diff,
// change table, page name resolution, backup names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, decodePng, encodePng } from '../lib/png.js';
import {
  pixelDiffRegions, diffInventories, textDiffCells, changeRows, changesTable, groupRows, labelsFor,
  cropRectFor, cropImage, boundsToRect, fillRect, buildPageComposite, drawGutter, ORANGE, GREEN, RED,
  pageStructureDiff, pageMapRows, buildPageMap, buildMoveComposite,
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

test('page structure: moved, added and removed pages by id', () => {
  const st = pageStructureDiff([1, 2, 3, 4, 5, 6], [1, 3, 4, 2, 7, 6]);
  assert.deepEqual(st.moved, [2]);
  assert.deepEqual(st.removed, [5]);
  assert.deepEqual(st.added, [7]);
  assert.ok(st.stable.has(1) && st.stable.has(6));
});

test('a reordered page does not flag its objects; an object on another page is a move', () => {
  const p = (id, number, items) => ({ id, number, name: String(number), widthMm: 210, items });
  const before = { document: { allPageIds: [1, 2], allPages: [{ id: 1, name: '1' }, { id: 2, name: '2' }] }, pages: [p(1, 1, [{ id: 10, type: 'Oval', bounds: [0, 0, 5, 5] }]), p(2, 2, [{ id: 11, type: 'Oval', bounds: [0, 0, 5, 5] }])] };
  const after = { document: { allPageIds: [2, 1], allPages: [{ id: 2, name: '1' }, { id: 1, name: '2' }] }, pages: [p(2, 1, [{ id: 11, type: 'Oval', bounds: [0, 0, 5, 5] }, { id: 10, type: 'Oval', bounds: [0, 0, 5, 5] }]), p(1, 2, [])] };
  const d = diffInventories(before, after);
  assert.equal(d.changes.length, 1, 'only object 10 changed (it moved to page 2)');
  assert.equal(d.changes[0].id, 10);
  assert.deepEqual(d.changes[0].props.map((x) => x.prop), ['page']);
  assert.equal(d.docChanges.filter((x) => x.scope === 'page' && x.kind === 'moved').length, 1);
  const rows = changeRows(d, [], labelsFor('fr'));
  assert.ok(rows.some((r) => r.kind === 'Déplacé' && r.property === 'Page'));
});

test('page map aligns rows like a diff and folds long unchanged runs', () => {
  const pages = (ids) => ids.map((id) => ({ id, name: String(id), thumb: null }));
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], a = [1, 2, 3, 4, 5, 6, 7, 9, 8, 10, 11];
  const st = pageStructureDiff(b, a);
  const rows = pageMapRows(pages(b), pages(a), st);
  assert.ok(rows[0].fold >= 3, 'the unchanged start is folded');
  assert.ok(rows.some((r) => r.right && r.right.id === 11 && r.kindR === 'added'));
  const img = buildPageMap({ before: pages(b), after: pages(a), st, L: labelsFor('fr') });
  assert.ok(img.width > 200 && img.height > 100);
});

test('move image draws an arrow between the two pages', () => {
  const page = createImage(200, 280);
  const out = buildMoveComposite({ src: { img: page, name: '3' }, dst: { img: page, name: '7' }, links: [{ zone: 1, from: { x: 20, y: 100, w: 40, h: 20 }, to: { x: 120, y: 200, w: 40, h: 20 } }], L: labelsFor('fr') });
  const { beforeX, afterX, top } = out.layout;
  const midX = Math.round((beforeX + 60 + afterX + 120) / 2);
  let found = false;
  for (let y = top; y < out.height && !found; y++) {
    const o = (y * out.width + midX) * 4;
    if (out.data[o] === ORANGE[0] && out.data[o + 1] === ORANGE[1]) found = true;
  }
  assert.ok(found, 'orange arrow crosses the middle');
});
