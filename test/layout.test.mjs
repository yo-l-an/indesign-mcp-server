// Offline tests for the designer tools (no InDesign): pages of alternate layouts, layout comparison,
// page maps with layout bands, and the scripts / argument checks of the layout, master and view tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePageRefs, parsePageLines } from '../tools/review-tools.js';
import { compareLayoutPages, matchItems, layoutTable } from '../lib/layout-compare.js';
import { withLayoutBands, spreadMapRows, buildOverviewMap, buildPageMap, labelsFor, diffInventories } from '../lib/review-diff.js';
import { createImage } from '../lib/png.js';
import { runTool, parses } from './harness.mjs';

const L = labelsFor('fr');
const pages = [
  { id: 1, name: '1', index: 0, layout: 'A4' }, { id: 2, name: '2', index: 1, layout: 'A4' },
  { id: 3, name: '1', index: 2, layout: 'A5' }, { id: 4, name: '2', index: 3, layout: 'A5' },
];

test('page lines: the layout column is kept only when the document has several layouts', () => {
  assert.deepEqual(parsePageLines('PAGES\n10\t1\t0\tA4\n11\t2\t1\tA4'), [{ id: 10, name: '1', index: 0 }, { id: 11, name: '2', index: 1 }]);
  assert.equal(parsePageLines('PAGES\n10\t1\t0\tA4\n11\t1\t1\tA5')[1].layout, 'A5');
});

test('"Layout:page" names a page of one alternate layout; a repeated name asks for the layout', () => {
  assert.equal(resolvePageRefs(['A5:2'], pages)[0].id, 4);
  assert.equal(resolvePageRefs(['A5:+1'], pages)[0].id, 3);
  assert.equal(resolvePageRefs(['+3'], pages)[0].id, 3);
  assert.throws(() => resolvePageRefs(['2'], pages), /once per alternate layout.*"A4:2", "A5:2"/);
  assert.throws(() => resolvePageRefs(['A5:9'], pages), /not found in layout "A5"/);
});

test('"2" finds the page named "02" when numbering has leading zeros', () => {
  const zero = [{ id: 1, name: '01', index: 0 }, { id: 2, name: '02', index: 1 }, { id: 3, name: 'i', index: 2 }];
  assert.equal(resolvePageRefs(['2'], zero)[0].id, 2);
  assert.throws(() => resolvePageRefs(['3'], zero), /not found/);
});

const item = (id, type, bounds, extra = {}) => ({ id, type, bounds, ...extra });
const pageA = { id: 1, name: '1', widthMm: 210, heightMm: 297, items: [
  item(11, 'TextFrame', [20, 20, 40, 190], { text: 'Titre du rapport', pointSize: [30] }),
  item(12, 'Rectangle', [0, 0, 297, 210], { fill: 'Papier' }),
  item(13, 'Rectangle', [200, 20, 280, 100], { link: 'photo.jpg' }),
  item(14, 'TextFrame', [250, 120, 260, 190], { text: 'Seulement en A4' }),
] };
const pageB = { id: 2, name: '1', widthMm: 148, heightMm: 210, items: [
  item(21, 'TextFrame', [14.1, 14.1, 28.3, 134], { text: 'Titre du rapport', pointSize: [24] }),
  item(22, 'Rectangle', [0, 0, 210, 148], { fill: 'Papier' }),
  item(23, 'Rectangle', [100, 14, 200, 134], { link: 'photo.jpg' }),
  item(24, 'TextFrame', [190, 14, 200, 80], { text: 'Nouveau en A5' }),
] };

