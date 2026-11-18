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
function runWrapper(script, prefs = { userInteractionLevel: 1 }) {
  const files = {};
  class File {
    constructor(p) { this.p = p; }
    open() {} close() {}
    write(t) { files[this.p] = t; }
  }
  const ctx = {
    File,
    app: { documents: { length: 0 }, scriptPreferences: prefs },
    UserInteractionLevels: { NEVER_INTERACT: 0 },
    MeasurementUnits: {}, RulerOrigin: {}, AutoEnum: { AUTO_VALUE: 'auto' },
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

test('wrapper: script units are the default while a tool runs, and given back afterwards', () => {
  const prefs = { userInteractionLevel: 1, measurementUnit: 'mm' };   // left by another script
  assert.equal(runWrapper('app.scriptPreferences.measurementUnit;', prefs), 'OK\nauto');
  assert.equal(prefs.measurementUnit, 'mm');
});

test('a tool whose script throws fails through tools/call', async () => {
  const { InDesignMCPServer } = await import('../index.js');
  const server = new InDesignMCPServer({ executor: createExecutor({ tempDir: tmp(), adapter: memoryAdapter(() => { throw new Error('No document open'); }) }) });
  const call = server.server._requestHandlers.get('tools/call');
  await assert.rejects(call({ method: 'tools/call', params: { name: 'add_page', arguments: {} } }, {}), /No document open/);
});

// ---- the macOS worker adapter, driven by a fake worker that speaks the same line protocol ----------
import { jxaWorkerAdapter } from '../lib/executor.js';

// The fake runs a .jsx as plain JS (enough for these scripts) unless its path says otherwise
const FAKE_WORKER = `
const fs = require('fs');
let buf = '';
process.stdout.write('READY\\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const file = buf.slice(0, i); buf = buf.slice(i + 1);
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes('HANG')) continue;
    if (src.includes('CRASH')) process.exit(3);
    if (src.includes('NOT_RUNNING')) { process.stdout.write('ERR -600 Application is not running.\\n'); continue; }
    const m = /RESULT:(\\S+)/.exec(src);
    fs.writeFileSync(m[1], 'OK\\n' + (src.match(/VALUE:(\\S+)/) || [, 'x'])[1]);
    process.stdout.write('OK\\n');
  }
});
`;

function fakeWorker({ starts = { n: 0 }, ...opts } = {}) {
  const dir = tmp();
  const fake = path.join(dir, 'fake-worker.cjs');
  fs.writeFileSync(fake, FAKE_WORKER);
  const adapter = jxaWorkerAdapter({ appName: 'Fake InDesign', command: () => { starts.n++; return [process.execPath, [fake]]; }, log: () => {}, ...opts });
  return { dir, adapter, starts };
}

// Run a "script" through the adapter the way the executor does: the job carries the result file
async function launch(adapter, dir, body) {
  const id = Math.random().toString(36).slice(2);
  const jsxFile = path.join(dir, `s_${id}.jsx`), resultFile = path.join(dir, `r_${id}.txt`);
  fs.writeFileSync(jsxFile, `${body} RESULT:${resultFile}`);
  await adapter.launch({ jsxFile, resultFile, tempDir: dir });
  return fs.readFileSync(resultFile, 'utf8');
}

test('worker: one process serves many scripts', async () => {
  const { dir, adapter, starts } = fakeWorker();
  for (let i = 0; i < 5; i++) assert.equal(await launch(adapter, dir, `VALUE:v${i}`), `OK\nv${i}`);
  assert.equal(starts.n, 1, 'started once');
});

test('worker: InDesign errors keep their meaning, a crash or a hang gets a fresh worker', async () => {
  const { dir, adapter, starts } = fakeWorker({ timeoutMs: 300 });
  await assert.rejects(launch(adapter, dir, 'NOT_RUNNING'), /InDesign is not running or not reachable \(AppleScript error -600\)/);
  await assert.rejects(launch(adapter, dir, 'HANG'), /did not respond in time/);
  assert.equal(await launch(adapter, dir, 'VALUE:after-hang'), 'OK\nafter-hang');
  await assert.rejects(launch(adapter, dir, 'CRASH'), /worker stopped/);
  assert.equal(await launch(adapter, dir, 'VALUE:after-crash'), 'OK\nafter-crash');
  assert.equal(starts.n, 3);
});

test('worker: when it cannot start, calls go through the fallback', async () => {
  const dir = tmp();
  const used = [];
  const adapter = jxaWorkerAdapter({ appName: 'X', startMs: 300, log: () => {}, command: () => [process.execPath, ['-e', 'setTimeout(() => {}, 5000)']], fallback: { launch: async (job) => { used.push(job.jsxFile); fs.writeFileSync(job.resultFile, 'OK\nslow'); } } });
  assert.equal(await launch(adapter, dir, 'VALUE:x'), 'OK\nslow');
  assert.equal(await launch(adapter, dir, 'VALUE:y'), 'OK\nslow');
  assert.equal(used.length, 2, 'later calls go straight to the fallback');
});
