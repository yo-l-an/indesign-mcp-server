// compareSnapshots through its interface: inventories and page images in memory, no InDesign
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImage, decodePng } from '../lib/png.js';
import { fillRect } from '../lib/review-diff.js';
import { compareSnapshots } from '../lib/review.js';

// 1 px per mm: an A4 page is 210 x 297 px, bounds [top, left, bottom, right] in mm
const page = (id, number, items) => ({ id, index: number - 1, number, name: String(number), widthMm: 210, heightMm: 297, items });
const inv = (pages, allPageIds = pages.map((p) => p.id)) => ({ document: { name: 'Brochure.indd', pageCount: allPageIds.length, allPageIds }, pages, pageIds: pages.map((p) => p.id), resolution: 25.4 });
const blank = () => createImage(210, 297, [255, 255, 255, 255]);

// images: { 'before:1': img, 'after:1': img }; calls records what the comparison asked for
function memorySource(images, { located = [], added = [] } = {}) {
  const calls = [];
  return {
    calls,
    pageImage: (side, id) => images[`${side}:${id}`] || null,
    locatePages: async (ids) => { calls.push(['locatePages', ids]); return located; },
    addPages: async (ids) => { calls.push(['addPages', ids]); return added; },
    thumbnails: async (pages) => { calls.push(['thumbnails', pages.map((p) => p.id)]); return new Map(); },
  };
}

test('identical snapshots: no difference, no image', async () => {
  const items = [{ id: 10, type: 'TextFrame', bounds: [10, 10, 30, 200], text: 'Prix : 12 euros' }];
  const source = memorySource({ 'before:1': blank(), 'after:1': blank() });
  const out = await compareSnapshots({ before: inv([page(1, 1, items)]), after: inv([page(1, 1, items)]), source });
  assert.equal(out.summary, 'Aucune différence détectée.');
  assert.deepEqual(out.images, []);
  assert.equal(out.table, '');
  assert.deepEqual(source.calls, []);
});

test('a text change: one zone on the page, a table row, a page image', async () => {
  const before = inv([page(1, 1, [{ id: 10, type: 'TextFrame', bounds: [10, 10, 30, 200], text: 'Prix : 12 euros' }])]);
  const after = inv([page(1, 1, [{ id: 10, type: 'TextFrame', bounds: [10, 10, 30, 200], text: 'Prix : 15 euros' }])]);
  const imgA = blank();
  fillRect(imgA, 60, 15, 12, 10, [0, 0, 0]);   // the changed digits, inside the frame
  const out = await compareSnapshots({ before, after, source: memorySource({ 'before:1': blank(), 'after:1': imgA }), language: 'en' });
  assert.match(out.summary, /^1 modified, 0 added, 0 removed – pages 1\.$/);
  assert.equal(out.rows.length, 1);
  assert.match(out.table, /15/);
  assert.deepEqual(out.images.map((i) => i.file), ['review-page-001.png']);
  const png = decodePng(out.images[0].png);
  assert.ok(png.width > 0 && png.height > 0, 'a real PNG');
});

test('pixels that no object explains become a visual zone', async () => {
  const items = [{ id: 10, type: 'TextFrame', bounds: [10, 10, 30, 200], text: 'Titre' }];
  const imgA = blank();
  fillRect(imgA, 100, 200, 40, 40, [200, 0, 0]);   // e.g. a changed placed image, same inventory
  const out = await compareSnapshots({ before: inv([page(1, 1, items)]), after: inv([page(1, 1, items)]), source: memorySource({ 'before:1': blank(), 'after:1': imgA }) });
  assert.match(out.summary, /1 zone\(s\) visuelle\(s\)/);
  assert.equal(out.images.length, 1);
});

test('an object moved out of the scope is found on its new page and shown as moved', async () => {
  const frame = { id: 20, type: 'Rectangle', bounds: [50, 50, 100, 100], fill: 'Blue' };
  const before = inv([page(1, 1, [frame])], [1, 2]);
  const after = inv([page(1, 1, [])], [1, 2]);
  const imgB = blank();
  fillRect(imgB, 50, 50, 50, 50, [0, 0, 255]);
  const imgA2 = blank();
  fillRect(imgA2, 50, 50, 50, 50, [0, 0, 255]);
  const source = memorySource({ 'before:1': imgB, 'after:1': blank(), 'after:2': imgA2 }, { located: [2], added: [page(2, 2, [frame])] });
  const out = await compareSnapshots({ before, after, source, language: 'en' });
  assert.deepEqual(source.calls.slice(0, 2), [['locatePages', [20]], ['addPages', [2]]]);
  assert.deepEqual(out.after.pages.map((p) => p.id), [1, 2], 'AFTER gained the destination page');
  assert.match(out.summary, /1 moved to another page/);
  assert.ok(out.images.some((i) => i.file === 'review-move-001-to-002.png'), out.images.map((i) => i.file).join(', '));
});

test('a page added: page map from thumbnails of the current pages', async () => {
  const pages = (ids) => ids.map((id, i) => ({ id, name: String(i + 1), spread: id, side: 'single' }));
  const before = inv([], [1, 2]);
  before.pageIds = [];
  before.document.allPages = pages([1, 2]);
  const after = inv([], [1, 3, 2]);
  after.document.allPages = pages([1, 3, 2]);
  const source = memorySource({});
  source.thumbnails = async (list) => { source.calls.push(['thumbnails', list.map((p) => p.id)]); return new Map(list.map((p) => [p.id, blank()])); };
  const out = await compareSnapshots({ before, after, source, language: 'en' });
  assert.deepEqual(source.calls, [['thumbnails', [1, 3, 2]]]);
  assert.deepEqual(out.images.map((i) => i.file), ['review-pages.png']);
  assert.match(out.images[0].caption, /1 added/);
});
