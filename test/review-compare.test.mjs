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

test('identical renders: unchanged pages are not decoded, the result is the same', async () => {
  const items = (t) => [{ id: 10, type: 'TextFrame', bounds: [10, 10, 30, 200], text: t }];
  const before = inv([page(1, 1, items('Prix : 12 euros')), page(2, 2, items('Titre')), page(3, 3, items('Fin'))]);
  const after = inv([page(1, 1, items('Prix : 15 euros')), page(2, 2, items('Titre')), page(3, 3, items('Fin'))]);
  const imgA = blank();
  fillRect(imgA, 60, 15, 12, 10, [0, 0, 0]);
  const images = { 'before:1': blank(), 'after:1': imgA, 'before:2': blank(), 'after:2': blank(), 'before:3': blank(), 'after:3': blank() };
  const plain = await compareSnapshots({ before, after, source: memorySource(images) });
  const asked = [];
  const fast = memorySource(images);
  const pageImage = fast.pageImage;
  fast.pageImage = (side, id) => { asked.push(`${side}:${id}`); return pageImage(side, id); };
  fast.samePixels = (id) => id !== 1;
  const quick = await compareSnapshots({ before, after, source: fast });
  assert.deepEqual(asked.sort(), ['after:1', 'before:1'], 'only the changed page is decoded');
  assert.equal(quick.summary, plain.summary);
  assert.deepEqual(quick.images.map((i) => [i.file, i.png.length]), plain.images.map((i) => [i.file, i.png.length]));
});

test('zone labels: a rotated, moved and shadowed object shows an icon and the new value per change', async () => {
  const { zoneNotes, markZones } = await import('../lib/review-diff.js');
  const b = { id: 7, type: 'Rectangle', bounds: [100, 50, 140, 90], rotation: 0 };
  // rotation alone: the bounding box grows around the same centre, no move
  const rot = { kind: 'modified', before: b, after: { ...b, bounds: [98, 48, 142, 92], rotation: 12 }, props: [{ prop: 'bounds' }, { prop: 'rotation' }] };
  assert.deepEqual(zoneNotes(rot, 'after'), [{ icon: 'rotate-left', text: '12°' }]);   // + turns left
  assert.deepEqual(zoneNotes(rot, 'before'), [{ icon: 'rotate-left', text: '0°' }]);
  const wrap = { ...rot, after: { ...rot.after, rotation: -350 } };   // -350° = +10°, still left
  assert.equal(zoneNotes(wrap, 'after')[0].icon, 'rotate-left');
  assert.equal(zoneNotes({ ...rot, after: { ...rot.after, rotation: -8 } }, 'after')[0].icon, 'rotate');
  // a move and a resize, then an effect
  const mv = { kind: 'modified', before: b, after: { ...b, bounds: [110, 60, 160, 100] }, props: [{ prop: 'bounds' }] };
  assert.deepEqual(zoneNotes(mv, 'after'), [{ icon: 'move', text: 'x 60 · y 110' }, { icon: 'resize', text: '40 × 50' }]);
  const fx = { kind: 'modified', before: b, after: { ...b, effects: ['drop shadow'] }, props: [{ prop: 'effects' }] };
  assert.deepEqual(zoneNotes(fx, 'after'), [{ icon: 'fx', text: 'drop shadow' }]);
  assert.deepEqual(zoneNotes({ kind: 'added', after: b, props: [] }, 'after'), []);
  // the label is drawn wider than a plain number, inside the image
  const plain = markZones(blank(), [{ rect: { x: 20, y: 60, w: 40, h: 40 }, zone: 1, kind: 'modified' }]);
  const noted = markZones(blank(), [{ rect: { x: 20, y: 60, w: 40, h: 40 }, zone: 1, kind: 'modified', notes: zoneNotes(rot, 'after').concat(zoneNotes(fx, 'after')) }]);
  const inked = (img, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) { const i = (y * img.width + x) * 4; if (img.data[i + 2] < 120) n++; } return n; };
  assert.ok(inked(noted, 30, 60) > inked(plain, 30, 60) * 2, 'icons and values add to the label');
});

