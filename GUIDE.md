# InDesign MCP Server – Guide for agents

You correct InDesign documents for a **project manager** (PM): "page 12, replace the price", "move the logo on p. 3". Work **surgically**: stay inside the task's **scope** (the pages and objects the PM named), change exactly what was asked, show the PM what changed, and keep a **way back** (a backup) for every task.

Follow the five steps for every task. The reference sections below answer questions as they come up.

## Workflow

### 1. Find the scope

- The PM sends client files (a commented PDF, a Word file with comments or tracked changes) → **triage** them first (Client files, below); the pages of the clear rows are the scope.
- The PM names pages → those page names are the scope (`"12"`, `"iv"`, `"A-3"`, as shown in InDesign).
- The PM quotes text → `find_text({ text })` gives page, frame id and context for each match; its pages are the scope.
- Global replace → `find_text` first; the pages it lists are the scope.
- Style or swatch change → the whole document is the scope (`allPages: true`).
- Moving, adding or removing pages → `pages: []` when no page content changes; the backup and the page order are enough, and `review_compare` maps the page order of the whole document.
- Moving an object to another page → both pages are the scope.

**Done when** you hold the page names of the scope, and nothing outside it has been read. With client files: the PM has answered every question of the triage.

### 2. Prepare

```javascript
prepare_edit({ pages: ["12"], reason: "correction prix p12" })
// Backup: …/InDesign Agent Backups/Doc__2026-11-16_14h05m09__correction-prix-p12.indd
// Snapshot: snapshotId=…
// Page 12 (pageIndex 11, 210×297 mm) – 9 objects:
//   id=4512 TextFrame x18 y52 174×86 [Corps] «Tarifs 2026 ¶ Prix : 12 € …»
```

One call makes the backup, the BEFORE snapshot of the scope, and lists every object of the scope with its id, position, styles and text. Work from this list; reach for `list_page_items`, `get_object_info` or `get_text_content` only for a detail it lacks. Pass `listObjects: false` when you already know the ids.

**Done when** the result shows a backup path and a `snapshotId`.

### 3. Change surgically

- Address objects by **id** (stable), from the list of step 2.
- Text: `find_replace_text({ findText, replaceText, frameId })` for a word or a sentence; `edit_text_frame` with `content` only to rewrite a whole story.
- Pages: `move_page({ page: "10", after: "3" })`, `add_page`, `delete_page`. Objects to another page: `move_to_page({ id, page: "12" })`.
- Formatting: apply existing paragraph/character styles. Editing a style changes every page that uses it, so it is a whole-document scope (step 1).
- Text that no longer fits (`overflows=true` / `OVERSET`): enlarge the frame with `set_object_geometry`, or tell the PM. Type size changes only with the PM's agreement.

**Done when** every tool result confirms the change landed in scope: `Where:` lists only scope pages, the ids are the intended ones, `overflows=false`.

### 4. Review and report

```javascript
review_compare()                   // few changes
review_compare({ maxImages: 1 })   // many changes: the table carries them
```

Show the PM the image(s) and the change table, then report in three short parts: **what changed**, **the review**, **open points** (anything not done or not checked).

**Done when** the PM has the images and the table, and every table row matches something they asked for. A row they did not ask for is a side effect: fix it, or explain it in the open points. With client feedback: every feedback number is done or listed in the open points.

### 5. Close the task

- Further corrections on the same task ("finally 16 €"): change, then `review_compare()` again. It compares with the same BEFORE, so the PM sees the whole task.
- Saving: ask the PM after the review; save with `save_document` once they agree.
- A new, separate request starts again at step 1 with a new `prepare_edit`.

**Done when** the PM has confirmed the result and said whether to save.

## Reference

### Pages, ids, units

- **Page names** are what the PM says and what `pages` takes. Tools with `pageIndex` count from 0 in file order; `prepare_edit` and `find_text` print both. A name used twice (sections) → `"+N"`, the N-th page of the file.
- **Ids** stay valid when objects are added or reordered; `frameIndex` / `index` shift, so ids are the reliable handle.
- **Millimetres**, origin at the top-left of each page's trim box; negative values reach into the bleed. Angles in degrees, counter-clockwise positive.
- **One document at a time**: tools act on the active document. With several documents open, or when the PM names another file, check with `list_open_documents` and `activate_document`.

### Client files: feedback and brief

**Feedback** (commented PDF, Word comments, tracked changes): `read_feedback({ path, locate: true })` gives one row per item, numbered `#` (PDF), `C1` (Word comment) or `M1` (tracked change).

- *Texte visé* is the text the mark points at; `‸` is an insertion point; replies follow `↳`.
- *Dans InDesign*: `p.12 #4512` = the text is there (page name, text frame id); `déjà fait ?` = only the corrected text exists; `introuvable` = rewritten since, or a visual remark: place it with the *Page* column.
- PDF in spreads: *Page* is the folio printed on the page, else the PDF page and side. A `?` in a reviewer's name comes from the PDF itself.

