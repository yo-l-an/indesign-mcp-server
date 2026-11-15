// Starting generated .jsx files in InDesign on Windows.
//
// InDesign registers a COM server ("InDesign.Application", plus one ProgID per
// version such as "InDesign.Application.2026"). A tiny Windows Script Host file
// (JScript, run with cscript) creates that object and calls DoScript with the
// path of the .jsx, the Windows counterpart of AppleScript's `do script`.
// Like on macOS, no user data is ever part of the launcher: it only contains
// the ProgID and the path of the generated script.

import { execFileSync } from 'child_process';
import { jsStr } from './script-runtime.js';

// ScriptLanguage.JAVASCRIPT ('jjvs') in InDesign's type library
export const JAVASCRIPT_LANGUAGE = 1246973031;

const PROGID_PATTERN = /^InDesign\.Application(\.\d{4})?$/;

// True when the given ProgID is registered with a class id (uninstalled versions can leave an empty key behind)
function progIdRegistered(progId) {
  try {
    const out = execFileSync('reg', ['query', `HKCR\\${progId}\\CLSID`, '/ve'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    return /\{[0-9A-F-]{36}\}/i.test(out);
  } catch {
    return false;
  }
}

// COM ProgID to talk to:
//   1. INDESIGN_COM_PROGID
//   2. the year in INDESIGN_APP_NAME (e.g. "Adobe InDesign 2025" -> InDesign.Application.2025)
//   3. the version-independent "InDesign.Application" (the newest registered version)
export function resolveProgId(env = process.env) {
  if (env.INDESIGN_COM_PROGID) {
    if (!PROGID_PATTERN.test(env.INDESIGN_COM_PROGID)) {
      throw new Error(`Invalid INDESIGN_COM_PROGID: ${env.INDESIGN_COM_PROGID} (expected InDesign.Application or InDesign.Application.<year>)`);
    }
    return env.INDESIGN_COM_PROGID;
  }
  const year = String(env.INDESIGN_APP_NAME || '').match(/\b(20\d{2})\b/);
  if (year && progIdRegistered(`InDesign.Application.${year[1]}`)) {
    return `InDesign.Application.${year[1]}`;
  }
  return 'InDesign.Application';
}

function regDefault(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Display name matching a ProgID ("Adobe InDesign 2026"), taken from the ProgID's year or from the
// folder of the registered COM server (...\Adobe InDesign 2026\InDesign.exe)
export function appNameForProgId(progId) {
  const year = progId.match(/\.(\d{4})$/);
  if (year) return `Adobe InDesign ${year[1]}`;
  const clsid = regDefault(`HKCR\\${progId}\\CLSID`);
  const server = clsid && regDefault(`HKCR\\CLSID\\${clsid}\\LocalServer32`);
  const folder = server && server.match(/(Adobe InDesign[^\\/"]*)[\\/][^\\/]*InDesign\.exe/i);
  return folder ? folder[1].trim() : 'Adobe InDesign';
}

// Is an InDesign process running? (A cold start takes much longer than a normal script call.)
export function isInDesignRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq InDesign.exe', '/NH', '/FO', 'CSV'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    return /"InDesign\.exe"/i.test(out);
  } catch {
    return false;
  }
}

// JScript (Windows Script Host) source that runs a .jsx in InDesign.
// COM failures are printed as "COMERR <hex code> <description>" so they can be
// mapped by code, independent of the (localised) description.
export function launcherSource(progId, jsxFile) {
  if (!PROGID_PATTERN.test(progId)) throw new Error(`Invalid ProgID: ${progId}`);
  return [
    'try {',
    `  var app = new ActiveXObject(${jsStr(progId)});`,
    `  app.DoScript(${jsStr(jsxFile.replace(/\\/g, '/'))}, ${JAVASCRIPT_LANGUAGE});`,
    '} catch (e) {',
    '  WScript.StdErr.Write("COMERR " + (e.number >>> 0).toString(16) + " " + e.description);',
    '  WScript.Quit(1);',
    '}',
    '',
  ].join('\r\n');
}

// Run a launcher file with cscript. Throws an Error with a readable message.
export function runLauncher(launcherFile, timeout) {
  try {
    return execFileSync('cscript', ['//nologo', '//E:jscript', launcherFile], {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error(describeComError(error));
  }
}

// Turn a cscript/COM failure into a short, locale-independent message (uses the numeric code).
export function describeComError(error) {
  const raw = String((error && (error.stderr || error.message)) || error || '');
  if (error && (error.killed || error.signal === 'SIGTERM' || /ETIMEDOUT/.test(raw))) {
    return 'InDesign did not respond in time (is a dialog open in InDesign?)';
  }
  const m = raw.match(/COMERR ([0-9a-f]+) ?([\s\S]*)/i);
  if (!m) {
    if (/ENOENT/.test(raw)) return 'cscript.exe was not found (Windows Script Host is required)';
    return raw.replace(/^Command failed:.*\n?/m, '').trim() || 'InDesign COM call failed';
  }
  const code = m[1].toLowerCase().padStart(8, '0');
  const description = m[2].trim();
  // Cannot create object / invalid class string / server execution failed / class not registered
  if (['800a01ad', '800401f3', '80080005', '80040154'].includes(code)) {
    return `InDesign is not installed or not registered for scripting (COM error 0x${code}). Set INDESIGN_COM_PROGID if several versions are installed.`;
  }
  // Call rejected / server busy / RPC server unavailable
  if (['80010001', '8001010a', '800706ba'].includes(code)) {
    return `InDesign is busy or not reachable (COM error 0x${code}; is a dialog open in InDesign?)`;
  }
  return description ? `${description} (COM error 0x${code})` : `InDesign COM error 0x${code}`;
}
