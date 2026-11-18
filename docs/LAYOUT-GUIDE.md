# Building a layout

For a new document, or new pages and structure in an existing one. A document you build needs no snapshot or review while you build it; corrections to it afterwards follow the workflow of `get_usage_guide`. In a document you correct, the setup, masters, groups and names are the client's: change them only when the PM asks, with an `allPages` scope.

## New documents: kickstart

A document built from scratch starts with its technical frame, settled with the user before the first page exists.

1. **Ask the kickstart questions** with your client's question tool (multiple choice, at most 4 questions per round, the recommended answer first): one round for the format, the next for the grid. The table is a starting point: drop what the brief or a template already answers (`get_layout_setup` on the template), recommend the values the project calls for (3 mm bleed for a printer who asks, 8 columns for a newspaper, 0 mm for a screen deck), and add what the project raises (spine width, folding, languages, accessible export).

   | Potential Question | A (recommended) | B | C | D |
   |---|---|---|---|---|
   | Where to save the file | (a folder the user names) | Temporary in Documents folder | | |
   | Format and orientation | A4 portrait | A4 landscape | A5 portrait | Other size |
   | Pages | Facing pages (brochure, book), first page on the right | Single pages (presentation, poster, screen) | Facing, first page on the left | Other |
   | Bleed | 5 mm | 3 mm | None (0 mm, screen only) | Other |
   | Margins | 15 mm all round | 20 mm, inside 25 mm (thick book) | 10 mm (flyer, poster) | Other |
   | Column grid | 12 columns | 6 columns | 24 columns | Other |
   | Rows (modular grid) | None | 6 rows | 8 rows | Other |
   | Baseline grid (= body leading) | 12 pt from the top margin | 14 pt | None | Other |
   | Page numbers | Arabic 1, 2, 3 at the bottom outside | 01, 02, 03 | None | Other |
   | Output | Print (CMYK) | Screen (RGB) | | |
   | Fonts | Title and body fonts named in the brief | (propose two installed families: `list_fonts`) | | |

2. **Build the frame**, in this order:
   - `create_document({ filePath, preset or width/height, pages, facingPages, bleed, margins })` (saved at `filePath` right away), then `set_document_setup` for binding, start page, intent, uneven bleed;
   - on master A: `set_margins_columns({ masters: ["A"], columns, gutter })`, `create_grid_guides({ masters: ["A"], columns, rows, columnGutter })`, `set_grids({ baselineIncrement, baselineStart, baselineRelativeTo: "margin" })`;
   - layers: `create_layer` for each, `move_layer` into order (backgrounds lowest), `set_layer` for colours or non-printing notes;
   - folios on master A (Page numbers), and `set_section` when numbering starts elsewhere;
   - paragraph, character and object styles with the chosen fonts, body leading equal to the baseline grid.
3. **Lay out the pages**: frames with `paragraphStyle`, cut to their text (Text frames) and placed on the columns (Aligning on the grid); objects on their layer (`move_to_layer`); a layout that repeats (chapter openers, a footer, a background) moves to a master as soon as it repeats (Masters); each block, illustration and aligned text set grouped as it is finished (Groups and names). Logos: native paths (`create_path_from_svg`) first, `place_graphic` for .svg/.pdf/.ai/.eps (artboard and bleed: Placing PDF and Illustrator artwork), `create_graphic_from_svg` as the fallback.
4. **Check**: `get_layout_setup` matches the answers; `view_page_map` shows the spreads and masters; `render_preview` / `measure_text` for the pages; `export_pdf`.

**Done when** every kickstart answer shows in `get_layout_setup`, every page carries its folio from a master, and the user has the file path. The full tool reference is `docs/TOOLS.md` in the server folder.

## Layout setup

`get_layout_setup` reads the whole frame at once: format, facing pages, binding, start page, bleed and slug, spreads, each master's margins, columns, objects and guides, the pages that differ from their master, baseline and document grids, sections, alternate layouts, layers. Change it with:

- `set_document_setup`: page size (`adjustLayout: true` moves objects, guides and type with it), facing pages, `binding`, `startPageNumber`, `intent`, bleed (uniform or per side), slug, page shuffling;
- `set_margins_columns` on `masters` (every page that uses them follows) or on `pages` (an exception);
- `create_grid_guides` (columns and rows with gutters, inside the margins or across the page), `add_guides`, `delete_guides`;
- `set_grids`: baseline grid (increment in pt, start in mm from the page or the top margin) and document grid;
- one page of its own size: `set_page_size({ pageIndexes, width, height })` or `add_page({ width, height })`.

Margins read **inside / outside** on facing pages: on a left-hand page the inside margin is on the right; the tools place grids accordingly.

## Spreads