**Triage** every row before `prepare_edit`:

- **clear**: the exact change is written (insert, delete, replace, "remplacer X par Y", the exact new title) and located.
- **question**: everything else: a vague remark ("pas beau", "réduire un peu"), a choice to make, an asset still to come ("à venir", "en attente"), reviewers who disagree, a reply that changes the request, `déjà fait ?`, `introuvable`, a drawing.

Send the PM one message: the counts, then the questions by number, each with the answer you propose. Change the clear rows once the PM confirms the triage.

**Brief** to lay out (Word, PDF, .doc/.rtf/.odt on macOS, text): `read_source_document({ path, outline: true })`, then the part you need with `offset`. Markers: `[C1]` comment, `[+added+]` `[-removed-]` tracked change, `[image: …]`, `[encadré: …]` text box. Titles marked by hand (bold, capitals) are inferred, and the header says so.

### Review output

- The images label themselves (BEFORE | AFTER, colour legend, zone numbers matching the table's `#`). A text-only edit is framed on the changed lines; the gutter beside each page marks where each zone sits vertically.
- **Page map** (when pages were added, removed or moved): the document seen from above as spreads, BEFORE and AFTER side by side; identical spreads share a row and long runs are folded. Added pages green, removed red, moved pages orange with an arrow from the old place to the new one; grey links show pages that only shifted to another spread. Page names follow the numbering, so a moved page reads "10 → 4" in the table.
- **Move image** (when objects changed page): source page BEFORE | destination page AFTER, an arrow from each object to where it landed. The destination page is found even outside the scope.
- After a renumbering, a "Visuel" zone on a page's folio is the page number changing; the table says so.
- Identical changes on many objects share one table row; `report.html` keeps one row per object and every image.
- Review files are temporary, in `$TMPDIR/indesign-mcp-review/` (removed after 3 days). Attach `report.html` or the PNGs to the conversation when the PM wants to keep or share the review; the repository and the InDesign folder stay free of them.
- "Visuel" rows are pixel changes no object explains (style definition, relinked image, master page): name the likely cause in the open points.

### Change table template

For changes reported by hand (when no snapshot was possible), use the same columns as `review_compare`:

| # | Page | Élément | Propriété | Avant | Après | Type |
|---:|---|---|---|---|---|---|
| 1 | 12 | Bloc texte #4512 «Tarifs 2026» | Texte | Prix : ~~12~~ € | Prix : **15** € | Modifié |
| 2 | 12 | Image #4520 «photo.jpg» | Position / taille | x 10 · y 40 · 60 × 40 mm | x 10 · y 50 · 60 × 40 mm | Modifié |
| 3–21 | 5, 10, 12 … (19) | 19 × Bloc texte | Corps | 11 pt | 8 pt | Modifié |
| — | Document | Style de paragraphe «Puces» | Style de paragraphe | size: 11 | size: 8 | Modifié |

`~~struck~~` = removed, `**bold**` = added; one row per changed property.

### Backups and going back

- `prepare_edit` writes `<document>__YYYY-MM-DD_HHhMMmSS__<reason>.indd` into **`InDesign Agent Backups`** next to the .indd (`$INDESIGN_BACKUP_DIR` overrides). It holds the state in InDesign before the task, unsaved changes included.
- One backup per task. `backup: false` when the PM declined it or the task already has one; `backup_document` for an extra copy before a risky step.
- Backups are permanent: they stay until the PM explicitly asks to delete them.
- Going back, on the PM's request: `list_backups`, then `restore_backup({ backupPath: "<file name>", confirmDestructive: true })`. It backs up the current state first, then replaces and reopens the document.

### Converted documents

A document made with an older InDesign opens as **converted** (`get_document_info` says so): it has no file until saved, so `save_document` needs a `filePath`. Saving over the original replaces the old-version file (the backup keeps the previous state). Ask the PM which name to use.

### When a tool fails

Read the message: it names the next step (valid page names, missing parameter, which document is active). Beyond that:

- `No object with id N` → the object changed; `find_text` or `list_page_items` on that page gives the current id.
- `Paragraph style not found` / `Swatch not found` → `list_styles` / `list_color_swatches`; create a new one only when the PM wants it.
- `Security confirmation required` → add `confirmDestructive: true` only for an action the PM asked for.
- `use an absolute path` / `outside the allowed folders` → pass the full path (`/Users/...` or `~/...`) of a file inside the user's folders; the message lists them.
- `… [debug script: path]` → an unexpected InDesign failure: report it with the path to the PM and stop that step.

### New documents

A document created from scratch needs no backup or review. Create styles first, then frames with `paragraphStyle`; check with `render_preview` / `measure_text`; export with `export_pdf`. Logos: native paths (`create_path_from_svg`) first, `place_graphic` for .svg/.pdf/.ai/.eps, `create_graphic_from_svg` as the fallback. The full tool reference is in `README.md`.
