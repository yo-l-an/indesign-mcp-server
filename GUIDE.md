# InDesign MCP Server – Guide for agents

Read once per session (`get_usage_guide`), before the first change to a document. The full tool reference is in `README.md`; you do not need it for routine work.

You usually work for a **project manager** (PM) who asks for precise corrections ("page 12, replace the price", "move the logo on p. 3"). Work like a careful layout artist: go straight to what was asked, change only that, show what changed, keep a way back.

## The workflow (every task)

```javascript
// 1. Prepare: backup + BEFORE snapshot of the named pages + object list, in ONE call
prepare_edit({ pages: ["12"], reason: "correction prix p12" })
// -> Backup: …/InDesign Agent Backups/Doc__2026-11-16_14h05m09__correction-prix-p12.indd
// -> Snapshot: snapshotId=…
// -> Page 12 (pageIndex 11, 210×297 mm) – 9 objects:
//      id=4512 TextFrame x18 y52 174×86 [Corps] «Tarifs 2026 ¶ Prix : 12 € …»

// 2. Change, by id, as narrowly as possible
find_replace_text({ findText: "12 €", replaceText: "15 €", frameId: 4512 })
// -> Replaced 1 instance(s) … Where: p.12 frame 4512

// 3. Review: only the changed pages, cropped, + change table
review_compare()
// 4. Show the PM the image(s) and the table. Say what you did not do or could not check.
// 5. Save only when the PM asks (see "Saving").
```

Corrections after the review ("finally 16 €"): change, then `review_compare()` again – it always compares with the same BEFORE, so the PM sees the whole task. A new, separate task starts with a new `prepare_edit`.

## Be fast and precise (token budget)

- **The PM names a page → use it.** `prepare_edit({ pages: ["12"] })` takes the page name shown in InDesign (folio). Do not read other pages, do not list the document, do not call `get_document_info` "to get context".
- **The PM quotes text → `find_text`.** It returns page, frame id and a short context. Never read whole stories to locate something.
- **Snapshot only the pages the task touches.** `allPages: true` only for document-wide changes (style or swatch edits, global replace). For a global replace, `find_text` first, then `prepare_edit` with the pages it found.
- **One call, not five.** `prepare_edit` already gives ids, positions, styles and text excerpts. Call `list_page_items` / `get_object_info` / `get_text_content` only for what that list does not answer. Pass `listObjects: false` when you already know the ids.
- **Narrow tools.** `find_replace_text` with `frameId` (one story), not document-wide by default. `edit_text_frame` with `content` replaces the whole story: prefer `find_replace_text` for a word or a sentence.
- **No previews you will not use.** `review_compare` is the visual check. `render_preview` only when you need to see something before deciding (prefer `objectId` over a whole page).
- **Many changes → table, few images.** `review_compare({ maxImages: 1 })`; identical changes are grouped into one table row; `report.html` holds every image and one row per object.
- Keep your messages short: what was changed, the review, open points. No restating of tool output.

## Pages, ids, units

- **Page names vs indexes.** The PM says page names ("12", "iv", "A-3"). Tools that take `pageIndex` count from 0 in file order. `prepare_edit` and `find_text` print both. A name used twice (sections) → use `"+N"` (N-th page of the file).
- **Use ids, not indices.** Ids are stable; `frameIndex` / `index` shift when objects are added or reordered.
- **Millimetres**, origin at the top-left of each page's trim box; negative values reach into the bleed. Angles in degrees, counter-clockwise positive.
- **Read results.** `overflows=true` / `OVERSET` = text does not fit: tell the PM or fix it (enlarge with `set_object_geometry`, never shrink type without asking).
- Formatting belongs in styles: apply existing paragraph/character styles rather than local overrides. Changing a style changes every page that uses it – that is a document-wide task.
- Do not open, close or switch documents in InDesign while tools run. Check the active document with `list_open_documents` only if several are open or the PM names another file.

## Review for the PM

`review_compare` returns:
- per changed page, an image **BEFORE (left, red frames) | AFTER (right, green frames)**, cropped to the changed area ("DETAIL"), zones numbered;
- a Markdown table whose `#` matches the zones;
- a temp folder with `report.html` (self-contained: images + detailed table) and the PNGs.

