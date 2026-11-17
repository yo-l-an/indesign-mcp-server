// Script execution: the one seam between the tools and InDesign.
//
//   const executor = createExecutor();                       // JXA worker (macOS) or COM (Windows)
//   const executor = createExecutor({ adapter: memoryAdapter((script) => 'ok') });   // tests
//   await executor.run(script)   -> the script's last expression, as a string
//
// The executor wraps the script (PRELUDE, millimetres, no dialogs), runs one script at a time,
// and reads a result envelope written by the wrapper: "OK" + value, or "ERR" + code + line +
// message. A thrown error is the only way a script reports a failure; the wording of a returned
// value never matters. Failed scripts are kept in the temp folder for debugging (3 days).

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appleScriptStr, describeOsascriptError, buildWrapper } from './script-runtime.js';
import * as windowsLauncher from './launcher-windows.js';

const IS_WINDOWS = process.platform === 'win32';
const KEEP_MS = 3 * 24 * 3600 * 1000;

// ---- result envelope ------------------------------------------------------------------------------

// Envelope text: "OK\n<value>", "OK-" (no value), or "ERR <code> <line>\n<message>"
export function parseEnvelope(text) {
  if (text === null || text === undefined) return { ok: true, value: '(no return value)' };
  if (text === 'OK-') return { ok: true, value: '(no return value)' };
  if (text.startsWith('OK\n')) return { ok: true, value: text.slice(3) };
  const m = /^ERR (\S+) (\S+)\n([\s\S]*)$/.exec(text);
  if (m) return { ok: false, code: m[1], line: m[2], message: m[3] };
  return { ok: true, value: text };   // a wrapper from an older build
}

export function formatEnvelope(outcome) {
  if (outcome.ok) return outcome.value === undefined || outcome.value === null ? 'OK-' : `OK\n${String(outcome.value)}`;
  return `ERR ${outcome.code ?? 'n/a'} ${outcome.line ?? 'unknown'}\n${outcome.message}`;
}

// A failure raised by our own scripts (throw new Error) is expected: bad id, missing style...
// InDesign's own errors carry an error number and keep their script for debugging.
const isExpected = (code) => code === 'n/a' || code === '1' || code === 'undefined';

// ---- adapters: how a wrapped script reaches InDesign ---------------------------------------------