- Facing pages, binding edge and first page: `set_document_setup({ facingPages, binding, startPageNumber })`; with facing pages an even start number puts the first page on the left.
- A spread of 3 or 4 pages (gatefold): `set_document_setup({ allowPageShuffle: false })`, then `set_spread_options({ joinPages: ["4", "5", "6"] })`.
- A spread that stays together while pages move around it: `set_spread_options({ pages, allowShuffle: false })`.
- Reordering: `move_page` (a page alone in its spread moves with its spread), `add_page`, `duplicate_page`, `delete_page`; `view_page_map` to check.

## Masters

A master (parent page) holds what repeats: background, header, footer, folio, logo, grid and guides. Each page shows its master's objects behind its own objects of the same layer (a master object on a higher layer shows in front). Editing master objects and overriding them on one page: the workflow guide, Masters.

- **Spot the repetition**: when the same object sits at the same place on several pages, `find_repeated_items`; each pattern comes with the `create_master` call that moves it to a master (`fromIds` from one left and one right page, `pageNumberIds` for folios, `applyTo`, `removeMatching: true` to remove the copies).
- **Apply**: `apply_master({ pages, master })`, `"none"` for no master; `showMasterItems: false` hides them on a spread (a full-page photo).
- **Organise**: `create_master({ basedOn })` for a variant that inherits a parent; `copy_to_master` to add objects; `set_master` to rename or change the parent; `delete_master({ replaceWith })`.

## Page numbers and special characters

A folio is the page-number **character** on a master: InDesign writes the right number on every page, keeps it right when pages move, and the section sets its style.

- On a master: a text frame at the bottom outside corner of each master page, with `insert_special_character({ frameId, character: "page_number" })`.
- Typed folios on the pages: `find_repeated_items` marks them "typed folio"; `create_master({ …, pageNumberIds })` turns them into the character on a master and removes the typed copies; on one frame, `insert_special_character({ frameId, character: "page_number", replace: "12" })`.
- Numbering style and restart: `set_section({ page, startNumber, style: "1" | "01" | "i" | "I" | "a" | "A", prefix, marker })`; `section_marker` prints the marker (a chapter name in the header).
- Other characters: `next_page_number` / `previous_page_number` ("suite page 12"), `fixed_nonbreaking_space` (French space before `; : ! ?` and inside « »), em / en / thin / hair spaces, em and en dashes, discretionary and nonbreaking hyphens, column / frame / page breaks, `right_indent_tab`, `indent_to_here`, `end_nested_style`. In `find_replace_text` with GREP, `~N` is the page number and `~S` the fixed nonbreaking space.

## Text frames

A text frame is cut to its text and its job, so it aligns by its type, not by an empty box:

- **Titles, labels, short lines**: `set_text_frame_options({ id, firstBaseline: "cap_height", inset: 0, autosize: "HEIGHT_AND_WIDTH" })`: the frame top is the top of the capitals, the frame hugs the words, and an alignment on a guide puts the letters on it. `x_height` for lowercase-only labels.
- **Auto-size anchor** (`autosizeReference`) = the side that stays put: left-aligned text `top-left` (`left` / `bottom-left` for a line standing on a rule), centred `top`, right-aligned `top-right`.
- **Body text**: fixed width on the columns (`fit_to_grid`), `autosize: "HEIGHT_ONLY"` when its height follows the text, `firstBaseline: "leading"` so its first line sits on the baseline grid, `columns` / `columnGutter` (or `columnWidth`, `balanceColumns`, `columnRule`) inside one frame.
- **Insets** per side (`insetTop`…) for a frame with a fill or a stroke; a frame with corner effects keeps one inset for all sides (the result says so). A sidebar on another leading gets its own baseline grid (`baselineGrid: "custom"`). Text wrap: `textWrap`, `textWrapOffsets`, `textWrapSide`; `ignoreWrap` on a frame that stays full.

## Fitting type to a position

For display type matched to a mock-up or a reference image:

- Size and spacing go on the text: `create_text_frame` / `edit_text_frame` take `leading`, `tracking` and `horizontalScale` (percent); paragraph and character styles take `horizontalScale` too. `horizontalScale` fits a word to a width with its letters intact; `tracking` spaces them.
- `set_text_frame_options({ id, autosize: "HEIGHT_AND_WIDTH", inset: 0 })` shrinks the frame to its text and keeps its top-left corner.
- `measure_text({ frameId, inkBounds: true })` gives the bounds of the visible glyphs and their offset from the frame: move the frame by the difference between the ink edge and the target edge.

**Done when** the ink bounds of each word sit on their target edges (within 0.5 mm).

## Aligning on the grid

Objects sit on the page's structure: margins, columns, rows, guides, baseline grid.

