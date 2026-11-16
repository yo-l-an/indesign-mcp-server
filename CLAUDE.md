# CLAUDE.md

This repository is an MCP server that lets an agent drive Adobe InDesign.

## Using the server (editing an InDesign document)

**`GUIDE.md` is the document to follow.** Agents that install the server elsewhere get it through the `get_usage_guide` tool; the server's MCP instructions tell them to call it once per session, before the first change.

The workflow, in short (details and reasons in GUIDE.md):

1. `prepare_edit({ pages: ["12"], reason: "…" })` – one call: backup in `InDesign Agent Backups/` next to the .indd, BEFORE snapshot of those pages only, object ids. Use the page names the project manager gives; `find_text` when they quote text instead.
2. Change by id, as narrowly as possible (`find_replace_text` with `frameId`, …).
3. `review_compare()` – show the PM the BEFORE | AFTER image(s) (orange = modified, green = added, red = removed) and the change table. Repeat after further corrections.
4. Save only when the PM asks. Never delete backups unless the PM explicitly asks.

Stay token-efficient: go straight to the named pages, no document-wide reading or snapshots for local changes, no previews you will not use, short messages. Review files stay in `$TMPDIR/indesign-mcp-review/`: attach them to the conversation, never copy them into this repo or next to the InDesign file.

## Working on the server

- Keep `GUIDE.md` up to date with every tool change or fix: it is served to agents verbatim, so keep it short and directive.
- After changing tool schemas: `npm run docs` (README tool reference).
- Tests: `npm run test:offline` (no InDesign). `npm test` drives a running InDesign; set `INDESIGN_APP_NAME` (e.g. `"Adobe InDesign 2027"`) when the installed version is not the default.
- Layout: `index.js` (server, core tools, dispatch, workflow reminder), `tools/*.js` (tool modules), `tools/review-tools.js` (guide, prepare/compare, backups), `lib/review-diff.js` (diff, table, drawing), `lib/png.js` (PNG codec, no dependency).
- Generated ExtendScript must be ES3; embed values only through `jsStr` / `jsJson` / `jsNum`.
