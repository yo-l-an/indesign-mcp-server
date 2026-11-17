// Offline tests: run_script guard rails and notes, French typography rules, alignment tools, text
// frame options, alignment lines in the review, page-map shadows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { runTool, parses } from './harness.mjs';
import { checkDocumentScript } from '../tools/script-tools.js';
import { RULES } from '../tools/typo-tools.js';
import { createImage } from '../lib/png.js';
import { groupShadow, fillRect } from '../lib/raster.js';
import { compareSnapshots } from '../lib/review.js';
import { drawGuideLines, lineLabel, labelsFor } from '../lib/review-diff.js';

const scriptOf = async (name, args) => {
  const r = await runTool(name, args);
  if (r.error) throw r.error;
  return r.script;
};

test('run_script: document scripts pass, files / system / menus / saving / eval are refused', () => {
  for (const ok of ['var f = __findById(doc, 12); f.label = "x"; f.id', 'doc.pages[0].textFrames.length', 'var r = /a/.test("abc"); r']) {
    assert.doesNotThrow(() => checkDocumentScript(ok), ok);
  }
  for (const bad of ['File("/tmp/x").remove()', 'new Folder("~")', 'app.quit()', 'app["quit"]()', 'app.menuActions.itemByName("x").invoke()', 'doc.save()', 'doc.exportFile(1)', 'eval("app.quit()")', 'app.doScript("x")', 'system.callSystem("ls")', '$.evalFile("x")', '#include "x.jsx"', 'doc.close()']) {
    assert.throws(() => checkDocumentScript(bad), /document only/, bad);
  }
});

test('run_script wraps the code, keeps it a string, and writes a note', async () => {
  const notes = process.env.INDESIGN_NOTES_PATH;
  const before = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '';
  const s = await scriptOf('run_script', { purpose: 'count frames', code: 'doc.textFrames.length', missing: 'a count in get_document_info' });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /eval\("doc\.textFrames\.length"\)/);
  const after = fs.readFileSync(notes, 'utf8');
  assert.ok(after.length > before.length);
  assert.match(after, /workaround – count frames[\s\S]*Missing: a count in get_document_info[\s\S]*doc\.textFrames\.length/);
  assert.match((await runTool('run_script', { purpose: 'x', code: 'File("a")' })).error.message, /document only/);
});

test('French typography: every rule has steps, contextual rules are off, the choice of rules is checked', async () => {
  for (const [k, r] of Object.entries(RULES)) {
    assert.ok(r.steps.length && r.what, k);
    for (const st of r.steps) assert.ok(typeof st.find === 'string' && typeof st.change === 'string', k);
  }
  assert.equal(RULES.quotes.on, false);
  assert.equal(RULES.multiplication.on, false);
  assert.ok(RULES.ligatures.steps.some((s) => s.change === 'cœur'));
  const s = await scriptOf('french_typography', { frameId: 5, rules: { quotes: true, ordinals: false }, dryRun: true });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /"quotes"/);
  assert.doesNotMatch(s, /"ordinals"/);
  const only = await scriptOf('french_typography', { allPages: true, only: ['apostrophe'] });
  assert.doesNotMatch(only, /"ligatures"/);
  assert.match((await runTool('french_typography', { frameId: 5, rules: { nope: true } })).error.message, /Unknown rule: nope/);
  assert.match((await runTool('french_typography', {})).error.message, /Say where/);
});

test('alignment tools: scripts parse; columns / rows are checked before any script', async () => {
  for (const [name, args] of [
    ['snap_to_grid', { ids: [1, 2], tolerance: 2, targets: ['column', 'guide'], mode: 'move', axis: 'x', dryRun: true }],
    ['fit_to_grid', { ids: [1], columns: [3, 6], rows: [1, 2], rowCount: 6, fit: 'center' }],
  ]) {
    const s = await scriptOf(name, args);
    assert.ok(parses(s).ok, `${name}: ${parses(s).message}`);
  }
  assert.match((await runTool('fit_to_grid', { ids: [1] })).error.message, /columns and\/or rows/);
  assert.match((await runTool('fit_to_grid', { ids: [1], columns: [6, 3] })).error.message, /first <= last/);
  assert.match((await runTool('fit_to_grid', { ids: [1], rows: [1, 2] })).error.message, /rowCount/);
  assert.match((await runTool('snap_to_grid', { ids: [1], targets: ['nowhere'] })).error.message, /expected one of margin/);
  assert.match((await runTool('snap_to_grid', { ids: [] })).error.message, /ids/);
});