Show the images and the table in the conversation; attach `report.html` when the PM wants to share or archive the review. Review files live in `$TMPDIR/indesign-mcp-review/` and are removed after 3 days: **never copy them into the repository or next to the InDesign file.**

### Change table template

Use these columns when you report changes by hand (e.g. no snapshot was possible):

| # | Page | Élément | Propriété | Avant | Après | Type |
|---:|---|---|---|---|---|---|
| 1 | 12 | Bloc texte #4512 «Tarifs 2026» | Texte | Prix : ~~12~~ € | Prix : **15** € | Modifié |
| 2 | 12 | Image #4520 «photo.jpg» | Position / taille | x 10 · y 40 · 60 × 40 mm | x 10 · y 50 · 60 × 40 mm | Modifié |
| 3–21 | 5, 10, 12 … (19) | 19 × Bloc texte | Corps | 11 pt | 8 pt | Modifié |
| 22 | 14 | — | Zone modifiée à l’image | | | Visuel |
| — | Document | Style de paragraphe «Puces» | Style de paragraphe | size: 11 | size: 8 | Modifié |

`~~struck~~` = removed, `**bold**` = added. "Visuel" = a pixel change no object explains (style definition, relinked image, master page). Table cell text is compared too ("Contenu du tableau").

## Backups

- `prepare_edit` makes the backup: `<document>__YYYY-MM-DD_HHhMMmSS__<reason>.indd` in **`InDesign Agent Backups`** next to the .indd (`$INDESIGN_BACKUP_DIR` overrides; never-saved documents: `~/Documents/InDesign Agent Backups`). It is the state in InDesign before your changes, unsaved changes included.
- One backup per task. `backup: false` only if the PM declined it or the task already has one. `backup_document` for an extra copy before a risky step.
- **Never delete a backup** (nor the folder) unless the PM explicitly asks for it.
- Going back: `list_backups` → `restore_backup({ backupPath: "<file name>", confirmDestructive: true })`, only on the PM's request. It backs up the current state first, then replaces the document and reopens it.

## Saving

- Do not save on your own. After the review, ask whether to save (`save_document`).
- **Converted documents** (made with an older InDesign; `get_document_info` says "converted"): they have no file until saved. Saving needs a `filePath`; saving over the original replaces the old-version file (the backup keeps the previous state). Ask the PM which name to use.

## Errors and what to do

| Message | Meaning / next step |
|---|---|
| `Page "X" not found. Page names: …` | Use one of the listed names, or `"+N"`. |
| `Page name "X" is used N times` | Sections: use the `"+N"` positions given. |
| `Say which pages` | `prepare_edit` needs `pages` (or `allPages: true` for document-wide work). |
| `No snapshot` / `Snapshot not found` | Call `prepare_edit` before the changes (snapshots last 3 days). |
| `The active document is X, the snapshot is of Y` | `activate_document` the right one. |
| `No document open` | Open the file the PM named (`open_document`). |
| `No object with id N` | The object was deleted or the document changed; use `find_text` or `list_page_items` for that page. |
| `Paragraph style not found: X` / `Swatch not found: X` | Use `list_styles` / `list_color_swatches`; create only if the PM wants a new style. |
| `Font not installed: F (S)` | Check exact family and style names (`list_fonts`). |
| `Security confirmation required` | Destructive tools need `confirmDestructive: true`; add it only when the PM asked for that action. |
| `… [debug script: path]` | Unexpected InDesign failure; the script was kept at that path. Report it, do not retry blindly. |

`execute_indesign_code` is disabled unless the server runs with `INDESIGN_ALLOW_ARBITRARY_CODE=1`. Do not ask users to enable it.

## Creating new documents (less common)

No backup or review is needed for a document you create from scratch. Create styles first, then frames with `paragraphStyle`; check with `render_preview` / `measure_text`; export with `export_pdf` (`confirmDestructive: true` when the PM asked for the file). Logos: native paths (`create_path_from_svg`) first, `place_graphic` for .svg/.pdf/.ai/.eps, `create_graphic_from_svg` only as a fallback.
