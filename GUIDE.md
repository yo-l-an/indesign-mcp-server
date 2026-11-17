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
- Master object, margins, grid or document setup → every page that uses it is the scope (`get_layout_setup` lists which pages use each master; `allPages: true` when it is most of them).
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

Changes need no further step for their snapshot: before each tool that modifies an existing document, the server adds the pages it touches to the BEFORE (an object's page, a `pageIndex`, else the page shown in InDesign) and makes the task's backup if none exists yet. The tool result then carries an `Auto snapshot` line. `prepare_edit` stays the way to start a task: it names the reason, lists the objects and covers whole-document scopes (`allPages`). Documents created in this session get no backup or snapshot.

**Done when** the result shows a backup path and a `snapshotId`.

### 3. Change surgically

- Address objects by **id** (stable), from the list of step 2.
- Text: `find_replace_text({ findText, replaceText, frameId })` for a word or a sentence; `edit_text_frame` with `content` only to rewrite a whole story. French text you touched gets `french_typography` on the same frames (French typography, below).
- Pages: `move_page({ page: "10", after: "3" })`, `add_page`, `delete_page`. Objects to another page: `move_to_page({ id, page: "12" })`.
- Groups: ids reach objects inside groups, so change a member by its id and leave the document's groups as they are (Groups and names, below).
- Objects that come from a master (a folio, a header): change them on the master for every page, or override them on one page (Masters, below).
- Formatting: apply existing paragraph/character styles. Editing a style changes every page that uses it, so it is a whole-document scope (step 1).
- Text that no longer fits (`overflows=true` / `OVERSET`): enlarge the frame with `set_object_geometry`, or tell the PM. Type size changes only with the PM's agreement.

**Done when** every tool result confirms the change landed in scope: `Where:` lists only scope pages, the ids are the intended ones, `overflows=false`.

### 4. Review and report

```javascript
review_compare()                   // few changes
review_compare({ maxImages: 1 })   // many changes: the table carries them
```

The images in the tool result reach you only. Show the PM the files listed on the `Images to show the user` line:

1. Copy them into a folder your client displays inline: your session's scratchpad or working folder (Claude Code shows files from the system temp folder as download cards only). The document's folder stays free of them.
2. Send the copies with your client's file-sharing tool (for example `SendUserFile` with `display: "render"`), and put the change table in your message. Then report in three short parts: **what changed**, **the review**, **open points** (anything not done or not checked).

**Done when** the PM sees the images inline in the conversation and has the table, and every table row matches something they asked for. A row they did not ask for is a side effect: fix it, or explain it in the open points. With client feedback: every feedback number is done or listed in the open points.

### 5. Close the task

- Further corrections on the same task ("finally 16 €"): change, then `review_compare()` again. It compares with the same BEFORE, so the PM sees the whole task.
- Saving is automatic: `review_compare` saves the reviewed document after the review, and its result names the backup to roll back to (`restore_backup`). Tell the PM it is saved and where the backup is. A document with no file yet ("Sans titre-1") or converted from an older version stays unsaved: the result says so; ask the PM for a place or a name and pass `filePath` (Saving, below).
- A new, separate request starts again at step 1 with a new `prepare_edit`.
- A bug, a missing feature, a better way found, or a fix you made to the server during the task → NOTES.md (Improving the server, below).

**Done when** the PM has confirmed the result, and the review result shows `Saved:` (or the PM has given a place for a document with no file).

## Reference

### Pages, ids, units

- **Page names** are what the PM says and what `pages` takes. Tools with `pageIndex` count from 0 in file order; `prepare_edit` and `find_text` print both. A name used twice (sections) → `"+N"`, the N-th page of the file. With alternate layouts every layout repeats the page names: `"Tablette:2"` is page 2 of the layout "Tablette".
- **Ids** stay valid when objects are added or reordered; `frameIndex` / `index` shift, so ids are the reliable handle.
- **Millimetres**, origin at the top-left of each page's trim box; negative values reach into the bleed. Angles in degrees, counter-clockwise positive.
- **Page size** is per page: `set_page_size({ pageIndexes: [0], height: 159 })` resizes from the top-left corner and leaves objects where they are; `add_page({ width, height })` adds a page of its own size. `get_document_info` lists the pages whose size differs from the document's.
- **One document at a time**: tools act on the active document. With several documents open, or when the PM names another file, check with `list_open_documents` and `activate_document`.

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

- The images label themselves (BEFORE | AFTER, colour legend, zone numbers matching the table's `#`). A text-only edit is framed on the changed lines; the gutter beside each page marks where each zone sits vertically.
- A modified object's zone label carries one icon per kind of change, each with that side's value: ✥ move (`x · y`, mm), ⤢ resize (`w × h`, mm), ↻ / ↺ rotation (angle, arrow in the direction of the turn), **fx** effects (drop shadow, glow, feather, blend mode…), ■ fill, □ stroke, ◐ opacity, **T** text. An object aligned on the grid has a two-line label on the AFTER side: the first line gives its alignment, horizontal then vertical (icon: left edge, right edge, centre, or both edges held), with the names of the lines; the second line the other changes. Point the user at them when you describe the change.
- **Page map** (when pages were added, removed or moved): the document seen from above as spreads, BEFORE and AFTER side by side; identical spreads share a row and long runs are folded. Added pages green, removed red, moved pages orange with an arrow from the old place to the new one; grey links show pages that only shifted to another spread. Page names follow the numbering, so a moved page reads "10 → 4" in the table. With alternate layouts a band names each layout, and a page moved from one layout to another reads "A5:3 → A4:2". `view_page_map` shows the whole document from above at any time, without a comparison.
- **Move image** (when objects changed page): source page BEFORE | destination page AFTER, an arrow from each object to where it landed. The destination page is found even outside the scope.
- After a renumbering, a "Visuel" zone on a page's folio is the page number changing; the table says so.
- Identical changes on many objects share one table row; `report.html` keeps one row per object and every image.
- Review files are temporary, in `$TMPDIR/indesign-mcp-review/` (about 200 KB per page; removed after 3 days, at most the 300 newest snapshots kept). Attach `report.html` or the PNGs to the conversation when the PM wants to keep or share the review; the repository and the InDesign folder stay free of them.
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

- `prepare_edit` writes `<document>__YYYY-MM-DD_HHhMMmSS__<reason>.indd` into **`InDesign Agent Backups`** next to the .indd (`$INDESIGN_BACKUP_DIR` overrides); for a document never saved, into `~/Documents/InDesign Agent Backups`. It holds the state in InDesign before the task, unsaved changes included. Snapshots and `review_compare` work the same on an unsaved document.
- One backup per task. `backup: false` when the PM declined it or the task already has one; `backup_document` for an extra copy before a risky step.
- Backups are permanent: they stay until the PM explicitly asks to delete them.
- Going back, on the PM's request: `list_backups`, then `restore_backup({ backupPath: "<file name>", confirmDestructive: true })`. It backs up the current state first, then replaces and reopens the document.

### Fitting type to a position

For display type matched to a layout (a mock-up, a reference image):

- Size and spacing go on the text itself: `create_text_frame` / `edit_text_frame` take `leading`, `tracking` and `horizontalScale` (percent); paragraph and character styles take `horizontalScale` too. `horizontalScale` fits a word to a width with its letters intact; `tracking` spaces them.
- `set_text_frame_options({ id, autosize: "HEIGHT_AND_WIDTH", inset: 0 })` shrinks the frame to its text and keeps its top-left corner (`autosizeReference` picks another point).
- `measure_text({ frameId, inkBounds: true })` gives the bounds of the visible glyphs and their offset from the frame: move the frame by the difference between the ink edge and the target edge.

**Done when** the ink bounds of each word sit on their target edges (within 0.5 mm).

### Text frames

A text frame is cut to its text and to its job, so it aligns by its type and not by an empty box:

- **Titles, labels, short lines**: `set_text_frame_options({ id, firstBaseline: "cap_height", inset: 0, autosize: "HEIGHT_AND_WIDTH" })` (no line breaks follows automatically): the top of the frame is the top of the capitals, the frame hugs the words, and an alignment on a guide puts the letters on it. `x_height` for lowercase-only labels.
- **Anchor of the auto-size** = the side that must stay put: left-aligned text `top-left` (or `left` / `bottom-left` for a line standing on a rule), centred `top`, right-aligned `top-right`.
- **Body text**: fixed width on the columns (`fit_to_grid`), `autosize: "HEIGHT_ONLY"` when its height must follow the text, `firstBaseline: "leading"` so its first line sits on the baseline grid, `columns` / `columnGutter` (or `columnWidth`, `balanceColumns`, `columnRule`) inside one frame rather than one frame per column.
- **Insets** per side (`insetTop`…) for a frame with a fill or a stroke; a frame with rounded or other corner effects keeps one inset for all four sides (the result says so). A sidebar on another leading gets its own baseline grid (`baselineGrid: "custom"`). Text wrap: `textWrap`, `textWrapOffsets`, `textWrapSide`; `ignoreWrap` on a frame that must stay full.

Check with `measure_text` (and `inkBounds: true` for display type, Fitting type to a position).

### Aligning on the grid

Objects sit on the page's structure: margins, columns, rows, guides, baseline grid.

- `get_page_grid({ page })` lists every reference line with its position (margins, start and end of each column, page and master guides, page centre, bleed; `baseline: true` adds the baseline grid).
- `fit_to_grid({ ids, columns: [3, 6], rows, rowCount })` places objects on columns / rows: `fit: "span"` fills them, `start` / `end` / `center` keeps the size.
- `snap_to_grid({ ids })` brings objects that sit a few mm off onto the nearest lines (left / top edges on column starts, right / bottom edges on column ends); `dryRun: true` first when the objects are the client's.
- `align_objects` aligns objects to each other, the page or the margins.

The review draws the lines an object was aligned on, on both images, and its label carries the alignment on its first line (Review output); the table has an "Alignement" row. Centring: `snap_to_grid({ ids, mode: "center" })` puts an object's centre on the nearest line (a column centre, the page centre, a guide); `fit_to_grid({ fit: "center" })` centres it across columns / rows.

**Done when** every object you placed lands on lines `get_page_grid` lists (the tool results name them).

### French typography

`french_typography` applies the French rules rule by rule: spaces (double, before `,` `.` `…`, inside brackets), thin no-break space before `;` `!` `?` and no-break space before `:` and inside « », apostrophe ’, ellipsis …, thousands and units (10 000, 12 €, 30 %), dates and abbreviations (12 mars, M. Dupont, n° 5), en dash for incises and ranges, ordinals in superscript (XIXe, 1er, 2e), œ ligature, accented capitals (À la, État, École), bulleted-list punctuation. Straight quotes → « » and the × sign are off by default: they depend on the text (English, code, inches).

1. `french_typography({ frameId | pages | allPages, dryRun: true })` counts each rule's changes with examples.
2. Show the user the counts and the doubtful examples; turn off what they decline with `rules: { name: false }`, turn on `quotes` / `multiplication` when they ask; `lists: "semicolon"` (or `none` / `period`) when the lists need fixing.
3. Run it without `dryRun`, then `review_compare`.

In a correction, run it on the frames you changed (step 3 scope); on a whole document only when the user asks for a typographic pass.

### Groups and names

Objects are placed absolutely, so a group earns its place only where objects must move or align as one. In a layout you build or add, group those units with `group_objects({ ids, name })`:

- a block: a box with its frame lines, pictogram and text;
- an illustration: the shapes of one drawing or pattern;
- texts aligned together: a kicker, title and intro on one edge, the words of a wordmark.

Everything else stays ungrouped: single frames, backgrounds, panels. Name each group by its role, in the PM's language ("Encadré", "Motif", "Bloc titre"); `name_object` names a single object when its role is not obvious from its content ("Masque"). A group takes the stacking level of its topmost member: check `list_page_items` and `render_preview` after grouping.

Layers, masters and styles carry names too: `set_layer({ name, newName })`, `set_master({ master, newName, prefix })`, `modify_paragraph_style` / `modify_character_style` / `modify_object_style` with `newName`, `update_color_swatch` with `newName`.

In a document you correct, the groups and names are the client's: change them only when the PM asks.

**Done when** each block, illustration and aligned text set of the new layout is one named group, and `render_preview` matches the page before grouping.

### Saving and where files go

- **New document**: ask the PM where to save it before `create_document`, then pass that path: `create_document({ preset: "A4", filePath: "~/…/Brochure.indd" })` saves it there right away.
- **No file yet** ("Sans titre-1") and the PM could not be asked: `save_document()` (or `close_document({ save: true })`) saves it into `~/Documents` under its own name, and the result gives the path. Tell the PM that path and ask whether to move it; `save_document({ filePath })` saves it elsewhere.

**Done when** every document you created or saved has a path the PM knows.

### Converted documents

A document made with an older InDesign opens as **converted** (`get_document_info` says so): it has no file until saved, so `save_document` needs a `filePath`. Saving over the original replaces the old-version file (the backup keeps the previous state). Ask the PM which name to use.

### When a tool fails

Read the message: it names the next step (valid page names, missing parameter, which document is active). Beyond that:

- `No object with id N` → the object changed; `find_text` or `list_page_items` on that page gives the current id.
- `Paragraph style not found` / `Swatch not found` → `list_styles` / `list_color_swatches`; create a new one only when the PM wants it.
- `Security confirmation required` → add `confirmDestructive: true` only for an action the PM asked for.
- `use an absolute path` / `outside the allowed folders` → pass the full path (`/Users/...` or `~/...`) of a file inside the user's folders; the message lists them.
- `… [debug script: path]` → an unexpected InDesign failure: report it with the path to the PM and stop that step, and note it (Improving the server).

### Improving the server (NOTES.md)

The server improves through what you learn using it. You may have no push rights on its repository, so `NOTES.md` in the server folder carries your findings to the project's author, who chooses the real implementation.

- **No tool for a particular case** (a property no tool exposes, a one-off batch, a check): write a short `run_script({ purpose, code, missing, ids })` and carry on. It runs ES3 ExtendScript on the active document (`doc`, `__findById`, mm from each page's top-left; the last expression is the result), joins the task's snapshot through `ids` / `pageIndex`, and notes itself in NOTES.md with `missing`, so a need that comes back becomes a real tool. Files, system, menus, saving and exporting stay with their tools.
- **Found a bug, missed a feature, or found a better way**: `read_improvement_notes` (is it already there?), then `add_improvement_note({ kind, title, details, tool })`. In `details`: what you tried, what happened, how to reproduce it, what would help. Write it generically: no client names, no client text.
- **A tool is wrong or a missing feature blocks the work** (critical, or needed again and again): a real change, not a script. If you can edit files, fix the script directly in the tool's module (`tools/*-tools.js`, the server folder is shown by `read_improvement_notes`). Keep the change small, and ask the user to restart the MCP server so it loads. Then `add_improvement_note({ status: "fixed-locally", filesChanged: ["tools/export-tools.js: what changed"], details })` with why and what it does now. Every local change gets a note; commits and pushes stay with the author.
- **Before you finish**: tell the user in one short paragraph that the server needs improvements, that you wrote them (with any local fixes) in `NOTES.md`, and that the notes are ready to be given to the author of the project.

**Done when** every workaround, bug, wish and local change of the session is in `NOTES.md`, and the user has had that paragraph.

### New documents: kickstart

A document built from scratch starts with its technical frame, settled with the user before the first page exists. A document built from scratch needs no review while you build it; corrections to it afterwards follow the workflow.

1. **Ask the kickstart questions.** Use your client's question tool (multiple choice, at most 4 questions per round), the recommended answer first. The table below is a starting point, not a fixed form: drop a question the brief or an existing document already answers (`get_layout_setup` on a template), recommend other values when the project calls for them (a 3 mm bleed for a printer who asks for it, 8 columns for a newspaper, 0 mm for a screen-only deck), and add the questions the project raises (spine width of a book, folding of a leaflet, languages of a bilingual document, accessibility of an export). One round covers the format, the next the grid:

   | Question | A (recommended) | B | C | D |
   |---|---|---|---|---|
   | Where to save the file | (a folder the user names) | | | |
   | Format and orientation | A4 portrait | A4 landscape | A5 portrait | Other size |
   | Pages | Facing pages (brochure, book), first page on the right | Single pages (presentation, poster, screen) | Facing, first page on the left | Other |
   | Binding | Left (left-to-right reading) | Right (right-to-left) | | |
   | Bleed | 5 mm | 3 mm | None (0 mm, screen only) | Other |
   | Margins | 15 mm all round | 20 mm, inside 25 mm (thick book) | 10 mm (flyer, poster) | Other |
   | Column grid | 12 columns | 6 columns | 24 columns | Other |
   | Gutter | 4 mm | 5 mm | 3 mm | Other |
   | Rows (modular grid) | None | 6 rows | 8 rows | Other |
   | Baseline grid (= body leading) | 12 pt from the top margin | 14 pt | None | Other |
   | Page numbers | Arabic 1, 2, 3 at the bottom outside corner | 01, 02, 03 | None | Other |
   | Output | Print (CMYK) | Screen (RGB) | Both | |
   | Layers | Fonds / Images / Textes | One layer | | Other |
   | Fonts | Title and body fonts named in the brief | (propose two installed families: `list_fonts`) | | |

2. **Build the frame**, in this order:
   - `create_document({ filePath, preset or width/height, pages, facingPages, bleed, margins })`, then `set_document_setup` for binding, start page, intent, uneven bleed;
   - on master A: `set_margins_columns({ masters: ["A"], columns, gutter })`, `create_grid_guides({ masters: ["A"], columns, rows, columnGutter })`, `set_grids({ baselineIncrement, baselineStart, baselineRelativeTo: "margin" })`;
   - layers: `create_layer` for each, `move_layer` into order (backgrounds lowest), `set_layer` for colours or non-printing notes;
   - folios on master A (Page numbers, below), and a section when numbering starts elsewhere (`set_section`);
   - styles (paragraph, character, object) with the chosen fonts, the body leading equal to the baseline grid.
3. **Lay out the pages**: frames with `paragraphStyle`, cut to their text (Text frames, below) and placed on the columns (`fit_to_grid`, Aligning on the grid); objects on their layer (`move_to_layer`); a layout that repeats (chapter openers, a footer, a background) goes on a master as soon as it repeats (Masters, below); group each block, illustration and aligned text set as it is finished (Groups and names, above). Logos: native paths (`create_path_from_svg`) first, `place_graphic` for .svg/.pdf/.ai/.eps, `create_graphic_from_svg` as the fallback.
4. **Check**: `get_layout_setup` matches the answers; `view_page_map` shows the spreads and masters; `render_preview` / `measure_text` for the pages; export with `export_pdf`.

**Done when** every kickstart answer shows in `get_layout_setup`, every page carries its folio from a master, and the user has the file path. The full tool reference is `docs/TOOLS.md` in the server folder.

### Layout setup

`get_layout_setup` reads the whole frame at once: format, facing pages, binding, start page, bleed and slug, spreads, each master's margins, columns, objects and guides, the pages that differ from their master, baseline and document grids, sections, alternate layouts, layers. Change it with:

- `set_document_setup`: page size (`adjustLayout: true` moves the objects, guides and type with the new size), facing pages, `binding`, `startPageNumber`, `intent`, bleed (uniform or per side), slug, page shuffling;
- `set_margins_columns` on `masters` (every page that uses them follows) or on `pages` (an exception);
- `create_grid_guides` (columns and rows with gutters, inside the margins or across the page), `add_guides` at given positions, `delete_guides`;
- `set_grids`: baseline grid (increment in pt, start in mm from the page or the top margin) and document grid.

Margins read **inside / outside** on facing pages: on a left-hand page the inside margin is on the right; the tools place grids accordingly.

### Page numbers and special characters

A folio is the page-number **character** on a master, never a typed number: InDesign then writes the right number on every page and keeps it right when pages move, are added or are removed, and the section sets its style.

- On a master: a text frame with `insert_special_character({ frameId, character: "page_number" })`, at the bottom outside corner of each master page.
- Typed folios already on the pages: `find_repeated_items` finds them (marked "typed folio"); `create_master({ …, pageNumberIds })` turns them into the page-number character on a master and removes the typed copies; on a single frame, `insert_special_character({ frameId, character: "page_number", replace: "12" })`.
- Numbering style and restart: `set_section({ page, startNumber, style: "1" | "01" | "i" | "I" | "a" | "A", prefix, marker })`; `section_marker` prints the marker (a chapter name in the header).
- Other characters: `next_page_number` / `previous_page_number` ("suite page 12"), the French space before `;` `:` `!` `?` and inside « » (`fixed_nonbreaking_space`), em / en / thin / hair spaces, em and en dashes, discretionary and nonbreaking hyphens, column / frame / page breaks, `right_indent_tab`, `indent_to_here`, `end_nested_style`. In `find_replace_text` with GREP, `~N` is the page number and `~S` the fixed nonbreaking space.

### Masters

A master (parent page) holds what repeats: background, header, footer, folio, logo, grid and guides. Each page shows its master's objects behind its own objects of the same layer (a master object on a higher layer shows in front).

- **Spot the repetition**: when the same object sits at the same place on several pages, run `find_repeated_items`; each pattern comes with the `create_master` call that moves it to a master (`fromIds` from one left and one right page, `pageNumberIds` for folios, `applyTo`, `removeMatching: true` to remove the copies from the pages).
- **Apply**: `apply_master({ pages, master })`, `"none"` for no master; `showMasterItems: false` hides them on a spread (a full-page photo).
- **Change for every page**: `list_master_items({ master })` gives the ids; edit them with the usual tools (`set_object_geometry`, `find_replace_text`, `edit_text_frame`…). `find_text` and `find_replace_text` reach master text and say "master …".
- **Change one page only**: `override_master_items({ page, ids })` gives the page an editable copy (new id) that still follows the master for what you leave untouched; `detach: true` cuts the link; `remove_master_overrides` brings the master version back.
- **Organise**: `create_master({ basedOn })` for a variant that inherits a parent master; `copy_to_master` to add objects; `set_master` to rename or change the parent; `delete_master({ replaceWith })`.

In a document you correct, the masters are the client's: a master change reaches every page that uses it, so it needs the PM's agreement and an `allPages` scope (step 1).

### Spreads, facing pages, binding

- Facing pages, binding edge and first page: `set_document_setup({ facingPages, binding, startPageNumber })`; with facing pages an even start number puts the first page on the left.
- A spread of 3 or 4 pages (gatefold): `set_document_setup({ allowPageShuffle: false })`, then `set_spread_options({ joinPages: ["4", "5", "6"] })`.
- A spread that must stay together while pages move around it: `set_spread_options({ pages, allowShuffle: false })`.
- Reordering: `move_page` (a page alone in its spread moves with its spread), `add_page`, `duplicate_page`, `delete_page`; `view_page_map` to check the result.

### Alternate layouts

An alternate layout is another version of the pages in the same document: another format (A5, screen), a variant to compare, a version kept before a big change. Its pages carry their own masters, and its text stays linked to the source unless told otherwise.

- Create: `create_alternate_layout({ name, preset or width/height, from, linkStories, rule })`; `linkStories: false` for an independent version; `rule: "scale"` to scale the objects to the new size, `"preserve"` to keep them as they are.
- Address its pages as `"Layout:page"` in every tool; `get_layout_setup` lists the layouts and their page ranges.
- Export one layout: `export_pdf({ layout, pageRange })` / `export_images({ layout })`, `pageRange` counted within the layout.
- Compare: `compare_layouts({ a, b })` (page by page) or `compare_layouts({ pageA, pageB })` gives the pages side by side, each layout named, numbered zones and a table (place and size in mm and % of the page, text, type size, fonts, styles, colours, images). Show the images, then explain the differences in a few sentences: what moved, what changed size, what exists in one version only.
- Delete: `delete_alternate_layout({ name, confirmDestructive: true })`, only when the PM asks.

**Done when** the PM has the comparison images and your explanation, or the exported file of the layout they asked for.

### Settings no tool reaches

Some settings are reached only by hand (print booklet, colour settings, text variables, tables of contents, preferences…). `get_usage_guide({ topic: "manual-settings" })` lists them with what they are for and their menu path in French and English: give the user the path, carry on with the rest, and keep the step in the open points until the user confirms it.
