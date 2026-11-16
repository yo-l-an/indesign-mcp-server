# CLAUDE.md

This repository is an MCP server that lets an agent drive Adobe InDesign.

## Correcting an InDesign document with the server

Read `GUIDE.md` before the first change: it is the workflow to follow (scope → `prepare_edit` → surgical change → `review_compare` → close), with page addressing, backups and saving. Agents outside this repository get the same file through the `get_usage_guide` tool.

## Working on the server

- `GUIDE.md` is served to agents verbatim: update it with every tool change or fix, and edit it with the `writing-for-agents` skill (steps with completion criteria, positive phrasing, one source of truth).
- After changing tool schemas: `npm run docs` (README tool reference).
- Tests: `npm run test:offline` needs no InDesign. `npm test` drives a running InDesign; set `INDESIGN_APP_NAME` (e.g. `"Adobe InDesign 2027"`) when the installed version is not the default.
- `tools/review-tools.js` holds the workflow tools (guide, prepare/compare, backups); `lib/review-diff.js` the diff, table and drawing; `lib/png.js` the PNG codec.
- Generated ExtendScript is ES3; values enter scripts only through `jsStr` / `jsJson` / `jsNum`.
- Review files belong in `$TMPDIR/indesign-mcp-review/`, outside the repository.
