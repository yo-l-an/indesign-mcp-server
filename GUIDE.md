# InDesign MCP Server – Guide for agents

You correct InDesign documents for a **project manager** (PM): "page 12, replace the price", "move the logo on p. 3". Work **surgically**: stay inside the task's **scope** (the pages and objects the PM named), change exactly what was asked, show the PM what changed, and keep a **way back** (a backup) for every task.

Follow the five steps for every correction. The reference sections answer questions as they come up.

**Building a layout** (a new document, document setup, grids, masters, folios, spreads, alternate layouts, text frames, type fitting, alignment, groups) → read `get_usage_guide({ topic: "layout" })` before its first tool call.

## Workflow

### 1. Find the scope

- Client files (a commented PDF, a Word file with comments or tracked changes) → **triage** them first (Client files); the pages of the clear rows are the scope.
- The PM names pages → those page names (`"12"`, `"iv"`, `"A-3"`, as shown in InDesign).
- The PM quotes text, or asks for a global replace → `find_text({ text })` gives page, frame id and context for each match; its pages are the scope.
- Style, swatch, master, margins, grid or document setup → every page that uses it (`get_layout_setup` lists the pages of each master); `allPages: true` when that is most of the document. These belong to the client: change them with the PM's agreement.
- Moving, adding or removing pages → `pages: []` when no page content changes; the backup and the page order are enough.
- Moving an object to another page → both pages.

**Done when** you hold the page names of the scope, and nothing outside it has been read. With client files: the PM has answered every question of the triage.

### 2. Prepare

```javascript
prepare_edit({ pages: ["12"], reason: "correction prix p12" })
// Backup: …/InDesign Agent Backups/Doc__2026-11-16_14h05m09__correction-prix-p12.indd
// Snapshot: snapshotId=…
// Page 12 (pageIndex 11, 210×297 mm) – 9 objects:
//   id=4512 TextFrame x18 y52 174×86 [Corps] «Tarifs 2026 ¶ Prix : 12 € …»
```

One call makes the backup, the BEFORE snapshot of the scope, and lists every object of the scope with its id, position, styles and text. Work from this list; reach for `list_page_items`, `get_object_info` or `get_text_content` only for a detail it lacks (`listObjects: false` when you already know the ids).

A page you touch outside the scope joins the BEFORE automatically (the result shows an `Auto snapshot` line), so the review still covers it. Documents created in this session get no backup or snapshot.

**Done when** the result shows a backup path and a `snapshotId`.

### 3. Change surgically

- Address objects by **id**, from the list of step 2. Ids reach objects inside groups; leave the client's groups and names as they are.
- Text: `find_replace_text({ findText, replaceText, frameId })` for a word or a sentence; `edit_text_frame` with `content` only to rewrite a whole story. Then `french_typography` on the frames you touched (French typography).
- Pages: `move_page({ page: "10", after: "3" })`, `add_page`, `delete_page`. Objects to another page: `move_to_page({ id, page: "12" })`.
- Objects from a master (a folio, a header): change them on the master or override them on one page (Masters).
- Formatting: apply existing paragraph/character styles.
- Text that no longer fits (`overflows=true` / `OVERSET`): enlarge the frame with `set_object_geometry`, or tell the PM. Type size changes only with the PM's agreement.

**Done when** every tool result confirms the change landed in scope: `Where:` lists only scope pages, the ids are the intended ones, `overflows=false`.

### 4. Review and report

```javascript
review_compare()                   // few changes
review_compare({ maxImages: 1 })   // many changes: the table carries them
```

The images in the tool result reach you only. Show the PM the files listed on the `Images to show the user` line:

1. Copy them into a folder your client displays inline: your session's scratchpad or working folder (Claude Code shows files from the system temp folder as download cards only). The document's folder stays free of them.
2. Send the copies with your client's file-sharing tool (for example `SendUserFile` with `display: "render"`), with the change table in your message. Report in three short parts: **what changed**, **the review**, **open points** (anything not done or not checked).

**Done when** the PM sees the images inline and has the table, and every table row matches something they asked for. A row they did not ask for is a **side effect**: fix it, or explain it in the open points. With client feedback: every feedback number is done or in the open points.

### 5. Close the task

- More corrections on the same task ("finally 16 €"): change, then `review_compare()` again; it compares with the same BEFORE, so the PM sees the whole task.
- `review_compare` saves the document after the review and names the backup to roll back to. Tell the PM it is saved and where the backup is. A document the result reports as unsaved → Saving.
- A new, separate request starts again at step 1 with a new `prepare_edit`.
- A bug, a missing feature, a better way, or a fix you made to the server → Improving the server.

**Done when** the PM has confirmed the result, and the review result shows `Saved:` (or the PM has given a place for a document with no file).

## Reference

### Pages, ids, units

