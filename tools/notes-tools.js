// Improvement notes: what agents learn while using the server, for the author of the project.
//
//   add_improvement_note    append an observation, workaround, bug, wanted feature or local fix
//                           to NOTES.md at the root of the server
//   read_improvement_notes  read NOTES.md (check what is already noted before adding)
//   check_server_updates    when the server is a git clone: fetch, and fast-forward to the new
//                           commits of its upstream branch (a fix may already exist); a downloaded
//                           copy has nothing to update
//
// Agents often run without push rights on the repository: NOTES.md is how their findings and
// local fixes reach the author, who decides on the real implementation. The file is git-ignored
// (it may describe client work) and is only ever appended to by the tools.

import fs from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const notesPath = () => process.env.INDESIGN_NOTES_PATH || path.join(ROOT, 'NOTES.md');
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } };
const pad2 = (n) => String(n).padStart(2, '0');

const KINDS = ['bug', 'feature', 'workaround', 'observation'];
const STATUS = ['wanted', 'fixed-locally', 'workaround-found'];

const HEADER = `# Improvement notes

Written by agents while using the InDesign MCP server: what they found, what they need, and what
they changed locally. For the author of the project, who chooses the real implementation.
Each entry: kind, status (wanted / fixed-locally / workaround-found), the tool, the files changed.
`;

// git in the server folder, no shell; resolves { ok, out } (never rejects)
const git = (root, args, timeout = 30000) => new Promise((resolve) => {
  execFile('git', args, { cwd: root, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(err ? (stderr || err.message) : stdout).trim() });
  });
});

// Is the server a git clone with an upstream branch, and is it behind? With apply, fast-forward
// to it (only a clean tree: local fixes stay untouched). Returns { state, text }:
// copy | no-upstream | offline | up-to-date | behind | updated | local-changes | failed
export async function checkServerUpdates(root = ROOT, { apply = true } = {}) {
  if (!fs.existsSync(path.join(root, '.git'))) return { state: 'copy', text: 'The server is a downloaded copy, not a git clone: there are no updates to fetch. Carry on (note the difficulty with add_improvement_note).' };
  const up = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!up.ok) return { state: 'no-upstream', text: 'The server is a git clone without an upstream branch: nothing to compare with. Carry on.' };
  const fetched = await git(root, ['fetch', '--quiet']);
  if (!fetched.ok) return { state: 'offline', text: `Could not fetch updates (${fetched.out.split('\n')[0]}). Carry on with the current version.` };
  const behind = Number((await git(root, ['rev-list', '--count', 'HEAD..@{u}'])).out) || 0;
  if (!behind) return { state: 'up-to-date', text: `The server is up to date with ${up.out}. Carry on: the difficulty is new (note it with add_improvement_note).` };
  const log = (await git(root, ['log', '--oneline', '--no-decorate', '-20', 'HEAD..@{u}'])).out;
  const list = `${behind} new commit(s) on ${up.out}:\n${log}`;
  if (!apply) return { state: 'behind', text: `${list}\nRun check_server_updates again without apply: false to update.` };
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])).out;
  if (dirty) return { state: 'local-changes', text: `${list}\nNot updated: the server folder has local changes (local fixes?):\n${dirty}\nTell the user; the author merges them. Carry on with the current version.` };
  const merged = await git(root, ['merge', '--ff-only', '--quiet', '@{u}']);
  if (!merged.ok) return { state: 'failed', text: `${list}\nCould not fast-forward (${merged.out.split('\n')[0]}): the local branch has its own commits. Carry on with the current version and tell the user.` };
  const deps = (await git(root, ['diff', '--name-only', `HEAD@{1}`, 'HEAD', '--', 'package.json', 'package-lock.json'])).out;
  return { state: 'updated', text: `Updated: ${list}\nThe new code loads when the MCP server restarts: ask the user to restart it${deps ? ' (the dependencies changed: run npm install in the server folder first)' : ''}, then try the step again.` };
}

