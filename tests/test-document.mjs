#!/usr/bin/env node
// Smoke test that builds one real InDesign test file through the MCP server (stdio).
//
//   npm run test:document
//   KEEP_OPEN=1 npm run test:document     (leave the document open in InDesign to inspect it)
//
// Each step calls the server like an MCP client would and checks the answer. The result is a
// saved document, tests/output/mcp-test-document.indd, plus a PDF and a PNG export of it, so
// you can open the file and look at what every tool produced.
// Documents that were already open in InDesign are never touched.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'output');
const INDD = path.join(OUT, 'mcp-test-document.indd');
const PDF = path.join(OUT, 'mcp-test-document.pdf');
const PNG_DIR = path.join(OUT, 'png');
const JPG = path.join(ROOT, 'sample-files', 'sample-1MB.jpg');
const FONT = process.env.INDESIGN_TEST_FONT || (process.platform === 'win32' ? 'Segoe UI' : 'Helvetica Neue');

fs.mkdirSync(OUT, { recursive: true });
for (const f of [INDD, PDF]) fs.rmSync(f, { force: true });
fs.rmSync(PNG_DIR, { recursive: true, force: true });

const results = [];
let client;
let docName;
const ids = {};

const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };
const idOf = (text) => Number(text.match(/\bid=(\d+)/)?.[1] ?? NaN);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (r.isError) throw new Error(`${name}: ${text}`);
  return { text, content: r.content };
}
async function fails(name, args, pattern) {
  let message;
  try {
    const r = await client.callTool({ name, arguments: args });
    if (!r.isError) throw new Error(`${name} should have failed`);
    message = r.content.map((c) => c.text).join('\n');
  } catch (error) {
    message = error.message;
    if (/should have failed/.test(message)) throw error;
  }
  if (pattern) assert(pattern.test(message), `${name} error should match ${pattern}, got: ${message}`);
}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name} (${Date.now() - t0} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n')[0]}`);
  }
}

client = new Client({ name: 'indesign-test-document', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'index.js')], cwd: ROOT,
  // the test files live in the repo, which is usually outside the default allowed directories
  env: { ...process.env, INDESIGN_ALLOWED_DIRS: [ROOT, process.env.INDESIGN_ALLOWED_DIRS].filter(Boolean).join(path.delimiter) } }));

console.log(`\nInDesign test document -> ${INDD}\n`);

await step('server lists its tools', async () => {
  const { tools } = await client.listTools();
  assert(tools.length >= 90, `expected >= 90 tools, got ${tools.length}`);
});

await step('create_document (A4, 3 pages, bleed)', async () => {
  const { text } = await call('create_document', { preset: 'A4', pages: 3, bleed: 3, marginTop: 15, marginBottom: 15, marginLeft: 15, marginRight: 15 });
  docName = text.match(/Document created: (.+?) - /)?.[1];
  assert(docName, `no document name in: ${text}`);
});

await step('get_document_info', async () => {
  const { text } = await call('get_document_info');
  assert(/3/.test(text) && /210/.test(text), `unexpected info: ${text.slice(0, 200)}`);
});

await step('save_document (Save As .indd)', async () => {
  await call('save_document', { filePath: INDD });
  assert(fs.existsSync(INDD), 'the .indd file was not written');
});

await step('create_layer + set_active_layer + list_layers', async () => {
  await call('create_layer', { name: 'MCP Shapes', color: 'GREEN' });
  await call('set_active_layer', { layerName: 'MCP Shapes' });
  const { text } = await call('list_layers');
  assert(/MCP Shapes/.test(text), 'layer missing');
});

await step('swatches: CMYK, RGB hex, gradient', async () => {
  await call('create_color_swatch', { name: 'MCP Blue', colorModel: 'CMYK', colorValues: [90, 50, 0, 0] });
  await call('create_color_swatch', { name: 'MCP Orange', hex: '#FF6600' });
  await call('create_gradient_swatch', { name: 'MCP Gradient', stops: [{ swatch: 'MCP Blue', position: 0 }, { swatch: 'MCP Orange', position: 100 }] });
  const { text } = await call('list_color_swatches');
  assert(/MCP Blue/.test(text) && /MCP Orange/.test(text) && /MCP Gradient/.test(text), 'swatch missing');
});

await step('styles: paragraph, character, object', async () => {
  await call('create_paragraph_style', { name: 'MCP Title', fontFamily: FONT, fontStyle: 'Bold', fontSize: 28, leading: 32 });
  await call('create_paragraph_style', { name: 'MCP Body', fontFamily: FONT, fontStyle: 'Regular', fontSize: 10, leading: 14 });
  await call('create_character_style', { name: 'MCP Accent', fontFamily: FONT, fontStyle: 'Bold', fillColor: 'MCP Orange' });
  await call('create_object_style', { name: 'MCP Card', fillColor: 'MCP Blue', strokeWeight: 0 });
  const { text } = await call('list_styles');
  for (const s of ['MCP Title', 'MCP Body', 'MCP Accent', 'MCP Card']) assert(text.includes(s), `style missing: ${s}`);
});

