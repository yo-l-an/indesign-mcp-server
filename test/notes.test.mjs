// Improvement notes: appended to NOTES.md, numbered, local fixes must list their files
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRegistry } from '../lib/registry.js';
import { createNotesTools } from '../tools/notes-tools.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-notes-')), 'NOTES.md');
process.env.INDESIGN_NOTES_PATH = file;
const reg = createRegistry([createNotesTools()]);
const text = async (name, args) => (await reg.call(name, args)).content[0].text;

test('notes are appended, numbered, and readable', async () => {
  assert.match(await text('read_improvement_notes', {}), /No notes yet/);
  const out = await text('add_improvement_note', { kind: 'bug', title: 'export_pdf  ignores\nthe slug', details: 'Steps: …', tool: 'export_pdf' });
  assert.match(out, /Note N1 written to .*NOTES\.md/);
  assert.match(out, /tell the user in one short paragraph/);
  await text('add_improvement_note', { kind: 'workaround', title: 'Faster page moves', details: 'Use move_page.', status: 'workaround-found' });
  const notes = await text('read_improvement_notes', {});
  assert.match(notes, /^Notes file: .*NOTES\.md\nServer folder .*\n\n# Improvement notes/);
  assert.match(notes, /## N1 – bug – export_pdf ignores the slug\n\n- Date: .* · server \d+\.\d+\.\d+\n- Status: wanted\n- Tool: `export_pdf`\n\nSteps: …/);
  assert.match(notes, /## N2 – workaround – Faster page moves/);
  assert.equal(notes.match(/^# Improvement notes/gm).length, 1, 'one header');
});

test('a local fix lists every file it changed', async () => {
  await assert.rejects(reg.call('add_improvement_note', { kind: 'bug', title: 'x', details: 'y', status: 'fixed-locally' }), /needs filesChanged/);
  const out = await text('add_improvement_note', { kind: 'bug', title: 'Overset check', details: 'Fixed.', status: 'fixed-locally', filesChanged: ['tools/text-tools.js: count overset lines'] });
  assert.match(out, /with the local fixes you made/);
  assert.match(fs.readFileSync(file, 'utf8'), /- Files changed:\n  - tools\/text-tools\.js: count overset lines/);
});