test('the effects of an object are compared and named in the table', async () => {
  const items = (effects) => [{ id: 10, type: 'Rectangle', bounds: [10, 10, 60, 60], ...(effects ? { effects } : {}) }];
  const out = await compareSnapshots({ before: inv([page(1, 1, items())]), after: inv([page(1, 1, items(['drop shadow']))]), source: memorySource({ 'before:1': blank(), 'after:1': blank() }), language: 'en' });
  assert.match(out.table, /Effects/);
  assert.match(out.table, /drop shadow/);
});

test('objects pasted into a shape under new ids read as moved into it, not removed and added', async () => {
  const { recordIdMoves } = await import('../lib/review.js');
  const oval = { id: 30, type: 'Oval', bounds: [20, 20, 120, 140] };
  const members = [{ id: 10, type: 'TextFrame', bounds: [30, 30, 50, 100], text: 'Bonjour' }, { id: 11, type: 'Rectangle', bounds: [60, 40, 90, 80] }];
  const before = inv([page(1, 1, [oval, ...members])]);
  // after paste_into: the members are the same objects under new ids, inside a new group in the oval
  const after = inv([page(1, 1, [oval, { id: 41, type: 'Group', name: 'Contenu', bounds: [30, 30, 90, 100] }, { ...members[0], id: 42 }, { ...members[1], id: 43 }])]);
  const workflow = { lastSnapshot: 'snap-1' };
  recordIdMoves(workflow, [{ from: 10, to: 42, into: { type: 'Oval', id: 30 } }, { from: 11, to: 43, into: { type: 'Oval', id: 30 } }]);
  const source = memorySource({ 'before:1': blank(), 'after:1': blank() });
  source.idMoves = () => workflow.idMoves.get('snap-1');
  const out = await compareSnapshots({ before, after, source, language: 'en' });
  assert.deepEqual(out.rows.filter((r) => r.kind === 'Removed'), [], 'nothing removed');
  const moved = out.rows.filter((r) => r.property === 'Moved into');
  assert.deepEqual(moved.map((r) => [r.element.replace(/ «.*/, ''), r.after, r.kind]), [['Text frame #42', 'Ellipse #30', 'Moved'], ['Rectangle #43', 'Ellipse #30', 'Moved']]);
  assert.ok(out.rows.some((r) => r.kind === 'Added' && /Group #41/.test(r.element)), 'the new group is added');
  // a group re-created by move_into_group: paired with its old id, its new member placed into it
  const grp = { id: 50, type: 'Group', name: 'Logo', bounds: [10, 10, 30, 60] };
  const b2 = inv([page(1, 1, [grp, { id: 12, type: 'Rectangle', bounds: [40, 10, 60, 30] }])]);
  const a2 = inv([page(1, 1, [{ ...grp, id: 55, bounds: [10, 10, 60, 60] }, { id: 12, type: 'Rectangle', bounds: [40, 10, 60, 30] }])]);
  const w2 = { lastSnapshot: 's2' };
  recordIdMoves(w2, [{ from: 50, to: 55 }, { from: 12, to: 12, into: { type: 'Group', id: 55, name: 'Logo' } }]);
  const s2 = memorySource({ 'before:1': blank(), 'after:1': blank() });
  s2.idMoves = () => w2.idMoves.get('s2');
  const o2 = await compareSnapshots({ before: b2, after: a2, source: s2, language: 'en' });
  assert.deepEqual(o2.rows.map((r) => [r.element.replace(/ «.*/, ''), r.property, r.kind]), [['Group #55', 'Position / size', 'Modified'], ['Rectangle #12', 'Moved into', 'Moved']]);
  assert.match(o2.rows[1].after, /Group #55 «Logo»/);
});