- `get_page_grid({ page })` lists every reference line with its position (margins, column starts and ends, page and master guides, page centre, bleed; `baseline: true` adds the baseline grid).
- `fit_to_grid({ ids, columns: [3, 6], rows, rowCount })` places objects on columns / rows: `fit: "span"` fills them, `start` / `end` / `center` keeps the size.
- `snap_to_grid({ ids })` brings objects a few mm off onto the nearest lines (left / top edges on column starts, right / bottom edges on column ends); `mode: "center"` puts an object's centre on the nearest centre line; `dryRun: true` first on the client's objects.
- `align_objects` aligns objects to each other, the page or the margins.

**Done when** every object you placed lands on lines `get_page_grid` lists (the tool results name them).

## Placing PDF and Illustrator artwork

`place_graphic`, `place_image` and `place_image_in_shape` take the same three options for a .pdf or .ai file:

- `pdfPage`: the page, or the Illustrator artboard, 1-based (default 1).
- `crop`: `trim` places the artboard; `bleed` places the artboard with its bleed; `pdf` (default) is the crop box, which for an .ai is the artboard and for a PDF exported with bleed usually includes the bleed.
- `position` (with `crop: "bleed"`): `artboard` (default) = `x`, `y`, `width`, `height` describe the artboard, and the bleed hangs outside it; `bleed` = they describe the whole graphic.

A full-page visual with bleed: `place_graphic({ filePath, crop: "bleed", x: 0, y: 0, width: <page width> })` puts the artboard exactly on the page and its bleed onto the document bleed. In a shape, the fit applies to the artboard and the shape cuts the bleed.

An .ai carries no bleed (Illustrator stops its PDF part at the artboard): for a visual that bleeds, place a PDF exported from Illustrator with bleed. The result line prints `pdfPage=… crop=…` and, for `position: "artboard"`, the bleed added per side in mm; check it before moving on.

## Groups and names

Objects are placed absolutely, so a group earns its place only where objects move or align as one. Group these units with `group_objects({ ids, name })`:

- a block: a box with its frame lines, pictogram and text;
- an illustration: the shapes of one drawing or pattern;
- texts aligned together: a kicker, title and intro on one edge, the words of a wordmark.

Single frames, backgrounds and panels stay ungrouped. Name each group by its role, in the PM's language ("Encadré", "Motif", "Bloc titre"); `name_object` names a single object whose role its content does not show ("Masque"). A group takes the stacking level of its topmost member: check `list_page_items` and `render_preview` after grouping.

Adding to a finished group: `move_into_group({ ids, groupId, index | inFrontOf | behind })`. The objects keep their page position; the group keeps its name, opacity, effects and place in the stack, and gets a new id (in the result): use that id from then on. Stacking a single object exactly: `bring_to_front({ id, inFrontOf })` / `send_to_back({ id, behind })`, with a reference in the same group (or both on the page, same layer).

Content inside a shape (a photo collage in a circle, a pattern clipped by a panel): `paste_into({ ids, shapeId, name })`. The objects keep their page position, two or more become one group named `name` (default "Contenu") inside the shape, and the shape must be empty. Every object gets a new id: take the new ids from the result (old → new) for the next steps, and tell the user the clipboard now holds the cut objects. `review_compare` shows them as moved into the shape.

Renaming: `set_layer({ name, newName })`, `set_master({ master, newName, prefix })`, `modify_paragraph_style` / `modify_character_style` / `modify_object_style` / `update_color_swatch` with `newName`.

**Done when** each block, illustration and aligned text set is one named group, and `render_preview` matches the page before grouping.

## Alternate layouts

An alternate layout is another version of the pages in the same document: another format (A5, screen), a variant to compare, a version kept before a big change. Its pages carry their own masters, and its text stays linked to the source unless told otherwise.

- Create: `create_alternate_layout({ name, preset or width/height, from, linkStories, rule })`; `linkStories: false` for an independent version; `rule: "scale"` scales the objects to the new size, `"preserve"` keeps them.
- Address its pages as `"Layout:page"` in every tool; `get_layout_setup` lists the layouts and their page ranges.
- Export one layout: `export_pdf({ layout, pageRange })` / `export_images({ layout })`, `pageRange` counted within the layout.
- Compare: `compare_layouts({ a, b })` (page by page) or `compare_layouts({ pageA, pageB })` gives the pages side by side with numbered zones and a table (place and size in mm and % of the page, text, type size, fonts, styles, colours, images). Show the images, then explain in a few sentences what moved, what changed size, what exists in one version only.
- Delete: `delete_alternate_layout({ name, confirmDestructive: true })`, only when the PM asks.

**Done when** the PM has the comparison images and your explanation, or the exported file of the layout they asked for.