// macOS: AppleScript `do script`; the AppleScript only holds the app name and the script path
export function osascriptAdapter({ appName = resolveAppName } = {}) {
  let name = null;
  const app = () => (name ||= typeof appName === 'function' ? appName() : appName);
  return {
    name: 'osascript',
    get appName() { return app(); },
    async launch({ jsxFile, tempDir }) {
      const file = path.join(tempDir, `applescript_${stamp()}.scpt`);
      fs.writeFileSync(file, `tell application ${appleScriptStr(app())}\n  do script (POSIX file ${appleScriptStr(jsxFile)}) language javascript\nend tell`, 'utf8');
      try {
        execSync(`osascript ${JSON.stringify(file)}`, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
        fs.unlinkSync(file);
      } catch (error) {
        const err = new Error(describeOsascriptError(error));
        err.debugFile = file;
        throw err;
      }
    },
  };
}

// macOS, fast path: one long-running JXA process (osascript -l JavaScript) keeps the Apple Event
// connection to InDesign and runs each script file on request. A new osascript per call costs
// ~200 ms (process start + connection); a call through the worker ~15 ms. Protocol: one script
// path per line on stdin, one line back: OK | ERR <number> <message>. When the worker cannot
// start, calls go through osascriptAdapter instead (INDESIGN_EXECUTOR=osascript forces that).
const JXA_WORKER = `ObjC.import('Foundation');
function run(argv) {
  var app = Application(argv[0]);
  var stdin = $.NSFileHandle.fileHandleWithStandardInput;
  var stdout = $.NSFileHandle.fileHandleWithStandardOutput;
  var write = function (s) { stdout.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); };
  var buf = '';
  write('READY');
  for (;;) {
    var data = stdin.availableData;
    if (Number(data.length) === 0) return '';
    buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    var nl;
    while ((nl = buf.indexOf('\\n')) >= 0) {
      var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      try { app.doScript(Path(line), { language: 'javascript' }); write('OK'); }
      catch (e) { write('ERR ' + (e.errorNumber || 0) + ' ' + String(e.message || e).replace(/\\s+/g, ' ')); }
    }
  }
}
`;

// command(workerFile, appName) -> [program, args]: tests swap in a fake worker speaking the protocol
const osascriptWorker = (file, appName) => ['osascript', ['-l', 'JavaScript', file, appName]];

export function jxaWorkerAdapter({ appName = resolveAppName, timeoutMs = 60000, startMs = 15000, fallback = null, command = osascriptWorker, log = (m) => console.error(m) } = {}) {
  let name = null;
  const app = () => (name ||= typeof appName === 'function' ? appName() : appName);
  const slow = fallback || osascriptAdapter({ appName: app });
  let worker = null;        // { child, lines: [], waiting: null }
  let broken = false;

  const stop = () => {
    if (!worker) return;
    try { worker.child.kill(); } catch { /* gone */ }
    worker = null;
  };
  process.once('exit', stop);

  // Next line from the worker, or a rejection after ms / when it exits
  const nextLine = (w, ms, onTimeout) => new Promise((resolve, reject) => {
    if (w.lines.length) return resolve(w.lines.shift());
    const timer = setTimeout(() => { w.waiting = null; reject(onTimeout()); }, ms);
    w.waiting = {
      line: (l) => { clearTimeout(timer); w.waiting = null; resolve(l); },
      exit: (err) => { clearTimeout(timer); w.waiting = null; reject(err); },
    };
  });

  const start = async (tempDir) => {
    const file = path.join(tempDir, 'jxa-worker.js');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== JXA_WORKER) fs.writeFileSync(file, JXA_WORKER, 'utf8');
    const [program, args] = command(file, app());
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const w = { child, lines: [], waiting: null, stderr: '' };
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (w.waiting) w.waiting.line(line); else w.lines.push(line);
      }
    });
    child.stderr.on('data', (d) => { w.stderr = (w.stderr + d).slice(-2000); });
    const gone = (why) => {
      if (worker === w) worker = null;
      if (w.waiting) w.waiting.exit(new Error(describeOsascriptError({ message: w.stderr.trim() || why })));
    };
    child.on('exit', (code) => gone(`The InDesign script worker stopped (exit ${code})`));
    child.on('error', (e) => gone(e.message));
    // the server must be able to exit while the worker waits for work
    child.unref(); child.stdin.unref?.(); child.stdout.unref?.(); child.stderr.unref?.();
    const ready = await nextLine(w, startMs, () => new Error('worker did not start'));
    if (ready !== 'READY') throw new Error(`worker did not start: ${ready}`);
    return w;
  };

  return {
    name: 'jxa-worker',
    get appName() { return app(); },
    async launch(job) {
      if (broken || process.env.INDESIGN_EXECUTOR === 'osascript') return slow.launch(job);
      if (!worker) {
        try {
          worker = await start(job.tempDir);
        } catch (e) {
          stop();
          broken = true;
          log(`[indesign-mcp] fast script worker unavailable (${e.message}); using osascript per call`);
          return slow.launch(job);
        }
      }
      const w = worker;
      w.child.stdin.write(`${job.jsxFile}\n`);
      const line = await nextLine(w, timeoutMs, () => {
        stop();   // the worker is stuck in InDesign: start a fresh one next time
        return new Error('InDesign did not respond in time (is a dialog open in InDesign?)');
      });
      if (line === 'OK') return;
      const m = /^ERR (-?\d+) (.*)$/.exec(line);
      const err = new Error(describeOsascriptError({ message: m ? `${m[2]} (${m[1]})` : line }));
      throw err;
    },
  };
}

// Windows: COM DoScript through a small JScript launcher (lib/launcher-windows.js)
export function comAdapter() {
  let progId = null, seen = false, coldStartAt = 0;
  const prog = () => (progId ||= windowsLauncher.resolveProgId());
  return {
    name: 'com',
    get appName() { return process.env.INDESIGN_APP_NAME || windowsLauncher.appNameForProgId(prog()); },
    async launch({ jsxFile }) {
      const launcher = jsxFile.replace(/\.jsx$/, '.launcher.js');
      fs.writeFileSync(launcher, windowsLauncher.launcherSource(prog(), jsxFile), 'ascii');
      // COM starts InDesign when it is not running; a cold start can take minutes, and InDesign
      // stays slow for a while after it, so later calls get the long timeout too
      if (!seen && !windowsLauncher.isInDesignRunning()) coldStartAt = Date.now();
      const warmingUp = coldStartAt && Date.now() - coldStartAt < 180000;
      try {
        windowsLauncher.runLauncher(launcher, warmingUp ? 300000 : 60000);
        seen = true;
      } finally {
        fs.rmSync(launcher, { force: true });
      }
    },
  };
}

