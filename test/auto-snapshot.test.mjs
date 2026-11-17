/**
 * Automatic snapshot: before a tool that modifies the document, the pages it touches go into a
 * BEFORE snapshot (with one backup per document), so review_compare always has a "before".
 * A fake InDesign answers the scripts: the document info, the touched pages, the inventory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Review files and backups in a throwaway folder (os.tmpdir() follows TMPDIR)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-auto-'));
process.env.TMPDIR = TMP;
process.env.INDESIGN_ALLOWED_DIRS = TMP;
process.env.INDESIGN_BACKUP_DIR = path.join(TMP, 'backups');
process.env.INDESIGN_NOTES_PATH = path.join(TMP, 'NOTES.md');
delete process.env.INDESIGN_AUTO_SNAPSHOT;

const { InDesignMCPServer } = await import('../index.js');
const { createExecutor, memoryAdapter } = await import('../lib/executor.js');
const { REVIEW_MAX_CASES } = await import('../tools/review-tools.js');

const PAGES = { 101: { id: 101, name: '1', index: 0 }, 102: { id: 102, name: '2', index: 1 } };

function fakeServer({ docId = 7, touched = '101' } = {}) {
  const state = { docId, touched, scripts: [] };
  const answer = (script) => {
    state.scripts.push(script);
    if (script.includes('"PAGES\\n"')) return 'PAGES\n101\t1\t0\n102\t2\t1';
    if (script.includes('TOUCHED')) return `Doc.indd\n\n0\n0\n${state.docId}\nTOUCHED\n${state.touched}`;
    if (script.includes('Document created: ')) return `Document created: Sans titre-1 - A4\nDOCID ${state.docId}`;
    if (script.includes('INVENTORY')) {
      const m = /var __w = (\[[^\]]*\])/.exec(script);
      const ids = m ? JSON.parse(m[1]) : [101, 102];
      const pages = ids.filter((i) => PAGES[i]).map((i) => ({ ...PAGES[i], items: [] }));
      return 'INVENTORY\n' + JSON.stringify({ document: { name: 'Doc.indd', allPageIds: [101, 102] }, pages });
    }
    return 'ok';
  };
  const executor = createExecutor({ adapter: memoryAdapter(answer), tempDir: fs.mkdtempSync(path.join(TMP, 'exec-')) });
  return { server: new InDesignMCPServer({ executor }), state };
}

const call = async (server, name, args) => (await server.registry.call(name, args)).content.map((c) => c.text || '').join('\n');

test('the first change backs up the document and snapshots the touched page', async () => {
  const { server, state } = fakeServer();
  const out = await call(server, 'set_object_fill', { id: 55, swatch: 'Paper' });
  assert.match(out, /Auto snapshot before set_object_fill: backup .*Doc__.*auto-set-object-fill.*\.indd; snapshotId=\S+ – page 1\./);
  const w = server.workflow;
  assert.ok(w.lastSnapshot && w.prepared);
  assert.ok(fs.existsSync(path.join(TMP, 'indesign-mcp-review', w.lastSnapshot, 'before', 'inventory.json')));
  // the touched-pages script runs before the tool's own script
  const touchedAt = state.scripts.findIndex((s) => s.includes('TOUCHED'));
  const fillAt = state.scripts.findIndex((s) => s.includes('fillColor'));
  assert.ok(touchedAt >= 0 && touchedAt < fillAt);
});

test('later changes on the same page add nothing; a new page joins the same BEFORE, without a second backup', async () => {
  const { server, state } = fakeServer();
  await call(server, 'set_object_fill', { id: 55, swatch: 'Paper' });
  const id = server.workflow.lastSnapshot;
  const again = await call(server, 'set_object_fill', { id: 56, swatch: 'Paper' });
  assert.doesNotMatch(again, /Auto snapshot/);
  state.touched = '102';
  const other = await call(server, 'set_object_fill', { id: 80, swatch: 'Paper' });
  assert.match(other, new RegExp(`Auto snapshot: page 2 added to the BEFORE of snapshotId=${id}`));
  const before = JSON.parse(fs.readFileSync(path.join(TMP, 'indesign-mcp-review', id, 'before', 'inventory.json'), 'utf8'));
  assert.deepEqual(before.pageIds, [101, 102]);
  assert.equal(state.scripts.filter((s) => s.includes('saveACopy')).length, 1);
});

test('an explicit prepare_edit is reused by the automatic snapshot', async () => {
  const { server } = fakeServer();
  server.workflow.snapshots.set('Doc.indd', 'explicit-id');
  const dir = path.join(TMP, 'indesign-mcp-review', 'explicit-id', 'before');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify({ resolution: 96, pageIds: [101], pages: [PAGES[101]], document: {} }));
  const out = await call(server, 'set_object_fill', { id: 55, swatch: 'Paper' });
  assert.doesNotMatch(out, /Auto snapshot/);
});

test('documents built in this session and read-only tools get no snapshot', async () => {
  const { server, state } = fakeServer({ docId: 9 });
  await call(server, 'create_document', { preset: 'A4' });
  assert.ok(server.workflow.createdDocIds.has(9));
  const out = await call(server, 'create_rectangle', { x: 0, y: 0, width: 10, height: 10 });
  assert.doesNotMatch(out, /Auto snapshot/);
  const n = state.scripts.length;
  await call(server, 'list_page_items', { pageIndex: 0 });
  assert.equal(state.scripts.slice(n).filter((s) => s.includes('TOUCHED')).length, 0);
});

test('INDESIGN_AUTO_SNAPSHOT=0 turns it off', async () => {
  const { server, state } = fakeServer();
  process.env.INDESIGN_AUTO_SNAPSHOT = '0';
  try {
    await call(server, 'set_object_fill', { id: 55, swatch: 'Paper' });
    assert.equal(state.scripts.filter((s) => s.includes('TOUCHED')).length, 0);
  } finally {
    delete process.env.INDESIGN_AUTO_SNAPSHOT;
  }
});

test('review folders: older than 3 days removed, at most REVIEW_MAX_CASES kept, the ones in use stay', async () => {
  const root = path.join(TMP, 'indesign-mcp-review');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const old = (Date.now() - 4 * 24 * 3600 * 1000) / 1000;
  const total = REVIEW_MAX_CASES + 10;
  for (let i = 0; i < total; i++) {
    const d = path.join(root, `case-${String(i).padStart(3, '0')}`);
    fs.mkdirSync(d);
    const t = Date.now() / 1000 - 3600 + i;   // recent, the last one the newest
    fs.utimesSync(d, t, t);
  }
  fs.mkdirSync(path.join(root, 'stale'));
  fs.utimesSync(path.join(root, 'stale'), old, old);
  const { server } = fakeServer();
  server.workflow.snapshots.set('Other.indd', 'case-000');   // oldest, but still in use
  await call(server, 'set_object_fill', { id: 55, swatch: 'Paper' });
  const left = fs.readdirSync(root);
  assert.ok(!left.includes('stale'));
  assert.ok(left.includes('case-000'));
  assert.ok(left.includes(`case-${String(total - 1).padStart(3, '0')}`));
  assert.ok(left.includes(server.workflow.lastSnapshot));
  assert.ok(left.length <= REVIEW_MAX_CASES + 2, `${left.length} folders kept`);
});

test('move_page moves a page that is alone in its spread with its spread (objects bleeding off the page go along)', async () => {
  const { server, state } = fakeServer();
  await call(server, 'move_page', { page: '2', position: 'start' });
  const script = state.scripts.find((s) => s.includes('Moved page'));
  assert.match(script, /if \(sp\.pages\.length === 1 && \(!ref \|\| ref\.parent\.pages\.length === 1\)\)/);
  assert.match(script, /sp\.move\(LocationOptions\.AT_BEGINNING\)/);
  await call(server, 'move_page', { page: '1', after: '2' });
  const after = state.scripts.filter((s) => s.includes('Moved page')).pop();
  assert.match(after, /var ref = doc\.pages\.itemByID\(102\)/);
  assert.match(after, /sp\.move\(LocationOptions\.AFTER, ref\.parent\)/);
  assert.match(after, /pg\.move\(LocationOptions\.AFTER, ref\)/);   // facing spreads: the page alone
});
