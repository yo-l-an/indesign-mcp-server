// README screenshots: the fixture scenarios render every image, offline, into a throwaway folder
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { decodePng } from '../lib/png.js';
import { renderReadmeScreenshots, SCREENSHOTS } from '../scripts/readme-screenshots.mjs';

test('the README screenshots render from fixtures, one file per scenario image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-readme-'));
  const { written, tables } = await renderReadmeScreenshots(dir);
  assert.deepEqual(written.map((w) => w.file).sort(), Object.values(SCREENSHOTS).sort());
  for (const w of written) {
    const img = decodePng(fs.readFileSync(path.join(dir, w.file)));
    assert.ok(img.width > 400 && img.height > 400, `${w.file}: ${img.width} x ${img.height}`);
  }
  // every kind of change the images show is in the tables, and nothing unexplained
  const all = tables.join('\n');
  for (const s of ['Fill', 'Rotation', 'Opacity', 'drop shadow', '~~39~~', 'Added', 'Removed', 'Moved']) assert.match(all, new RegExp(s));
  assert.doesNotMatch(all, /Visual/);
  fs.rmSync(dir, { recursive: true, force: true });
});
