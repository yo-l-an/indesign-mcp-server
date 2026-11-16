// Tool modules depend on the tool context only: they run with a hand-built one, no server
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createToolContext } from '../lib/tool-context.js';
import { createExecutor, memoryAdapter } from '../lib/executor.js';
import { createPolicy } from '../lib/policy.js';
import { createRegistry } from '../lib/registry.js';
import { createResourceTools } from '../tools/resource-tools.js';
import { parseHex, rgbToCmyk } from '../lib/color.js';

test('a tool module runs on a context alone', async () => {
  const scripts = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-ctx-'));
  const executor = createExecutor({ tempDir, adapter: memoryAdapter((s) => { scripts.push(s); return 'Black, Paper'; }) });
  const policy = createPolicy({ allowedDirs: [tempDir] });
  const ctx = createToolContext({ executor, policy, workflow: {} });
  const registry = createRegistry([createResourceTools(ctx)], { policy });
  const out = await registry.call('list_color_swatches', {});
  assert.match(out.content[0].text, /Black, Paper/);
  assert.equal(scripts.length, 1);
  assert.equal(ctx.scriptDir, tempDir);
  assert.deepEqual(ctx.respond('done', 'Op'), { content: [{ type: 'text', text: 'Op: done' }] });
});

test('colour helpers', () => {
  assert.deepEqual(parseHex('#FF6600'), [255, 102, 0]);
  assert.deepEqual(parseHex('00ff00'), [0, 255, 0]);
  assert.throws(() => parseHex('#F60'), /expected #RRGGBB/);
  assert.deepEqual(rgbToCmyk(0, 0, 0), [0, 0, 0, 100]);
  assert.deepEqual(rgbToCmyk(255, 102, 0), [0, 60, 100, 0]);
});
