/**
 * Test harness.
 *
 * Loads index.js and replaces executeInDesignScript with a collector, so the
 * generated ExtendScript can be inspected without InDesign running.
 *
 * index.js itself is not modified — the harness writes a copy into a temp
 * directory and removes the auto-start at the end of the file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let cached = null;

/** Load the server once, with script execution stubbed out. */
export async function loadServer() {
  if (cached) return cached;

  // index.js exports the class and only starts the server when run directly,
  // so it can be imported as-is.
  const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href);
  const server = new mod.InDesignMCPServer();

  // Collect scripts instead of sending them to InDesign.
  const captured = [];
  server.executeInDesignScript = async (script) => {
    captured.push(script);
    return '(mock)';
  };

  cached = { server, captured };
  return cached;
}

/** Tool definitions as served by tools/list. */
async function toolDefinitions(server) {
  const list = server.server._requestHandlers.get('tools/list');
  const { tools } = await list({ method: 'tools/list', params: {} }, {});
  return tools;
}

/**
 * Call a tool method and return the script it produced.
 * Arguments first pass the same schema validation the tools/call dispatcher
 * applies (createTextFrame -> create_text_frame).
 * If the method throws — an argument was rejected, say — the error is
 * returned rather than raised.
 */
export async function runTool(method, args) {
  const { server, captured } = await loadServer();
  const before = captured.length;
  try {
    const toolName = method.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    const validated = server.validateArguments(toolName, args, await toolDefinitions(server));
    await server[method](validated);
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
