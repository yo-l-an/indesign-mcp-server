// Script execution seam: envelope, queue, debug files, and the real wrapper run in a sandbox
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { createExecutor, memoryAdapter, parseEnvelope, formatEnvelope } from '../lib/executor.js';
import { buildWrapper } from '../lib/script-runtime.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-exec-'));

test('envelope round trip', () => {
  assert.deepEqual(parseEnvelope(formatEnvelope({ ok: true, value: 'a\nb' })), { ok: true, value: 'a\nb' });
  assert.deepEqual(parseEnvelope('OK-'), { ok: true, value: '(no return value)' });
  assert.deepEqual(parseEnvelope(formatEnvelope({ ok: false, code: 30477, line: 12, message: 'Invalid object' })), { ok: false, code: '30477', line: '12', message: 'Invalid object' });
  assert.deepEqual(parseEnvelope('Error: looks like an error'), { ok: true, value: 'Error: looks like an error' }, 'wording never decides');
});

test('values come back, thrown errors reject, our own errors leave no file behind', async () => {
  const dir = tmp();
  const ex = createExecutor({ tempDir: dir, adapter: memoryAdapter((s) => { if (s === 'bad') throw new Error('No document open'); return `ran ${s}`; }) });
  assert.equal(await ex.run('x'), 'ran x');
  assert.equal(await ex.run('Error: fine'), 'ran Error: fine');
  await assert.rejects(ex.run('bad'), (e) => e.message === 'No document open' && e.expected === true);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an InDesign error keeps its script for debugging', async () => {
  const dir = tmp();
  const err = Object.assign(new Error('Object is invalid'), { number: 30477 });
  const ex = createExecutor({ tempDir: dir, log: () => {}, adapter: memoryAdapter(() => { throw err; }) });
  await assert.rejects(ex.run('boom'), (e) => /Object is invalid \(Code: 30477, Line: unknown\) \[debug script: .*script_.*\.jsx\]/.test(e.message) && e.code === '30477');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.jsx')).length, 1);
});

test('scripts run one at a time', async () => {
  let active = 0, peak = 0;
  const ex = createExecutor({ tempDir: tmp(), adapter: memoryAdapter(async (s) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return s; }) });
  const out = await Promise.all(['a', 'b', 'c'].map((s) => ex.run(s)));
  assert.deepEqual(out, ['a', 'b', 'c']);
  assert.equal(peak, 1);
});

// The generated wrapper, run against a tiny stand-in for the ExtendScript globals
function runWrapper(script) {
  const files = {};
  class File {
    constructor(p) { this.p = p; }
    open() {} close() {}
    write(t) { files[this.p] = t; }
  }
  const ctx = {
    File,
    app: { documents: { length: 0 }, scriptPreferences: { userInteractionLevel: 1 } },
    UserInteractionLevels: { NEVER_INTERACT: 0 },
    MeasurementUnits: {}, RulerOrigin: {},
  };
  vm.createContext(ctx);
  vm.runInContext(buildWrapper(script, '/r.txt'), ctx);
  return files['/r.txt'];
}

test('wrapper writes the envelope: value, no value, thrown error', () => {
  assert.equal(runWrapper('"Er" + "ror: just text";'), 'OK\nError: just text');
  assert.equal(runWrapper('var x = 1;'), 'OK-');
  assert.match(runWrapper('throw new Error("Style not found");'), /^ERR n\/a \S+\nStyle not found$/);
});

test('a tool whose script throws fails through tools/call', async () => {
  const { InDesignMCPServer } = await import('../index.js');
  const server = new InDesignMCPServer({ executor: createExecutor({ tempDir: tmp(), adapter: memoryAdapter(() => { throw new Error('No document open'); }) }) });
  const call = server.server._requestHandlers.get('tools/call');
  await assert.rejects(call({ method: 'tools/call', params: { name: 'add_page', arguments: {} } }, {}), /No document open/);
});