// Append one note to NOTES.md; returns { n, file }
export function appendNote(args) {
  const file = notesPath();
  const status = args.status || 'wanted';
  if (status === 'fixed-locally' && !(args.filesChanged || []).length) {
    throw new Error('status fixed-locally needs filesChanged: every file you changed, with what changed');
  }
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const n = (existing.match(/^## N\d+/gm) || []).length + 1;
  const d = new Date();
  const when = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const lines = [
    '',
    `## N${n} – ${args.kind} – ${String(args.title).replace(/\s+/g, ' ').trim()}`,
    '',
    `- Date: ${when} · server ${version()}`,
    `- Status: ${status}`,
    ...(args.tool ? [`- Tool: \`${args.tool}\``] : []),
    ...((args.filesChanged || []).length ? ['- Files changed:', ...args.filesChanged.map((f) => `  - ${f}`)] : []),
    '',
    String(args.details).trim(),
    '',
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, (existing ? '' : HEADER) + lines.join('\n'), 'utf8');
  return { n, file, status };
}

export function createNotesTools() {
  const definitions = [
    {
      name: 'add_improvement_note',
      modifies: false,
      description: 'Write a note for the author of this server in NOTES.md: a bug, a missing feature, a better way you found, or a fix you made yourself in the server files. Every local change to the server must have a note (files and what changed). Check read_improvement_notes first to avoid duplicates. Keep notes generic: no client names or client text.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS, description: 'bug, feature (wanted), workaround (a better way found), observation' },
          title: { type: 'string', description: 'One line: what it is about' },
          details: { type: 'string', description: 'What happened, how to reproduce it, what you expected, what would help (Markdown)' },
          status: { type: 'string', enum: STATUS, description: 'wanted (needs the author), fixed-locally (you changed server files), workaround-found', default: 'wanted' },
          tool: { type: 'string', description: 'The tool concerned, if any (e.g. export_pdf)' },
          filesChanged: { type: 'array', items: { type: 'string' }, description: 'Server files you changed, relative to the server folder, each with what changed (e.g. "tools/export-tools.js: keep the preset name")' },
        },
        required: ['kind', 'title', 'details'],
      },
    },
    {
      name: 'check_server_updates',
      modifies: false,
      description: 'First step when a tool fails, misbehaves or a feature is missing: if the server folder is a git clone, fetch and fast-forward to the new commits of its upstream branch (the fix may already exist), then ask the user to restart the MCP server. A downloaded copy (no git) has nothing to update. Local changes in the server folder are never overwritten.',
      inputSchema: {
        type: 'object',
        properties: {
          apply: { type: 'boolean', description: 'false = only list the new commits', default: true },
        },
      },
    },
    {
      name: 'read_improvement_notes',
      modifies: false,
      description: 'Read NOTES.md, the improvement notes written so far for the author of this server (bugs, wanted features, workarounds, local fixes), with the path of the server folder.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  const handlers = {
    add_improvement_note: async (args) => {
      const { n, file, status } = appendNote(args);
      return { content: [{ type: 'text', text: `Note N${n} written to ${file}.\nBefore you finish, tell the user in one short paragraph: improvements to the server are needed, you wrote them in NOTES.md${status === 'fixed-locally' ? ' (with the local fixes you made)' : ''}, and the notes are ready to be given to the author of the project.` }] };
    },
    check_server_updates: async (args) => {
      const { text } = await checkServerUpdates(ROOT, { apply: args.apply !== false });
      return { content: [{ type: 'text', text }] };
    },
    read_improvement_notes: async () => {
      const file = notesPath();
      const where = `Notes file: ${file}\nServer folder (tool modules in tools/): ${ROOT}`;
      if (!fs.existsSync(file)) return { content: [{ type: 'text', text: `${where}\nNo notes yet.` }] };
      return { content: [{ type: 'text', text: `${where}\n\n${fs.readFileSync(file, 'utf8')}` }] };
    },
  };

  return { definitions, handlers };
}
