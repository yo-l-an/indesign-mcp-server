// Safety policy: allowed folders, absolute paths, confirmations, applied by the registry
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPolicy } from '../lib/policy.js';
import { createRegistry } from '../lib/registry.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-policy-')));
const policy = createPolicy({ allowedDirs: [root] });

test('paths: absolute inside the allowed folders only', () => {
  assert.equal(policy.resolvePath(path.join(root, 'a.indd')), path.join(root, 'a.indd'));
  assert.throws(() => policy.resolvePath('relative/a.indd'), /absolute path/);
  assert.throws(() => policy.resolvePath(path.join(os.tmpdir(), 'elsewhere.indd')), /outside the allowed folders/);
  assert.throws(() => policy.resolvePath(path.join(root, '..', 'escape.indd')), /outside the allowed folders/);
  assert.throws(() => policy.resolvePath(''), /Invalid path/);
});

test('paths: a symlink cannot lead outside', { skip: process.platform === 'win32' }, () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-outside-'));
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => policy.resolvePath(path.join(root, 'link', 'x.pdf')), /outside the allowed folders/);
});

test('paths: system folders stay closed', { skip: process.platform === 'win32' }, () => {
  const wide = createPolicy({ allowedDirs: ['/'] });
  assert.throws(() => wide.resolvePath('/etc/hosts'), /system folder/);
});

const tool = (extra) => ({ name: 't', modifies: true, inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, confirmDestructive: { type: 'boolean' } } }, ...extra });

test('destructive: always needs confirmDestructive', () => {
  const def = tool({ destructive: 'deletes the page' });
  assert.throws(() => policy.apply(def, {}), /confirmation required: t deletes the page/);
  assert.deepEqual(policy.apply(def, { confirmDestructive: true }), { confirmDestructive: true });
});

test('overwrites: confirmation only when the target exists', () => {
  const def = tool({ paths: ['filePath'], overwrites: 'filePath' });
  const target = path.join(root, 'out.pdf');
  assert.equal(policy.apply(def, { filePath: target }).filePath, target, 'a new file needs no confirmation');
  fs.writeFileSync(target, 'x');
  assert.throws(() => policy.apply(def, { filePath: target }), /overwrites/);
  assert.equal(policy.apply(def, { filePath: target, confirmDestructive: true }).filePath, target);
  const folder = path.join(root, 'empty');
  fs.mkdirSync(folder);
  assert.ok(policy.apply(def, { filePath: folder }), 'an empty folder is not overwritten');
});

test('registry: the handler gets resolved paths, and never runs when refused', async () => {
  const seen = [];
  const def = { name: 'export_x', modifies: false, paths: ['filePath'], destructive: 'replaces x', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } } };
  const reg = createRegistry([{ definitions: [def], handlers: { export_x: (a) => { seen.push(a); return a; } } }], { policy });
  assert.ok(reg.list()[0].inputSchema.properties.confirmDestructive, 'confirmDestructive is advertised');
  assert.equal(reg.list()[0].destructive, undefined, 'server traits stay out of tools/list');
  await assert.rejects(reg.call('export_x', { filePath: path.join(root, 'y') }), /confirmation required/);
  await assert.rejects(reg.call('export_x', { filePath: 'y', confirmDestructive: true }), /absolute path/);
  assert.equal(seen.length, 0);
  await reg.call('export_x', { filePath: `${root}/./y`, confirmDestructive: true });
  assert.equal(seen[0].filePath, path.join(root, 'y'));
});
