// Safety policy: which files tools may touch, and when the caller must confirm.
//
// Tools declare what they do in their definition; the registry applies the policy before the
// handler runs, the same way for every tool:
//   paths: ['filePath', ...]   arguments that are file or folder paths: absolute (or ~/...),
//                              inside the allowed folders, symlinks resolved; the handler gets
//                              the resolved path
//   destructive: 'what is lost' the call always needs confirmDestructive: true
//   overwrites: 'filePath'      confirmDestructive: true only when that path already exists
//                              (a folder: exists and is not empty)
// Checks that depend on the document itself (unsaved changes on close, Save As onto another
// existing file) stay in those tools' scripts and use the same confirmDestructive parameter.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

export function defaultAllowedDirs({ platform = process.platform, env = process.env } = {}) {
  return [
    os.homedir(),
    platform === 'win32' ? (env.PUBLIC || 'C:\\Users\\Public') : '/Users/Shared',
    ...(env.INDESIGN_ALLOWED_DIRS ? env.INDESIGN_ALLOWED_DIRS.split(path.delimiter).filter(Boolean) : []),
  ];
}

// Resolve symlinks of the deepest existing ancestor, so a link inside an allowed folder cannot
// lead outside it; the part that does not exist yet is appended unchanged
function realPathOf(target) {
  let existing = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  let real;
  try { real = fs.realpathSync(existing); } catch { real = existing; }
  return path.join(real, ...tail);
}

export function createPolicy({ allowedDirs = defaultAllowedDirs(), platform = process.platform } = {}) {
  const windows = platform === 'win32';
  const fold = windows ? (p) => p.toLowerCase() : (p) => p;
  const prohibited = windows
    ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean)
    : ['/etc', '/private/etc', '/System', '/usr', '/bin', '/sbin', '/Library'];

  const resolvePath = (input, label = 'path') => {
    if (!input || typeof input !== 'string') throw new McpError(ErrorCode.InvalidParams, `Invalid ${label}: expected a file or folder path`);
    let p = input.trim();
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
    if (!path.isAbsolute(p)) throw new McpError(ErrorCode.InvalidParams, `Invalid ${label} '${input}': use an absolute path (or ~/...)`);
    // Windows: a colon after the drive letter addresses an NTFS alternate data stream
    if (windows && p.replace(/^[A-Za-z]:/, '').includes(':')) throw new McpError(ErrorCode.InvalidParams, `Invalid ${label}: '${input}'`);
    const resolved = realPathOf(p);
    const within = (dir) => {
      const d = fold(dir.replace(/[\\/]+$/, ''));
      const r = fold(resolved);
      return r === d || r.startsWith(d + path.sep);
    };
    if (!allowedDirs.some((dir) => within(realPathOf(dir)))) {
      throw new McpError(ErrorCode.InvalidParams, `Access denied: '${input}' is outside the allowed folders (${allowedDirs.join(', ')}; INDESIGN_ALLOWED_DIRS adds more)`);
    }
    if (prohibited.some((dir) => within(dir) && !allowedDirs.some((a) => fold(realPathOf(a)).startsWith(fold(dir) + path.sep)))) {
      throw new McpError(ErrorCode.InvalidParams, `Access denied: '${resolved}' is a system folder`);
    }
    return resolved;
  };

  const occupied = (p) => {
    try {
      const st = fs.statSync(p);
      return st.isDirectory() ? fs.readdirSync(p).length > 0 : true;
    } catch { return false; }
  };

  return {
    allowedDirs,
    resolvePath,
    // Arguments with declared paths resolved; throws when the call needs a confirmation
    apply(def, args) {
      const out = { ...args };
      for (const key of def.paths || []) {
        if (out[key] === undefined || out[key] === null || out[key] === '') continue;
        out[key] = Array.isArray(out[key]) ? out[key].map((v, i) => resolvePath(v, `${key}[${i}]`)) : resolvePath(out[key], key);
      }
      const reason = def.destructive
        ? def.destructive
        : def.overwrites && out[def.overwrites] && occupied(out[def.overwrites])
          ? `overwrites ${out[def.overwrites]}`
          : null;
      if (reason && out.confirmDestructive !== true) {
        throw new McpError(ErrorCode.InvalidRequest, `Security confirmation required: ${def.name} ${reason}. Add confirmDestructive: true when the user asked for it.`);
      }
      return out;
    },
  };
}
