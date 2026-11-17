/**
 * Test harness.
 *
 * Loads index.js with an in-memory executor (lib/executor.js) that collects the
 * generated ExtendScript, so it can be inspected without InDesign running.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let cached = null;

// Notes written by tools during tests stay out of the repository
process.env.INDESIGN_NOTES_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-notes-')), 'NOTES.md');

/** Load the server once, with script execution stubbed out. */
export async function loadServer() {
  if (cached) return cached;

  // index.js exports the class and only starts the server when run directly,
  // so it can be imported as-is.
  const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href);
  const { createExecutor, memoryAdapter } = await import(pathToFileURL(path.join(ROOT, 'lib/executor.js')).href);

  // Collect scripts instead of sending them to InDesign: in-memory executor adapter.
  const captured = [];
  const executor = createExecutor({
    adapter: memoryAdapter((script) => { captured.push(script); return '(mock)'; }),
    tempDir: fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-harness-')),
  });
  const server = new mod.InDesignMCPServer({ executor });

  cached = { server, captured };
  return cached;
}

/** Names of every tool, from the registry. */
export async function toolNames() {
  const { server } = await loadServer();
  return server.registry.names();
}

/**
 * Call a tool through the registry (schema validation, then the handler) and return the
 * script it produced. If the call throws — an argument was rejected, say — the error is
 * returned rather than raised.
 */
export async function runTool(name, args) {
  const { server, captured } = await loadServer();
  const before = captured.length;
  try {
    await server.registry.call(name, args);
  } catch (e) {
    return { error: e, script: captured.length > before ? captured[captured.length - 1] : null };
  }
  return { error: null, script: captured.length > before ? captured[captured.length - 1] : null };
}

/**
 * Does an ExtendScript source parse?
 *
 * ES3 is a subset of the Node grammar, so new Function() works as a parser.
 * The reverse is not true: Node accepts ES2024 constructs that ExtendScript
 * does not, hence the additional deny-list.
 */
const ES3_FORBIDDEN = [
  [/`/, 'template literal (ExtendScript is ES3)'],
  [/\blet\s+[A-Za-z_$]/, 'let (ExtendScript only has var)'],
  [/\bconst\s+[A-Za-z_$]/, 'const (ExtendScript only has var)'],
  [/=>/, 'arrow function (ExtendScript is ES3)'],
];

export function parses(script) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(script);
  } catch (e) {
    return { ok: false, message: e.message };
  }
  for (const [re, what] of ES3_FORBIDDEN) {
    if (re.test(script)) return { ok: false, message: 'not valid for ExtendScript: ' + what };
  }
  return { ok: true };
}