await step('text: create_text_frame + character style range', async () => {
  let r = await call('create_text_frame', { content: 'InDesign MCP - test document', paragraphStyle: 'MCP Title', x: 0, y: 0, width: 180, height: 20 });
  ids.title = idOf(r.text);
  r = await call('create_text_frame', {
    content: 'Every object on these pages was created through the MCP server.\nThe word important is styled with a character style.',
    paragraphStyle: 'MCP Body', x: 0, y: 25, width: 180, height: 30,
  });
  ids.body = idOf(r.text);
  assert(ids.title && ids.body, 'missing frame ids');
  await call('apply_character_style_to_range', { frameId: ids.body, styleName: 'MCP Accent', matchText: 'important' });
  const { text } = await call('get_text_content', { frameId: ids.body });
  assert(/created through the MCP server/.test(text), 'text not found');
});

await step('find_replace_text + measure_text', async () => {
  await call('find_replace_text', { findText: 'test document', replaceText: 'Test Document' , caseSensitive: true });
  const { text } = await call('get_text_content', { frameId: ids.title });
  assert(/Test Document/.test(text), 'replacement not applied');
  const m = await call('measure_text', { frameId: ids.body });
  assert(/overflow/i.test(m.text), `measure_text output: ${m.text.slice(0, 200)}`);
});

await step('insert_markdown_text', async () => {
  await call('create_paragraph_style', { name: 'Heading 1', fontFamily: FONT, fontStyle: 'Bold', fontSize: 16 });
  await call('create_character_style', { name: 'Bold', fontStyle: 'Bold' });
  await call('create_character_style', { name: 'Italic', fontStyle: 'Italic' });
  const r = await call('create_text_frame', { content: ' ', x: 0, y: 60, width: 180, height: 40 });
  ids.md = idOf(r.text);
  await call('insert_markdown_text', { frameId: ids.md, markdownText: '# Markdown heading\nA **bold** and an *italic* word.' });
  const { text } = await call('get_text_content', { frameId: ids.md });
  assert(/Markdown heading/.test(text) && !/\*\*/.test(text), `markdown not converted: ${text}`);
});

await step('shapes: rectangle, ellipse, line, polygon, star', async () => {
  let r = await call('create_rectangle', { x: 0, y: 110, width: 50, height: 35, fillColor: 'MCP Blue', cornerRadius: 4 });
  ids.rect = idOf(r.text);
  r = await call('create_ellipse', { x: 60, y: 110, width: 35, height: 35, fillColor: 'MCP Orange', strokeWeight: 0 });
  ids.ellipse = idOf(r.text);
  r = await call('create_line', { x1: 0, y1: 150, x2: 180, y2: 150, strokeColor: 'MCP Blue', strokeWidth: 2 });
  ids.line = idOf(r.text);
  r = await call('create_polygon', { x: 125, y: 127, radius: 17, sides: 6, fill: 'MCP Blue' });
  ids.hexagon = idOf(r.text);
  r = await call('create_polygon', { x: 165, y: 127, radius: 17, sides: 5, innerRadiusRatio: 0.45, fill: 'MCP Orange' });
  ids.star = idOf(r.text);
  for (const k of ['rect', 'ellipse', 'line', 'hexagon', 'star']) assert(Number.isFinite(ids[k]), `no id for ${k}`);
});

await step('vector: create_path_from_svg + edit_path_points', async () => {
  const r = await call('create_path_from_svg', { d: 'M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80', viewBox: '0 0 190 160', x: 0, y: 160, width: 90, height: 60, stroke: 'MCP Blue', strokeWeight: 3, fill: 'none' });
  ids.path = idOf(r.text);
  const { text } = await call('edit_path_points', { id: ids.path });
  assert(/anchor|point/i.test(text), `no point listing: ${text.slice(0, 200)}`);
});

await step('object edits: fill, stroke, opacity, rotate, geometry, corners', async () => {
  await call('set_object_fill', { id: ids.rect, gradient: 'MCP Gradient', gradientAngle: 45 });
  await call('set_object_stroke', { id: ids.ellipse, swatch: 'MCP Blue', weight: 2 });
  await call('set_object_opacity', { id: ids.hexagon, opacity: 60 });
  await call('rotate_object', { id: ids.star, angle: 15 });
  await call('set_object_geometry', { id: ids.ellipse, width: 30, height: 30 });
  await call('set_corner_options', { id: ids.rect, option: 'rounded', radius: 6 });
  const { text } = await call('get_object_info', { id: ids.ellipse });
  assert(/30/.test(text), `geometry not applied: ${text.slice(0, 200)}`);
});