test('text frame options: first baseline, no line breaks with width auto-size, one inset for rounded corners', async () => {
  const s = await scriptOf('set_text_frame_options', { id: 3, firstBaseline: 'cap_height', autosize: 'HEIGHT_AND_WIDTH', autosizeReference: 'top-right', insetTop: 1, insetLeft: 2, baselineGrid: 'custom', baselineGridIncrement: 14, baselineGridRelativeTo: 'frame', textWrapOffsets: [1, 2, 3, 4], textWrapSide: 'largest_area', columnRuleWeight: 0.5 });
  assert.ok(parses(s).ok, parses(s).message);
  assert.match(s, /FirstBaseline\.CAP_HEIGHT/);
  assert.match(s, /useNoLineBreaksForAutoSizing = true/);
  assert.match(s, /AutoSizingReferenceEnum\.TOP_RIGHT_POINT/);
  assert.match(s, /oneInset/);
  assert.match(s, /BaselineFrameGridRelativeOption\.TOP_OF_FRAME/);
  assert.match(s, /TextWrapSideOptions\.LARGEST_AREA/);
  const h = await scriptOf('set_text_frame_options', { id: 3, autosize: 'HEIGHT_ONLY' });
  assert.doesNotMatch(h, /useNoLineBreaksForAutoSizing = /);
  assert.match((await runTool('set_text_frame_options', { id: 3, textWrapOffsets: [1, 2] })).error.message, /top, left, bottom, right/);
});

test('review: the lines an object was aligned on are drawn and named, only the ones it still touches', async () => {
  const L = labelsFor('fr');
  assert.equal(lineLabel({ kind: 'column-end', n: 6 }, L), 'fin col. 6');
  assert.equal(lineLabel({ kind: 'guide', pos: 105 }, L), 'repère 105');
  const img = createImage(210, 297);
  const out = drawGuideLines(img, [{ o: 'v', pos: 105, kind: 'guide' }], 210);
  const px = (x, y) => Array.from(out.data.slice((y * 210 + x) * 4, (y * 210 + x) * 4 + 3));
  assert.notDeepEqual(px(105, 1), [255, 255, 255]);
  assert.deepEqual(px(50, 1), [255, 255, 255]);

  const page = (items) => ({ id: 1, index: 0, number: 1, name: '1', widthMm: 210, heightMm: 297, items });
  const doc = { name: 'D', pageCount: 1, allPageIds: [1] };
  const before = { document: doc, pages: [page([{ id: 7, type: 'Rectangle', bounds: [98, 52, 138, 112] }, { id: 8, type: 'Rectangle', bounds: [10, 10, 20, 20] }])] };
  const after = { document: doc, pages: [page([{ id: 7, type: 'Rectangle', bounds: [100, 49.8, 140, 109.8] }, { id: 8, type: 'Rectangle', bounds: [10, 12, 20, 22] }])] };
  const pageImg = () => { const i = createImage(210, 297); fillRect(i, 50, 100, 60, 40, [0, 0, 0]); return i; };
  const alignments = new Map([
    [7, { lines: [{ o: 'v', pos: 49.8, kind: 'column-start', n: 3 }, { o: 'h', pos: 100, kind: 'master-guide' }] }],
    [8, { lines: [{ o: 'v', pos: 30, kind: 'margin' }] }],   // moved on since: no longer on that line
  ]);
  const res = await compareSnapshots({ before, after, source: { pageImage: pageImg, locatePages: async () => [], addPages: async () => [], thumbnails: async () => new Map(), alignments: () => alignments } });
  const alignRows = res.rows.filter((r) => r.property === 'Alignement');
  assert.equal(alignRows.length, 1);
  assert.match(alignRows[0].after, /aligné sur début col\. 3, repère du gabarit/);
});

test('page shadows: one per spread, never on a page, no light row under the page edge', () => {
  const img = createImage(120, 80, [255, 255, 255, 255]);
  const a = { x: 10, y: 10, w: 40, h: 50 }, b = { x: 50, y: 10, w: 40, h: 50 };
  groupShadow(img, [a, b]);
  const px = (x, y) => img.data[(y * 120 + x) * 4];
  assert.equal(px(49, 30), 255);          // on a page: untouched
  assert.equal(px(50, 30), 255);
  assert.ok(px(30, 60) < 255);            // right under the page edge: shadow, no white row
  assert.ok(px(30, 60) <= px(30, 63));    // fading out
});