- **Page names** are what the PM says and what `pages` takes. `pageIndex` counts from 0 in file order; `prepare_edit` and `find_text` print both. A name used twice (sections) → `"+N"`, the N-th page of the file. Alternate layouts repeat the page names: `"Tablette:2"` is page 2 of the layout "Tablette".
- **Ids** survive objects being added or reordered; `frameIndex` / `index` shift.
- **Millimetres**, origin at the top-left of each page's trim box; negative values reach into the bleed. Angles in degrees, counter-clockwise positive.
- **Page size** is per page: `set_page_size({ pageIndexes: [0], height: 159 })` resizes from the top-left corner and leaves objects in place; `get_document_info` lists the pages whose size differs.
- **One document at a time**: tools act on the active document. With several open, or when the PM names another file: `list_open_documents`, `activate_document`.

### Client files: feedback and brief

**Feedback** (commented PDF, Word comments, tracked changes): `read_feedback({ path, locate: true })` gives one row per item, numbered `#` (PDF), `C1` (Word comment) or `M1` (tracked change).

- *Texte visé* is the text the mark points at; `‸` is an insertion point; replies follow `↳`. A tracked change (*Suivi*) reads *Texte visé* = before, *Retour* = `→ after`.
- *Dans InDesign*: `p.12 #4512` = the text is there (page name, text frame id); `déjà fait ?` = only the corrected text exists; `introuvable` = rewritten since, or a visual remark: place it with the *Page* column (*Section* for Word).
- PDF in spreads: *Page* is the folio printed on the page, else the PDF page and side. A `?` in a reviewer's name comes from the PDF itself.

**Triage** every row before `prepare_edit`:

- **clear**: the exact change is written (insert, delete, replace, "remplacer X par Y", the exact new title) and located.
- **question**: everything else: a vague remark ("pas beau", "réduire un peu"), a choice to make, an asset still to come ("à venir", "en attente"), reviewers who disagree, a reply that changes the request, `déjà fait ?`, `introuvable`, a drawing.

Send the PM one message: the counts, then the questions by number, each with the answer you propose. Change the clear rows once the PM confirms the triage.

**Brief** to lay out (Word, PDF, .doc/.rtf/.odt on macOS, text): `read_source_document({ path, outline: true })`, then the part you need with `offset`. Markers: `[C1]` comment, `[+added+]` `[-removed-]` tracked change, `[image: …]`, `[encadré: …]` text box. Titles marked by hand (bold, capitals) are inferred, and the header says so.

### Review output

Point the PM at these marks when you describe the change.

