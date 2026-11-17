// Offline tests for get_usage_guide: every topic is served, and every topic a guide points to exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServer } from './harness.mjs';

const guide = async (topic) => {
  const { server } = await loadServer();
  const res = await server.registry.call('get_usage_guide', topic ? { topic } : {});
  return res.content[0].text;
};

test('get_usage_guide serves the workflow, layout and manual-settings topics', async () => {
  assert.match(await guide(), /^# InDesign MCP Server – Guide for agents/);
  assert.match(await guide('layout'), /^# Building a layout/);
  assert.match(await guide('manual-settings'), /^# Settings to change by hand/);
});

test('every topic a guide points to is a topic of get_usage_guide', async () => {
  const { server } = await loadServer();
  const def = server.registry.definition('get_usage_guide');
  const topics = def.inputSchema.properties.topic.enum;
  for (const t of [undefined, ...topics]) {
    for (const [, name] of (await guide(t)).matchAll(/topic[:\s]+[`"]+([a-z-]+)[`"]/g)) {
      assert.ok(topics.includes(name), `topic "${name}" in ${t || 'workflow'} guide`);
    }
  }
});
