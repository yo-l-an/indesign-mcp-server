/**
 * Typesetting and page-size options: the scripts carry the requested values, and values
 * out of range are refused before any script runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool, parses } from './harness.mjs';

const ok = async (tool, args) => {
  const { error, script } = await runTool(tool, args);
  assert.equal(error, null, `${tool} refused: ${error && error.message}`);
  assert.ok(parses(script).ok, `${tool}: script does not parse`);
  return script;
};

test('create_text_frame and edit_text_frame set leading, tracking and horizontal scale locally', async () => {
  const create = await ok('create_text_frame', { content: 'THINK', leading: 114, tracking: -20, horizontalScale: 85 });
  assert.match(create, /range\.leading = 114;/);
  assert.match(create, /range\.tracking = -20;/);
  assert.match(create, /range\.horizontalScale = 85;/);
  const edit = await ok('edit_text_frame', { frameId: 12, horizontalScale: 120 });
  assert.match(edit, /range\.horizontalScale = 120;/);
  assert.doesNotMatch(edit, /range\.leading/);
});

test('horizontal scale and leading out of range are refused', async () => {
  for (const args of [{ horizontalScale: 0 }, { horizontalScale: 1001 }, { leading: 0 }]) {
    const { error } = await runTool('create_text_frame', { content: 'x', ...args });
    assert.ok(error, `accepted ${JSON.stringify(args)}`);
  }
});

test('paragraph and character styles take a horizontal scale', async () => {
  assert.match(await ok('create_paragraph_style', { name: 'Hero', horizontalScale: 90 }), /pStyle\.horizontalScale = 90;/);
  assert.match(await ok('create_character_style', { name: 'Wide', horizontalScale: 110 }), /style\.horizontalScale = 110;/);
});

test('modify_* style tools accept name as well as styleName', async () => {
  assert.match(await ok('modify_paragraph_style', { name: 'Headline', fontSize: 39.5 }), /__pstyle\(doc, "Headline"\)/);
  assert.match(await ok('modify_character_style', { name: 'Accent', tracking: 10 }), /__cstyle\(doc, "Accent"\)/);
  assert.match(await ok('modify_object_style', { name: 'Box', strokeWidth: 1 }), /__ostyle\(doc, "Box"\)/);
  assert.match(await ok('modify_paragraph_style', { styleName: 'Wins', name: 'Loses', fontSize: 9 }), /__pstyle\(doc, "Wins"\)/);
  const { error } = await runTool('modify_paragraph_style', { fontSize: 9 });
  assert.match(error.message, /styleName \(or name\) is required/);
});

test('create_color_swatch refuses names InDesign reserves for built-in colours', async () => {
  const script = await ok('create_color_swatch', { name: 'Yellow', hex: '#FFD100' });
  // a colour that exists but is not a swatch (Cyan, Magenta, Yellow) is reported before anything changes
  const guard = script.indexOf('reserves for a built-in colour');
  assert.ok(guard > 0 && guard < script.indexOf('doc.colors.add()'));
});

test('measure_text inkBounds outlines a temporary copy', async () => {
  const plain = await ok('measure_text', { frameId: 7 });
  assert.doesNotMatch(plain, /createOutlines/);
  const ink = await ok('measure_text', { frameId: 7, inkBounds: true });
  assert.match(ink, /frame\.duplicate\(\)/);
  assert.match(ink, /createOutlines\(true\)/);
  assert.match(ink, /copy\.remove\(\)/);
});

test('set_text_frame_options: auto-size keeps the top-left corner unless told otherwise', async () => {
  const dflt = await ok('set_text_frame_options', { id: 3, autosize: 'HEIGHT_AND_WIDTH' });
  assert.ok(dflt.indexOf('TOP_LEFT_POINT') > 0 && dflt.indexOf('TOP_LEFT_POINT') < dflt.indexOf('autoSizingType'));
  assert.match(await ok('set_text_frame_options', { id: 3, autosize: 'WIDTH_ONLY', autosizeReference: 'center' }), /AutoSizingReferenceEnum\.CENTER_POINT/);
  assert.doesNotMatch(await ok('set_text_frame_options', { id: 3, autosize: 'OFF' }), /autoSizingReferencePoint =/);
  assert.match(await ok('set_text_frame_options', { id: 3, autosizeReference: 'bottom-right' }), /BOTTOM_RIGHT_POINT/);
});

test('set_page_size and add_page give pages their own size', async () => {
  const one = await ok('set_page_size', { pageIndexes: [0], height: 159 });
  assert.match(one, /AnchorPoint\.TOP_LEFT_ANCHOR/);
  assert.match(one, /__h = 159/);
  assert.match(one, /__w = __pb\[3\] - __pb\[1\]/);
  assert.match(await ok('set_page_size', { width: 210, height: 297, anchor: 'center' }), /CENTER_ANCHOR/);
  assert.match(await ok('add_page', { width: 283, height: 170.5 }), /pg\.resize\(/);
  assert.doesNotMatch(await ok('add_page', {}), /pg\.resize\(/);
  for (const args of [{}, { height: 0 }, { width: 6000 }]) {
    const { error } = await runTool('set_page_size', args);
    assert.ok(error, `accepted ${JSON.stringify(args)}`);
  }
});

test('group_objects names the group and checks the spread; name_object names any object', async () => {
  const g = await ok('group_objects', { ids: [3, 4], name: 'Info box' });
  assert.match(g, /g\.name = "Info box";/);
  assert.match(g, /are on different spreads/);
  assert.doesNotMatch(await ok('group_objects', { ids: [3, 4] }), /g\.name =/);
  assert.match(await ok('name_object', { id: 9, name: 'Background' }), /it\.name = "Background";/);
  const { error } = await runTool('name_object', { id: 9 });
  assert.ok(error);
});