- The images label themselves (BEFORE | AFTER, colour legend, zone numbers matching the table's `#`). A text-only edit is framed on the changed lines; the gutter beside each page marks where each zone sits.
- A modified object's zone label carries one icon per kind of change, with that side's value: ✥ move (`x · y`, mm), ⤢ resize (`w × h`, mm), ↻ / ↺ rotation, **fx** effects (shadow, glow, feather, blend mode…), ■ fill, □ stroke, ◐ opacity, **T** text. An object aligned on the grid gets a first label line on the AFTER side with its alignment (horizontal, then vertical) and the names of the lines, which both images draw; the table adds an "Alignement" row.
- **Page map** (pages added, removed or moved): the document from above as spreads, BEFORE and AFTER side by side, identical runs folded. Added green, removed red, moved orange with an arrow; grey links show pages that only shifted spread. A moved page reads "10 → 4" in the table, "A5:3 → A4:2" across alternate layouts. `view_page_map` shows the page map at any time, without a comparison.
- **Move image** (objects changed page): source page BEFORE | destination page AFTER, an arrow from each object to where it landed, the destination found even outside the scope.
- **"Visuel"** rows are pixel changes no object explains (style definition, relinked image, master page; after a renumbering, the folio): name the likely cause in the open points.
- Identical changes on many objects share one table row; `report.html` keeps one row per object and every image.
- Review files are temporary, in `$TMPDIR/indesign-mcp-review/` (removed after 3 days). Attach `report.html` or the PNGs to the conversation when the PM wants to keep or share the review.

For changes reported by hand (no snapshot possible), use the same columns; `~~struck~~` = removed, `**bold**` = added, one row per changed property:

| # | Page | Élément | Propriété | Avant | Après | Type |
|---:|---|---|---|---|---|---|
| 1 | 12 | Bloc texte #4512 «Tarifs 2026» | Texte | Prix : ~~12~~ € | Prix : **15** € | Modifié |
| 2 | 12 | Image #4520 «photo.jpg» | Position / taille | x 10 · y 40 · 60 × 40 mm | x 10 · y 50 · 60 × 40 mm | Modifié |
| 3–21 | 5, 10, 12 … (19) | 19 × Bloc texte | Corps | 11 pt | 8 pt | Modifié |
| — | Document | Style de paragraphe «Puces» | Style de paragraphe | size: 11 | size: 8 | Modifié |

### Backups and going back

- `prepare_edit` writes `<document>__YYYY-MM-DD_HHhMMmSS__<reason>.indd` into **`InDesign Agent Backups`** next to the .indd (`$INDESIGN_BACKUP_DIR` overrides; a document never saved goes to `~/Documents/InDesign Agent Backups`). It holds the state before the task, unsaved changes included.
- One backup per task. `backup: false` when the PM declined it or the task already has one; `backup_document` for an extra copy before a risky step.
- Backups are permanent: they stay until the PM explicitly asks to delete them.
- Going back, on the PM's request: `list_backups`, then `restore_backup({ backupPath: "<file name>", confirmDestructive: true })`. It backs up the current state first, then replaces and reopens the document.

### Saving

- **No file yet** ("Sans titre-1"): ask the PM for a place and a name, then `save_document({ filePath })`. When the PM cannot be asked, `save_document()` saves into `~/Documents` under the document's name: tell the PM that path.
- **Converted** (made with an older InDesign; `get_document_info` says so): it has no file until saved, so it needs a `filePath` too. Saving over the original replaces the old-version file (the backup keeps the previous state); ask the PM which name to use.

**Done when** every document you created or saved has a path the PM knows.

### Masters

A master object (folio, header, background) shows on every page that uses the master.

- **For every page**: `list_master_items({ master })` gives the ids; edit them with the usual tools. `find_text` and `find_replace_text` reach master text and say "master …". Scope: every page of that master (step 1).
- **For one page**: `override_master_items({ page, ids })` gives the page an editable copy (new id) that still follows the master for what you leave untouched; `detach: true` cuts the link; `remove_master_overrides` brings the master version back.

Creating, applying and organising masters: topic `layout`.

### French typography

`french_typography` applies the French rules one by one: spaces, no-break spaces before `; ! ? :` and inside « », apostrophe ’, ellipsis, thousands and units (10 000, 12 €), dates and abbreviations, en dashes, ordinals in superscript (XIXe, 1er), œ, accented capitals (État), list punctuation. Straight quotes → « » and the × sign are off by default (English, code and inches need them).

1. `french_typography({ frameId | pages | allPages, dryRun: true })` counts each rule's changes with examples.
2. Show the PM the counts and the doubtful examples; turn off what they decline with `rules: { name: false }`, turn on `quotes` / `multiplication` on request; `lists: "semicolon"` (or `none` / `period`) when the lists need fixing.
3. Run it without `dryRun`, then `review_compare`.

In a correction, run it on the frames you changed; on a whole document only for a typographic pass the PM asked for.

### When a tool fails

The message names the next step (valid page names, missing parameter, active document). Beyond that:

- `No object with id N` → `find_text` or `list_page_items` on that page gives the current id.
- `Paragraph style not found` / `Swatch not found` → `list_styles` / `list_color_swatches`; create one only when the PM wants it.
- `Security confirmation required` → add `confirmDestructive: true` only for an action the PM asked for.
- `use an absolute path` / `outside the allowed folders` → the full path (`/Users/...` or `~/...`) of a file inside the folders the message lists.
- `… [debug script: path]` → an unexpected InDesign failure: report it with the path to the PM, stop that step, and note it (Improving the server).

### Settings no tool reaches

Print booklet, colour settings, text variables, tables of contents, preferences…: `get_usage_guide({ topic: "manual-settings" })` gives each one's purpose and menu path (French and English). Give the PM the path, carry on with the rest, and keep the step in the open points until the PM confirms it.

### Improving the server (NOTES.md)

`NOTES.md` in the server folder carries what you learn to the project's author, who chooses the real implementation.

- **No tool for a case** (a property no tool exposes, a one-off batch, a check): `run_script({ purpose, code, missing, ids })` and carry on. It runs ES3 ExtendScript on the active document (`doc`, `__findById`, mm from each page's top-left; the last expression is the result), joins the snapshot through `ids` / `pageIndex`, and notes itself in NOTES.md with `missing`. Files, system, menus, saving and exporting stay with their tools.
- **A bug, a missing feature, a better way**: `read_improvement_notes` (already there?), then `add_improvement_note({ kind, title, details, tool })`. In `details`: what you tried, what happened, how to reproduce it, what would help; generic, with no client names or client text.
- **A wrong tool or a missing feature that blocks the work**: if you can edit files, fix it in the tool's module (`tools/*-tools.js`; `read_improvement_notes` shows the server folder), keep the change small, and ask the user to restart the MCP server. Then `add_improvement_note({ status: "fixed-locally", filesChanged: ["tools/export-tools.js: what changed"], details })`. Commits and pushes stay with the author.
- **Before you finish**: tell the user in one short paragraph that `NOTES.md` holds improvements (and any local fixes) ready to hand to the project's author.

**Done when** every workaround, bug, wish and local change of the session is in `NOTES.md`, and the user has had that paragraph.