test('layout comparison matches objects by text, image and kind, and compares places relative to the page', () => {
  const { pairs, onlyA, onlyB } = matchItems(pageA, pageB);
  assert.deepEqual(pairs.map(([a, b]) => [a.id, b.id]).sort(), [[11, 21], [12, 22], [13, 23]].sort());
  assert.deepEqual(onlyA.map((i) => i.id), [14]);
  assert.deepEqual(onlyB.map((i) => i.id), [24]);
  const { rows } = compareLayoutPages(pageA, pageB, L);
  // the title kept its relative place (scaled) but its size changed; the background is identical
  assert.ok(rows.some((r) => r.a?.id === 11 && r.prop === 'pointSize'));
  assert.ok(!rows.some((r) => r.a?.id === 11 && r.prop === 'bounds'));
  assert.ok(!rows.some((r) => r.a?.id === 12));
  // the image moved up the page: a place difference in mm and %
  const img = rows.find((r) => r.a?.id === 13 && r.prop === 'bounds');
  assert.match(img.va, /x 20 · y 200 · 80 × 80 mm \(10 %, 67 %/);
  assert.equal(rows.find((r) => r.a?.id === 14).kind, 'removed');
  assert.equal(rows.find((r) => r.b?.id === 24).kind, 'added');
  const table = layoutTable([{ prefix: '', pageA: pageA, pageB: pageB, rows }], 'A4', 'A5', L);
  assert.match(table, /^\| # \| A4 \| A5 \|/);
  assert.match(table, /Corps \| 30 \| 24/);
});

const spread = (id, layout, ...names) => names.map((n, k) => ({ id: id * 10 + k, name: n, spread: id, side: k ? 'LEFT_HAND' : 'RIGHT_HAND', layout, thumb: createImage(20, 28) }));

test('page map: a band names each layout, so a page moved across layouts shows both', () => {
  const before = [...spread(1, 'A4', '1'), ...spread(2, 'A5', '1'), ...spread(3, 'A5', '2')];
  const after = [...spread(1, 'A4', '1'), ...spread(3, 'A4', '2'), ...spread(2, 'A5', '1')];
  const rows = withLayoutBands(spreadMapRows(before, after), true);
  const bands = rows.filter((r) => r.band);
  assert.deepEqual(bands[0].band, { left: 'A4', right: 'A4' });
  assert.ok(bands.some((b) => b.band.left === 'A5' || b.band.right === 'A5'));
  assert.equal(withLayoutBands(rows.filter((r) => !r.band), false).filter((r) => r.band).length, 0);
  const img = buildPageMap({ before, after, st: { moved: [30], added: [], removed: [] }, L });
  assert.ok(img.width > 100 && img.height > 100);
});

test('overview map flows spreads into rows and keeps smaller formats smaller', () => {
  const many = [];
  for (let s = 0; s < 30; s++) many.push(...spread(s, s < 15 ? 'A4' : 'A5', String(2 * s), String(2 * s + 1)));
  const img = buildOverviewMap({ pages: many, title: 'Doc', maxWidth: 600 });
  assert.ok(img.width <= 600);
  assert.ok(img.height > 400);   // several rows
});

test('a page moved to another layout is named with its layout in the change table', () => {
  const doc = (list) => ({ pageCount: list.length, allPageIds: list.map((p) => p.id), allPages: list });
  const a = [{ id: 1, name: '1', layout: 'A4' }, { id: 2, name: '1', layout: 'A5' }, { id: 3, name: '2', layout: 'A5' }, { id: 4, name: '3', layout: 'A5' }];
  const b = [{ id: 1, name: '1', layout: 'A4' }, { id: 4, name: '2', layout: 'A4' }, { id: 2, name: '1', layout: 'A5' }, { id: 3, name: '2', layout: 'A5' }];
  const diff = diffInventories({ document: doc(a), pages: [] }, { document: doc(b), pages: [] });
  assert.deepEqual(diff.docChanges.filter((d) => d.kind === 'moved').map((d) => d.name), ['A5:3 → A4:2']);
});

const scriptOf = async (name, args) => {
  const r = await runTool(name, args);
  if (r.error) throw r.error;
  return r.script;
};

test('layout tools build valid ExtendScript and reject what they cannot do', async () => {
  for (const [name, args] of [
    ['get_layout_setup', {}],
    ['set_document_setup', { facingPages: true, binding: 'right', startPageNumber: 2, bleed: 3, allowPageShuffle: false }],
    ['set_document_setup', { bleedInside: 0, bleedOutside: 5 }],
    ['set_grids', { baselineIncrement: 14, baselineStart: 20, baselineRelativeTo: 'margin', documentGridEvery: 5 }],
  ]) {
    const s = await scriptOf(name, args);
    assert.ok(parses(s).ok, `${name}: ${parses(s).message}`);
  }
  const setup = await scriptOf('set_document_setup', { binding: 'right', bleedInside: 0 });
  assert.match(setup, /PageBindingOptions\.RIGHT_TO_LEFT/);
  assert.match(setup, /documentBleedUniformSize = false/);
  assert.match((await runTool('set_document_setup', {})).error.message, /Nothing to change/);
  assert.match((await runTool('set_margins_columns', { columns: 2 })).error.message, /Say where/);
  assert.match((await runTool('set_margins_columns', { masters: ['A'] })).error.message, /Nothing to change/);
  assert.match((await runTool('create_grid_guides', { masters: ['A'], columns: 0, rows: 0 })).error.message, /nothing to draw/);
  assert.match((await runTool('add_guides', { masters: ['A'] })).error.message, /vertical and\/or horizontal/);
  assert.match((await runTool('add_guides', { masters: ['A'], vertical: [10], color: 'RED;alert(1)' })).error.message, /Invalid color/);
});

test('grid guides on masters: colour checked by name, guides computed in the script', async () => {
  const s = await scriptOf('create_grid_guides', { masters: ['A'], columns: 12, rows: 4, columnGutter: 4, color: 'light blue' });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /UIColors\["LIGHT_BLUE"\]/);
  assert.match(s, /__targetPages\(doc, \[\], \["A"\]\)/);
  assert.match(s, /var C = 12, R = 4/);
});

test('special characters: one place to insert, known names only, values never spliced as code', async () => {
  const s = await scriptOf('insert_special_character', { frameId: 12, character: 'page_number', replace: '12' });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /SpecialCharacters\.AUTO_PAGE_NUMBER/);
  assert.match((await runTool('insert_special_character', { frameId: 12, character: 'page_number', after: 'a', before: 'b' })).error.message, /only one of/);
  assert.ok((await runTool('insert_special_character', { frameId: 12, character: 'nope' })).error);
  const inj = await scriptOf('insert_special_character', { frameId: 12, character: 'em_dash', after: '"); app.quit(); ("' });
  assert.ok(!/app\.quit\(\); \(/.test(inj.replace(/"(?:[^"\\]|\\.)*"/g, '""')));
});

test('master tools: scripts parse, the arguments are checked before any script', async () => {
  for (const [name, args] of [
    ['list_master_items', { master: 'A' }],
    ['set_master', { master: 'A', newName: 'Texte', prefix: 'T', basedOn: 'none' }],
    ['create_master', { name: 'Chapitre', pageCount: 2 }],
  ]) {
    const s = await scriptOf(name, args);
    assert.ok(parses(s).ok, `${name}: ${parses(s).message}`);
  }
  assert.match((await runTool('create_master', { name: 'X', fromIds: [1], pageNumberIds: [2] })).error.message, /pageNumberIds must be among fromIds/);
  assert.match((await runTool('create_master', { name: 'X', removeMatching: true })).error.message, /removeMatching needs fromIds/);
  assert.match((await runTool('create_master', { name: 'X', prefix: 'TOOLONG' })).error.message, /1 to 4 characters/);
  assert.match((await runTool('set_master', { master: 'A' })).error.message, /Pass newName/);
  assert.match((await runTool('remove_master_overrides', { page: '1', all: true })).error.message, /confirm/i);
  assert.match((await runTool('delete_master', { master: 'A' })).error.message, /confirm/i);
});

test('layer and style renames: scripts parse, built-in styles stay as they are', async () => {
  const s = await scriptOf('set_layer', { name: 'Calque 1', newName: 'Contenu', printable: false, color: 'GRAY' });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /layer\.name = "Contenu"/);
  const d = await scriptOf('delete_layer', { name: 'Notes', moveItemsTo: 'Contenu', confirmDestructive: true });
  assert.ok(parses(d).ok, parses(d).message);
  const p = await scriptOf('modify_paragraph_style', { styleName: 'Corps', newName: 'Texte courant' });
  assert.match(p, /pStyle\.name = "Texte courant"/);
  assert.match((await runTool('modify_paragraph_style', { styleName: '[Basic Paragraph]', newName: 'X' })).error.message, /cannot be renamed/);
});

test('alternate layouts: preset and orientation give the size, deleting asks for confirmation', async () => {
  const s = await scriptOf('create_alternate_layout', { name: 'Tablette', preset: 'A5', orientation: 'landscape', rule: 'scale' });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /var w = 210, h = 148/);
  assert.match(s, /LayoutRuleOptions\.SCALE/);
  assert.match((await runTool('create_alternate_layout', { name: 'X', width: 100 })).error.message, /both width and height/);
  assert.match((await runTool('delete_alternate_layout', { name: 'X' })).error.message, /confirm/i);
});