// Tests: respond(script, { tempDir }) returns the value or throws; files it writes in tempDir
// are visible to the tool, as with InDesign
export function memoryAdapter(respond) {
  return {
    name: 'memory',
    appName: 'InDesign (in memory)',
    async launch({ script, resultFile, tempDir }) {
      let outcome;
      try {
        outcome = { ok: true, value: await respond(script, { tempDir }) };
      } catch (e) {
        outcome = { ok: false, code: e.number ?? 'n/a', line: e.line ?? 'unknown', message: e.message };
      }
      fs.writeFileSync(resultFile, formatEnvelope(outcome), 'utf8');
    },
  };
}

// Installed InDesign application name: INDESIGN_APP_NAME, a running InDesign, the newest
// "Adobe InDesign <year>.app" on disk, then a default
export function resolveAppName() {
  if (process.env.INDESIGN_APP_NAME) return process.env.INDESIGN_APP_NAME;
  try {
    const running = execSync(
      `osascript -e 'tell application "System Events" to get name of (processes whose name starts with "Adobe InDesign")'`,
      { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (running) return running.split(',')[0].trim();
  } catch { /* System Events unavailable or nothing running */ }
  const candidates = [];
  for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    let entries;
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const entry of entries) {
      if (!/^Adobe InDesign/.test(entry)) continue;
      if (/\.app$/.test(entry)) { candidates.push(entry.replace(/\.app$/, '')); continue; }
      try {
        for (const inner of fs.readdirSync(path.join(base, entry))) if (/^Adobe InDesign.*\.app$/.test(inner)) candidates.push(inner.replace(/\.app$/, ''));
      } catch { /* not a folder */ }
    }
  }
  const ver = (n) => parseInt((n.match(/\d+/) || [0])[0], 10) || 0;
  candidates.sort((a, b) => ver(b) - ver(a));
  return candidates[0] || 'Adobe InDesign 2026';
}

const stamp = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// ---- executor -------------------------------------------------------------------------------------

export function createExecutor({ adapter = IS_WINDOWS ? comAdapter() : jxaWorkerAdapter(), tempDir = path.join(os.tmpdir(), 'indesign-mcp'), log = (m) => console.error(m) } = {}) {
  fs.mkdirSync(tempDir, { recursive: true });
  let queue = Promise.resolve();
  let pruned = false;

  const prune = () => {
    if (pruned) return;
    pruned = true;
    const cutoff = Date.now() - KEEP_MS;
    try {
      for (const f of fs.readdirSync(tempDir)) {
        const fp = path.join(tempDir, f);
        const st = fs.statSync(fp);
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(fp);
      }
    } catch { /* best effort */ }
  };

  const runOne = async (script) => {
    const id = stamp();
    const jsxFile = path.join(tempDir, `script_${id}.jsx`);
    const resultFile = path.join(tempDir, `result_${id}.txt`);
    fs.writeFileSync(jsxFile, buildWrapper(script, resultFile.replace(/\\/g, '/')), 'utf8');
    let keep = false;
    try {
      await adapter.launch({ jsxFile, resultFile, script, tempDir });
      const out = parseEnvelope(fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : null);
      if (out.ok) return out.value;
      // InDesign's own errors keep their number: the message text is localised, the code is not
      const expected = isExpected(out.code);
      const err = new Error(expected ? out.message : `${out.message} (Code: ${out.code}, Line: ${out.line})`);
      err.code = out.code;
      err.line = out.line;
      err.expected = expected;
      throw err;
    } catch (error) {
      if (!error.expected) {
        keep = true;
        log(`[indesign-mcp] script failed, kept for debugging: ${jsxFile}`);
        error.message = `${error.message} [debug script: ${jsxFile}]`;
      }
      throw error;
    } finally {
      for (const f of keep ? [resultFile] : [jsxFile, resultFile]) fs.rmSync(f, { force: true });
      prune();
    }
  };

  return {
    tempDir,
    get appName() { return adapter.appName; },
    adapter: adapter.name,
    // Calls are serialised: InDesign handles one script at a time
    run(script) {
      const next = queue.then(() => runOne(script), () => runOne(script));
      queue = next.catch(() => {});
      return next;
    },
  };
}
