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

test('check_server_updates: a copy has nothing to do; a clone fast-forwards, local changes are kept', async () => {
  const { checkServerUpdates } = await import('../tools/notes-tools.js');
  const { execFileSync } = await import('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-update-'));
  const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();
  const copy = path.join(tmp, 'copy');
  fs.mkdirSync(copy);
  assert.equal((await checkServerUpdates(copy)).state, 'copy');
  // origin with one commit, a clone of it, then a new commit on origin
  const origin = path.join(tmp, 'origin');
  fs.mkdirSync(origin);
  g(origin, 'init', '-q');
  fs.writeFileSync(path.join(origin, 'a.js'), '1');
  g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'first');
  g(tmp, 'clone', '-q', origin, 'clone');
  const clone = path.join(tmp, 'clone');
  assert.equal((await checkServerUpdates(clone)).state, 'up-to-date');
  fs.writeFileSync(path.join(origin, 'a.js'), '2');
  g(origin, 'commit', '-qam', 'fix export');
  const listed = await checkServerUpdates(clone, { apply: false });
  assert.equal(listed.state, 'behind');
  assert.match(listed.text, /1 new commit\(s\)[\s\S]*fix export/);
  // a local fix in the clone: not overwritten
  fs.writeFileSync(path.join(clone, 'a.js'), 'local');
  assert.equal((await checkServerUpdates(clone)).state, 'local-changes');
  assert.equal(fs.readFileSync(path.join(clone, 'a.js'), 'utf8'), 'local');
  g(clone, 'checkout', '-q', '--', 'a.js');
  const done = await checkServerUpdates(clone);
  assert.equal(done.state, 'updated', done.text);
  assert.match(done.text, /restart/);
  assert.equal(fs.readFileSync(path.join(clone, 'a.js'), 'utf8'), '2');
});