await step('apply_object_style', async () => {
  const r = await call('create_rectangle', { x: 100, y: 160, width: 80, height: 60 });
  ids.card = idOf(r.text);
  await call('apply_object_style', { objectId: ids.card, styleName: 'MCP Card' });
});

await step('duplicate, group, ungroup, align, distribute', async () => {
  const d = await call('duplicate_object', { id: ids.ellipse, offsetX: 0, offsetY: 40 });
  ids.ellipse2 = idOf(d.text);
  const g = await call('group_objects', { ids: [ids.ellipse, ids.ellipse2] });
  ids.group = idOf(g.text);
  assert(Number.isFinite(ids.group), `no group id: ${g.text}`);
  await call('ungroup', { id: ids.group });
  await call('align_objects', { ids: [ids.rect, ids.ellipse, ids.hexagon], alignment: 'top' });
  await call('distribute_objects', { ids: [ids.rect, ids.ellipse, ids.hexagon, ids.star], distribution: 'horizontal_centers' });
});

await step('table: create_table + populate_table (page 2)', async () => {
  await call('create_table', { x: 0, y: 0, width: 180, height: 50, rows: 4, columns: 3, pageIndex: 1, headerRows: 1 });
  await call('populate_table', { tableIndex: 0, pageIndex: 1, data: [['Tool', 'Platform', 'Status'], ['create_table', 'Windows', 'ok'], ['populate_table', 'Windows', 'ok'], ['export_pdf', 'Windows', 'ok']] });
});

await step('place_image (JPEG sample, page 2)', async () => {
  const r = await call('place_image', { imagePath: JPG, x: 0, y: 60, width: 120, height: 80, pageIndex: 1, fitOption: 'FILL_PROPORTIONALLY' });
  ids.image = idOf(r.text);
  assert(Number.isFinite(ids.image), `no image id: ${r.text}`);
});

await step('pages: duplicate_page, add_page, delete_page, navigate', async () => {
  await call('duplicate_page', { pageIndex: 0, position: 'end' });
  await call('add_page', {});
  let info = (await call('get_document_info')).text;
  assert(/5/.test(info), `expected 5 pages: ${info.slice(0, 200)}`);
  await call('delete_page', { pageIndex: 4, confirmDestructive: true });
  await call('navigate_to_page', { pageIndex: 0 });
});

await step('listing: list_page_items, list_text_frames, get_selected_objects', async () => {
  const { text } = await call('list_page_items', { pageIndex: 0 });
  assert(text.includes(String(ids.rect)), 'rectangle missing from list_page_items');
  await call('list_text_frames', { pageIndex: 0 });
  // nothing is selected after a script run: the tool must say so instead of failing silently
  await fails('get_selected_objects', {}, /No objects selected/);
});

await step('quality: preflight, typography, text problems', async () => {
  await call('preflight_document');
  await call('find_typography_issues', { frameId: ids.body });
  await call('analyze_text_problems', { frameId: ids.body });
});

await step('render_preview returns an image', async () => {
  const { content } = await call('render_preview', { pageIndex: 0, resolution: 36 });
  assert(content.some((c) => c.type === 'image'), 'no image block in render_preview');
});

await step('safety: destructive tools need confirmDestructive', async () => {
  await fails('export_pdf', { filePath: PDF }, /confirm/i);
  await fails('execute_indesign_code', { code: 'app.version' }, /disabled|INDESIGN_ALLOW_ARBITRARY_CODE/i);
});

await step('save_document (own file)', async () => {
  await call('save_document', {});
  assert(fs.statSync(INDD).size > 0, 'empty .indd');
});

await step('export_pdf', async () => {
  await call('export_pdf', { filePath: PDF, preset: 'HighQualityPrint', includeBleed: true, confirmDestructive: true });
  assert(fs.existsSync(PDF) && fs.statSync(PDF).size > 1000, 'PDF missing');
  // the aliases must also find the built-in presets in a localised InDesign (e.g. "[Taille de fichier minimale]")
  const web = PDF.replace(/\.pdf$/, '-web.pdf');
  const { text } = await call('export_pdf', { filePath: web, preset: 'Web', pageRange: '1', confirmDestructive: true });
  assert(fs.existsSync(web) && /effective preset \[/.test(text), `Web preset export failed: ${text}`);
});

await step('export_images (PNG, 72 dpi)', async () => {
  fs.mkdirSync(PNG_DIR, { recursive: true });
  await call('export_images', { folderPath: PNG_DIR, format: 'PNG', resolution: 72, pageRange: '1', confirmDestructive: true });
  assert(fs.readdirSync(PNG_DIR).some((f) => /\.png$/i.test(f)), 'no PNG written');
});

if (docName && !process.env.KEEP_OPEN) {
  await step('close_document', async () => {
    await call('close_document', { name: path.basename(INDD), confirmDestructive: true });
  });
}

await client.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
console.log(`Test file: ${INDD}`);
process.exit(failed.length ? 1 : 0);
