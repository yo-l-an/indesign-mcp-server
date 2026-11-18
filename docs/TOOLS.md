# Tool reference

Conventions shared by every tool, then each tool with its parameters, then the known limits. For the correction workflow an agent follows, see [GUIDE.md](../GUIDE.md).

## Concepts

### Coordinate system and units
- All positions and sizes are in **millimetres**; font sizes, leading and stroke weights are in **points**; angles in **degrees**.
- **Origin: the top-left corner of the page's trim area.** `x` grows to the right, `y` grows downwards. Every page of a spread has its own origin, so `x: 5` is always 5 mm from that page's left edge (also for the right-hand page of a facing-pages spread).
- **Negative values reach into the bleed** (for a full-bleed background of a document with 3 mm bleed use `x: -3, y: -3, width: page + 6, height: page + 6`).
- Rotation: positive angles turn **counter-clockwise**, as in the InDesign UI. For rotated objects, `x/y/w/h` reported by `list_page_items` describe the bounding box.
- The server switches the active document to millimetres and per-page ruler origin while a tool runs and restores your settings afterwards.

### Addressing objects
Every `create_*` tool and `place_image` returns the object's **id**. Use it with any tool that takes an object (`id`, or `frameId` for text tools). ids are stable: they do not change when objects are added, deleted or reordered. `pageIndex` + `index` (or `frameIndex`) are accepted as a fallback but **shift when the stacking order changes**: index 0 is the *frontmost* object, not the oldest. `list_text_frames` and `list_page_items` show both id and index.

### Text
- In `content`, `\n` makes a **paragraph break** by default. Pass `lineBreak: "forced"` to make every `\n` a forced line break (Shift+Enter), or use `<br>` inside the text for individual forced breaks.
- Local formatting is applied **only for parameters you pass** (plus the documented defaults when no `paragraphStyle` is given), so paragraph styles are never overridden by hidden defaults.
- `create_text_frame`, `edit_text_frame`, `apply_paragraph_style`, `insert_markdown_text` and `get_text_content` report `overflows=true` when the text does not fit its frame.
- `insert_markdown_text` maps Markdown to existing styles: `#`..`######` to paragraph styles `Heading 1`..`Heading 6` (also tried: `Header N`, `HN`, `Ueberschrift N`), `**bold**` to character style `Bold` (or `Strong`, `Fett`), `*italic*` to `Italic` (or `Emphasis`, `Kursiv`), `***both***` to `Bold Italic`. Normal paragraphs get `bodyStyle` if given. Override any name with `styleMap`. If a needed style is missing the tool fails with a list of the missing styles and changes nothing. Each non-blank line is one paragraph; lists, links and tables are not interpreted.

### Colour
New swatches default to **CMYK** (0-100). `hex` or RGB values are converted to CMYK in print documents **with InDesign's own colour management** (sRGB to the CMYK profile of the document, e.g. PSO Coated v3), so hues stay where they should; use `keepRgb: true` to keep RGB, or `conversion: "simple"` for the profile-free formula, which shifts hues (greens toward blue). `convert_rgb_to_cmyk` shows the converted values and tells you when a colour is outside the print gamut and how it will really look. SVG artwork is converted through the same profile at output. Presets: `rich_black`, `overprint_black`. Overprint is a property of objects (`set_object_overprint`), not of swatches.

### Export
- `export_pdf` uses a temporary copy of the chosen PDF preset so that `includeBleed` / `includeSlug` really take effect (InDesign presets otherwise override them). Preset aliases: `Print` / `HighQualityPrint` = `[High Quality Print]`, `Web` / `SmallestFileSize` = `[Smallest File Size]`, `PressQuality`, `PDFX1a`, `PDFX3`, `PDFX4`; any other value is looked up as the exact preset name (your own presets work too). The output folder is created if missing.
- **Page numbers are positions.** In `pageRange` (`export_images`, `export_pdf`) and `pageIndex`, page 1 is the first page of the document, whatever the page *names* are. Custom numbering (starting at 5), sections that restart numbering and repeated page names cannot change the meaning: positions are sent to InDesign as absolute page numbers (`+2`, `+1-+3`). Notations: `all`, `2`, `2-3`, `1,3-5`.
- `export_images` writes `<document>_page<N>.png|jpg` per page (N = the position) at the requested dpi and lists every file it wrote and the pages it exported.
- Writing over an existing file (or into a folder that already holds files) needs `confirmDestructive: true`; a new file does not.

### Files and confirmations
One policy (`lib/policy.js`) checks every file argument before a tool runs: paths are absolute (or `~/...`), inside your home folder, the shared folder or `INDESIGN_ALLOWED_DIRS`, never a system folder, with symlinks resolved. A tool that deletes (`delete_page`, `delete_object`, `delete_color_swatch`, `restore_backup`) always needs `confirmDestructive: true`; a tool that writes files needs it only when the target already exists.

### Saving
- `review_compare` ends a task by saving the reviewed document; its backup (named in the result) is the way back with `restore_backup`. A document with no file yet, or converted from an older InDesign version, stays unsaved and the result asks for a place. `INDESIGN_AUTO_SAVE=0` turns this off.
- `save_document` without `filePath` is a plain save of the active document (or of the one named by `name`). A document that was never saved ("Sans titre-1") is saved into `~/Documents` under its own name (`-2`, `-3`… when taken; `INDESIGN_DEFAULT_SAVE_DIR` changes the folder), and the result gives the path so the user can be told; `close_document({ save: true })` does the same. A converted document still asks for `filePath`.
- `create_document({ filePath })` saves the new document there right away: ask the user where first.
- With `filePath` it is Save As: the same document is renamed and stays open. If the path is the document's own file, it is just a plain save (no confirmation, no failure). Overwriting a *different* existing file needs `confirmDestructive: true`; saving onto the file of another open document is refused. New files need no confirmation.
- "Has a file" is decided from the document's file name, not from `doc.saved`; `list_open_documents`, `get_document_info`, `close_document` and `package_document` use the same test, so they also work for documents that were reopened or have unsaved changes.

## Vector shapes

Shapes are native, editable Bezier paths (not pictures). The quickest way for an agent to describe a curve is SVG path data, scaled from a `viewBox` into a target rectangle in mm:

```javascript
// A green band with a gently curved (S-shaped) top edge across the bottom of an A5 page with 3 mm bleed
create_color_swatch({ name: "Green", colorValues: [85, 10, 100, 20] })
create_path_from_svg({
  d: "M0 8 C40 0 80 14 120 8 S190 0 216 6 L216 50 L0 50 Z",
  viewBox: "0 0 216 50",          // the coordinate system the path data was written in
  x: -3, y: 55, width: 216, height: 48,   // where it goes: mm, negative values reach into the bleed
  fill: "Green", opacity: 85
})
// -> "Path created from SVG data: Polygon id=223 ... points=5 paths=1 closed=true opacity=85"
```

- `create_path` takes anchor points with optional handles (`leftDirection`, `rightDirection`, `pointType`); `edit_path_points` reads and edits them (add, move, delete, set_type, reverse, set_closed), so paths round-trip exactly.
- `create_line` (curves, dashes, arrowheads), `create_polygon` (regular polygons, stars, rounded corners), `convert_shape`, `set_corner_options`, `pathfinder`, `set_object_fill`, `set_object_stroke`, `create_gradient_swatch`, `set_gradient_feather`, `place_image_in_shape`, `duplicate_object`, `align_objects`, `distribute_objects` and `get_object_info` complete the set.
- `set_object_fill` / `set_object_stroke` change an object in place, so its stacking order is kept (no delete and recreate).
- **Colour:** paths use swatches, so CMYK values are exact. **Fallbacks** when a native path cannot express something: `create_cmyk_pdf_shape` (exact CMYK, not editable) and `create_graphic_from_svg` (SVG string; not editable as paths; its RGB colours are converted to CMYK at output through the document profile).
- **Pathfinder semantics:** `union`, `intersect` and `exclude_overlap` combine all shapes; `subtract` keeps the first id and cuts the others out of it; `minus_back` keeps the frontmost shape and cuts the shapes behind it out of it.

## Seeing and measuring

`render_preview` returns a page (or a single object) as an image directly in the tool result, and `view_document` includes a picture of the current page. `measure_text` gives the line count, the text and width (mm) of every line and the overflow state without exporting anything. Forced line breaks (`<br>` or `lineBreak: "forced"`) are real Shift+Enter breaks; `get_text_content` shows them as an arrow.

## Tools

<!-- TOOLS:START -->
_142 tools. Generated from the server's tool schemas by `npm run docs`._

### Workflow, review and backups

#### `get_usage_guide`

Workflow guide: read once per session, before the first change to a document. Five steps (scope, prepare_edit, surgical change, review_compare, close), page names, ids, client files, review output, backups, saving, errors, improvement notes. topic "layout": building a layout (new document kickstart, setup, grids, masters, folios, spreads, text frames, alignment, groups, alternate layouts). topic "manual-settings": settings no tool reaches, with the menu path to give the user.

| Parameter | Type | Description |
|---|---|---|
| `topic` | `workflow` \| `layout` \| `manual-settings` | workflow (default): the correction workflow; layout: building a layout; manual-settings: settings the user changes by hand, with their menu path Default: `"workflow"`. |

#### `prepare_edit`

ONE CALL BEFORE CHANGING A DOCUMENT. For the pages the task touches: (1) backup copy in "InDesign Agent Backups", (2) BEFORE snapshot of those pages only (temp folder), (3) shows the first page in InDesign, (4) returns one line per object of those pages (id, type, position, text excerpt) so you can act without list_page_items. Then make the changes and call review_compare.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as the user names them (page name shown in InDesign, e.g. ["12", "13"]); "+N" = N-th page of the file; [] = page order only (moving, adding, removing pages) |
| `pageIndexes` | number[] | Alternative: 0-based page indexes |
| `allPages` | boolean | Snapshot every page: only for document-wide changes (styles, swatches, global replace) Default: `false`. |
| `reason` *(required)* | string | What the task is, for the backup name, e.g. "correction prix p12" |
| `backup` | boolean | false = no backup (only if the user declined it or one was made for this task already) Default: `true`. |
| `listObjects` | boolean | Return the object list of the pages (off when you already know the ids) Default: `true`. |
| `resolution` | number | Snapshot resolution in dpi (36-150) Default: `96`. |

#### `find_text`

Locate text without reading whole stories: returns each match with page name, pageIndex, text frame id and a short context. Use it when the user quotes text instead of a page, and before a find_replace_text you are not sure about.

| Parameter | Type | Description |
|---|---|---|
| `text` *(required)* | string | Text (or GREP with useGrep) to find |
| `useGrep` | boolean | text is a GREP expression Default: `false`. |
| `caseSensitive` | boolean | Case-sensitive search (plain text) Default: `false`. |
| `pages` | any[] | Pages as the user names them (page name shown in InDesign, e.g. ["12", "13"]); "+N" = N-th page of the file; [] = page order only (moving, adding, removing pages) |
| `pageIndexes` | number[] | Alternative: 0-based page indexes |
| `limit` | number | Maximum matches listed (1-100) Default: `20`. |

#### `review_compare`

AFTER the changes: compares the snapshot pages with the current state. Returns only the changed pages, as BEFORE \| AFTER images with numbered dotted zones (orange modified, green added, red removed; text edits framed on the changed lines) and a side gutter minimap, cropped to the changed area, plus a Markdown change table (# \| Page \| Element \| Property \| Before \| After \| Change). Show both to the user. Then saves the reviewed document, since its backup is the way back (a document with no file yet is left for the user to name; INDESIGN_AUTO_SAVE=0 turns saving off). Can be called again after further corrections (always against the same BEFORE).

| Parameter | Type | Description |
|---|---|---|
| `snapshotId` | string | From prepare_edit (default: the latest of this session) |
| `language` | `fr` \| `en` | Language of image labels and table Default: `"fr"`. |
| `maxImages` | number | Page images returned inline (0-10; all are saved to files). Many changes: lower it and rely on the table Default: `3`. |
| `crop` | boolean | Crop images to the changed area Default: `true`. |
| `sensitivity` | `low` \| `normal` \| `high` | Pixel sensitivity for changes no object explains Default: `"normal"`. |

#### `backup_document`

Extra backup outside prepare_edit (e.g. before a risky step): dated, named copy of the active document in "InDesign Agent Backups" next to the .indd. The open document is not changed. Backups are never deleted by the server.

| Parameter | Type | Description |
|---|---|---|
| `reason` *(required)* | string | Short description, used in the file name |
| `backupDir` | string | Optional: another backup folder (inside the allowed directories) |

#### `list_backups`

Backups of the active document (newest first) with date, reason and path, for restore_backup.

| Parameter | Type | Description |
|---|---|---|
| `backupDir` | string | Optional: another backup folder |

#### `restore_backup`

Go back to a backup, only when the user asks: backs up the current state, closes the document WITHOUT saving, copies the backup over the .indd and reopens it. Needs confirmDestructive: true. The backup is kept.

| Parameter | Type | Description |
|---|---|---|
| `backupPath` *(required)* | string | Backup file name from list_backups (or its full path) |
| `confirmDestructive` | boolean | Must be true: the open document is replaced Default: `false`. |

### Client files (brief and feedback)

#### `read_source_document`

Read a client file (Word .docx, PDF, .doc/.rtf/.odt on macOS, .txt/.md) as Markdown: headings, lists, tables, links, images, comment markers [C1] and tracked changes [+added+] [-removed-]. Long files come in slices: start with outline: true, then read the part you need with offset.

| Parameter | Type | Description |
|---|---|---|
| `path` *(required)* | string | Absolute path of the file |
| `outline` | boolean | Only the outline (headings with their offsets; PDF: pages with their first line) Default: `false`. |
| `offset` | number | Start of the slice (characters, from the outline or the previous slice) Default: `0`. |
| `maxChars` | number | Slice length (1000-60000) Default: `15000`. |
| `pages` | number[] | PDF: page numbers of the PDF file (1-based) to read |

#### `read_feedback`

Client feedback as one numbered table: PDF annotations (notes, highlights, strike-outs, insertions, replacements, drawings, replies and review states) with the text each one points at, or Word comments and tracked changes (before/after). locate: true also finds each item in the active InDesign document (page name + text frame id). Read it before prepare_edit, and ask the project manager about unclear items.

| Parameter | Type | Description |
|---|---|---|
| `path` *(required)* | string | Absolute path of the commented PDF or the Word file |
| `locate` | boolean | Find each item in the active InDesign document Default: `false`. |
| `pages` | number[] | PDF: only these PDF pages (1-based) |
| `author` | string | Only the items of this reviewer (part of the name) |

### Documents

#### `get_document_info`

Information about the active document: size in mm, pages (with page names), facing pages, bleed, slug, margins, colour intent/profiles, object counts. Swatch values only with includeSwatches (or use list_color_swatches).

| Parameter | Type | Description |
|---|---|---|
| `includeSwatches` | boolean | Also list every swatch with its values Default: `false`. |

#### `create_document`

Create a new document (units: mm). Ask the user where to save it first and pass filePath: the document is saved there right away. Presets: A3, A4, A5, Letter, Legal, Custom. For Custom, width/height are in mm; an explicit orientation swaps them if needed (Landscape => width >= height, Portrait => height >= width); without orientation they are used as given.

| Parameter | Type | Description |
|---|---|---|
| `filePath` | string | The .indd file to save the new document to (where the user asked) |
| `preset` | `A3` \| `A4` \| `A5` \| `Letter` \| `Legal` \| `Custom` | Page size preset Default: `"A4"`. |
| `width` | number | Page width in mm (Custom only) |
| `height` | number | Page height in mm (Custom only) |
| `orientation` | `Portrait` \| `Landscape` | Presets default to Portrait. For Custom, only applied when given. |
| `pages` | number | Number of pages Default: `1`. |
| `facingPages` | boolean | Enable facing pages Default: `false`. |
| `bleed` | number | Bleed on all sides in mm Default: `0`. |
| `slug` | number | Slug on all sides in mm Default: `0`. |
| `marginTop` | number | Top margin in mm Default: `20`. |
| `marginBottom` | number | Bottom margin in mm Default: `20`. |
| `marginLeft` | number | Left (inside) margin in mm Default: `20`. |
| `marginRight` | number | Right (outside) margin in mm Default: `20`. |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `open_document`

Open an existing InDesign document

| Parameter | Type | Description |
|---|---|---|
| `filePath` *(required)* | string | Path to the InDesign document (.indd) |

#### `save_document`

Save a document (the active one, or the one named by "name"). Without filePath: a plain save; a document that was never saved ("Sans titre-1") goes to the Documents folder under its own name, and the result says where (tell the user). With filePath: Save As, the same document is renamed and stays open; the document's own file (same path) is just a plain save; overwriting a DIFFERENT existing file needs confirmDestructive. Saving to the file of another open document is refused.

| Parameter | Type | Description |
|---|---|---|
| `filePath` | string | Optional: path of the .indd file to save to (Save As) |
| `name` | string | Name of the document as shown by list_open_documents (default: the active document) |
| `confirmDestructive` | boolean | Required only to overwrite an existing file that is not the document's own file Default: `false`. |

#### `close_document`

Close a document (the active one, or the one named by "name"). Documents with unsaved changes require save=true or confirmDestructive=true.

| Parameter | Type | Description |
|---|---|---|
| `name` | string | Document name as shown by list_open_documents (default: active document) |
| `save` | boolean | Save before closing (a document that was never saved goes to the Documents folder, as with save_document) Default: `false`. |
| `confirmDestructive` | boolean | Required to discard unsaved changes Default: `false`. |

#### `list_open_documents`

List all open documents with name, page count, saved/modified state and which one is active

_No parameters._

#### `activate_document`

Make an open document the active one (by name as shown by list_open_documents)

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Document name |

#### `view_document`

Get visual representation and detailed info about the current document

_No parameters._

#### `zoom_to_page`

Zoom and fit page in view

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` | number | Page index to zoom to |
| `fitOption` | `FIT_PAGE` \| `FIT_SPREAD` \| `ACTUAL_SIZE` |  Default: `"FIT_PAGE"`. |

### Pages

#### `add_page`

Add a new page to the document. width / height (mm) give the new page its own size (see set_page_size).

| Parameter | Type | Description |
|---|---|---|
| `position` | `before` \| `after` \| `end` |  Default: `"end"`. |
| `pageIndex` | number | Reference page index (for before/after) |
| `masterPage` | string | Master page to apply |
| `width` | number | Width of the new page in mm (default: document size) |
| `height` | number | Height of the new page in mm (default: document size) |

#### `delete_page`

Delete a page from the document

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` *(required)* | number | Page index to delete |
| `confirmDestructive` | boolean | Must be true: the page and its content are deleted Default: `false`. |

#### `duplicate_page`

Duplicate a page with all its content (position: before/after the source page, or end of the document)

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` *(required)* | number | Page index to duplicate |
| `position` | `before` \| `after` \| `end` |  Default: `"after"`. |

#### `move_page`

Move a page within the document, by page name as the user says it ("+N" = N-th page): after or before another page, or to the start / end. A page alone in its spread moves with its spread, so objects bleeding off the page go along; facing-page spreads reflow around it.

| Parameter | Type | Description |
|---|---|---|
| `page` *(required)* | string | Page to move (page name, or "+N") |
| `after` | string | Put it after this page |
| `before` | string | Put it before this page |
| `position` | `start` \| `end` | Or: first / last page of the document |

#### `set_page_size`

Give pages their own size (mm), e.g. one page per web section of a different height. The page grows or shrinks from anchor (default top-left); objects keep their place on the page. pageIndexes: the pages (0-based); omit for every page. The document default size is unchanged.

| Parameter | Type | Description |
|---|---|---|
| `pageIndexes` | number[] | Pages to resize (0-based); omit for every page |
| `width` | number | New width in mm (default: unchanged) |
| `height` | number | New height in mm (default: unchanged) |
| `anchor` | `top-left` \| `top` \| `top-right` \| `left` \| `center` \| `right` \| `bottom-left` \| `bottom` \| `bottom-right` | Point of the page that stays in place Default: `"top-left"`. |

#### `navigate_to_page`

Navigate to a specific page

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` *(required)* | number | Page index to navigate to |

### Seeing and measuring

#### `render_preview`

Render one page (or one object) to PNG and return it directly as an image, so you can see the result without exporting to a folder. Options: pageIndex, objectId (renders just that object), resolution in dpi (default 72), includeBleed. The longest side is limited to 4000 px.

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `objectId` | number | Render only this object instead of a page |
| `resolution` | number | Resolution in dpi (10-600) Default: `72`. |
| `includeBleed` | boolean | Include the document bleed (page previews) Default: `false`. |

#### `measure_text`

Measure a text frame without exporting: line count, the text of every line, the width of every line in mm, the frame width and the overflow state. inkBounds: true also gives the bounds of the visible glyphs (outlines of a temporary copy), and their offsets from the frame, to align a word's visible edge or cap height to a position.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost) |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `inkBounds` | boolean | Also report the bounds of the visible glyphs (x, y, w, h in mm) and their offsets from the frame Default: `false`. |

#### `list_page_items`

List all objects on a page (text frames, rectangles, ovals, polygons, lines, groups, image frames) with id, type, geometry in mm, rotation, fill and overflow state. Objects inside groups are listed with their group id.

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `type` | string | Only this type: TextFrame, Rectangle, Oval, Polygon, GraphicLine, Group |

#### `get_object_info`

Full details of an object: type, page, geometry (mm), rotation, fill (swatch, tint, values), stroke, opacity and blend mode, effects, applied object style, layer, name/label, group membership, and the anchor points of paths.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |

### Text frames and content

#### `create_text_frame`

Create a text frame (mm, origin top-left of the page trim). Only parameters you pass are applied as local formatting; defaults (Helvetica Neue 12 pt, Black, left) are used only when no paragraphStyle is given. Returns the frame id and whether the text overflows. In content, "\n" makes a paragraph break unless lineBreak is "forced"; "<br>" always makes a forced line break (Shift+Enter).

| Parameter | Type | Description |
|---|---|---|
| `content` *(required)* | string | Text content. "\n" = paragraph break (default), "<br>" = forced line break |
| `lineBreak` | `paragraph` \| `forced` | How "\n" in content is interpreted Default: `"paragraph"`. |
| `x` | number | X position in mm Default: `10`. |
| `y` | number | Y position in mm Default: `10`. |
| `width` | number | Width in mm Default: `100`. |
| `height` | number | Height in mm Default: `50`. |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fontSize` | number | Font size in points (local override) |
| `fontFamily` | string | Font family name (local override) |
| `fontStyle` | string | Font style (Regular, Bold, Italic, ...) used with fontFamily Default: `"Regular"`. |
| `textColor` | string | Swatch name (local override) |
| `alignment` | `LEFT_ALIGN` \| `CENTER_ALIGN` \| `RIGHT_ALIGN` \| `JUSTIFY` | Paragraph alignment (local override) |
| `leading` | number | Leading in points (local override) |
| `tracking` | number | Tracking in 1/1000 em (local override) |
| `horizontalScale` | number | Horizontal scale in percent, 1-1000 (local override; fits a word to a width without letter-spacing it) |
| `paragraphStyle` | string | Paragraph style name to apply (error if missing) |
| `characterStyle` | string | Character style name to apply to all text |

#### `edit_text_frame`

Edit a text frame. Setting content replaces the whole story. Returns whether the text overflows. Use frameId (from create_text_frame / list_text_frames) or pageIndex + frameIndex.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId. |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `content` | string | New text (replaces the whole story). "\n" = paragraph break, "<br>" = forced line break |
| `lineBreak` | `paragraph` \| `forced` | How "\n" in content is interpreted Default: `"paragraph"`. |
| `fontSize` | number | Font size in points |
| `fontFamily` | string | Font family name |
| `fontStyle` | string | Font style used with fontFamily Default: `"Regular"`. |
| `textColor` | string | Swatch name |
| `alignment` | `LEFT_ALIGN` \| `CENTER_ALIGN` \| `RIGHT_ALIGN` \| `JUSTIFY` |  |
| `leading` | number | Leading in points |
| `tracking` | number | Tracking in 1/1000 em |
| `horizontalScale` | number | Horizontal scale in percent, 1-1000 (fits a word to a width without letter-spacing it) |

#### `list_text_frames`

List the text frames on a page: stable id, index, geometry (mm), overflow state and a text preview. Ordering: index 0 is the frontmost frame (stacking order), NOT creation order - indices shift when frames are added or reordered, so use the id.

| Parameter | Type | Description |
|---|---|---|
| `pageIndex` | number | Page index (0-based) Default: `0`. |

#### `get_text_content`

Get the text of a text frame (selection, frameId, or frameIndex). Also reports paragraph count and overflow state.

| Parameter | Type | Description |
|---|---|---|
| `normalizeSpaces` | boolean | Collapse line breaks and repeated spaces Default: `true`. |
| `frameId` | number | Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId. |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `maxLength` | number | Truncate output to this many characters (0 = no limit) Default: `0`. |

#### `insert_markdown_text`

Insert Markdown into a text frame, mapped to EXISTING styles. Each non-blank line is one paragraph. Supported: "# " to "###### " headers -> paragraph styles "Heading 1".."Heading 6" (aliases tried: "Header N", "HN", "Ueberschrift N"); **bold** -> character style "Bold" (alias "Strong"); *italic* -> "Italic" (alias "Emphasis"); ***both*** -> both styles. Plain paragraphs keep the frame formatting unless bodyStyle is given. Override any style name with styleMap. Fails with a clear error (and changes nothing) if a required style is missing.

| Parameter | Type | Description |
|---|---|---|
| `markdownText` *(required)* | string | Markdown text to insert |
| `frameId` | number | Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId. |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `useSelectedFrame` | boolean | Use the currently selected text frame Default: `false`. |
| `replaceContent` | boolean | Replace the whole story (true) or append (false) Default: `true`. |
| `bodyStyle` | string | Paragraph style for normal paragraphs (optional) |
| `styleMap` | object | Override style names: { h1..h6, body, bold, italic } (paragraph styles for h1-h6/body, character styles for bold/italic) |

#### `find_replace_text`

Find and replace text. Limit it to where the change belongs: frameId (the story of that frame) or scope story/selection; scope document only for a deliberate global change. Locate first with find_text when unsure. Reports the pages where text was replaced.

| Parameter | Type | Description |
|---|---|---|
| `findText` *(required)* | string | Text to find |
| `replaceText` *(required)* | string | Replacement text |
| `caseSensitive` | boolean | Case sensitive search Default: `false`. |
| `wholeWord` | boolean | Whole word only Default: `false`. |
| `useGrep` | boolean | Use GREP (regular expressions) Default: `false`. |
| `scope` | `document` \| `story` \| `selection` |  Default: `"document"`. |
| `frameId` | number | Only in the story of this text frame (overrides scope) |

#### `get_selected_objects`

Get information about currently selected objects in InDesign. ESSENTIAL for working with user-selected text frames.

_No parameters._

#### `analyze_embedded_objects`

Analyze embedded objects (MathML formulas, graphics, etc.) in selected text frame or specified frame

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Text frame index (optional if frame is selected) |
| `pageIndex` | number | Page index Default: `0`. |
| `maxObjects` | number | Maximum number of objects to analyze Default: `5`. |

### Text formatting and typography

#### `apply_character_style_to_range`

Apply a character style to a character range of a text frame (e.g. bold words inside a paragraph). Give startIndex/endIndex (inclusive, characters within the story) or matchText to style every occurrence of a text.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable id of the text frame. Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost) |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `styleName` *(required)* | string | Character style name |
| `startIndex` | number | First character (0-based) |
| `endIndex` | number | Last character (inclusive) |
| `matchText` | string | Style every occurrence of this text instead of a range |

#### `clear_overrides`

Remove local formatting overrides from a whole text frame or a character range so the paragraph/character styles show through

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable id of the text frame. Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost) |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `startIndex` | number | First character (0-based); omit for the whole frame |
| `endIndex` | number | Last character (inclusive) |

#### `fix_typography_in_selection`

Fix typography in selected text or story. Corrects dates (DD.MM.YYYY with thin spaces), quotes, dashes, and other typographic elements.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Text frame index to fix (use get_selected_objects to work with selection) |
| `pageIndex` | number | Page index Default: `0`. |
| `useSelectedFrame` | boolean | Use currently selected text frame Default: `false`. |
| `fixDates` | boolean | Fix date spacing (DD. MM. YYYY) Default: `true`. |
| `fixQuotes` | boolean | Fix quotes to typographic quotes Default: `true`. |
| `fixDashes` | boolean | Fix hyphens to em/en dashes Default: `true`. |
| `fixSpaces` | boolean | Fix multiple spaces and trailing spaces Default: `true`. |

#### `find_typography_issues`

Analyze text for common typography issues (wrong spaces in dates, straight quotes, double spaces, etc.)

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Text frame index to analyze |
| `pageIndex` | number | Page index Default: `0`. |
| `useSelectedFrame` | boolean | Analyze currently selected text frame Default: `false`. |

#### `clean_imported_text`

Clean imported text from common typography sins: double paragraph breaks, line breaks instead of paragraphs, trailing spaces, hyphens instead of dashes, manual formatting, bullet lists, hardcoded chapter numbers, etc.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Text frame index to clean |
| `pageIndex` | number | Page index Default: `0`. |
| `useSelectedFrame` | boolean | Clean currently selected text frame Default: `false`. |
| `fixParagraphs` | boolean | Fix double paragraph breaks and line breaks Default: `true`. |
| `fixDashes` | boolean | Fix hyphens to proper n-dashes for ranges/thoughts Default: `true`. |
| `fixLists` | boolean | Remove manual bullet lists and dashes Default: `true`. |
| `fixFormatting` | boolean | Remove manual bold/italic (prepare for character styles) Default: `true`. |
| `fixChapterNumbers` | boolean | Remove hardcoded chapter numbers Default: `true`. |
| `fixSpaces` | boolean | Remove trailing spaces and multiple spaces Default: `true`. |

#### `analyze_text_problems`

Analyze imported text for common problems before cleaning. Shows what issues exist.

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | Stable object id of the text frame (preferred over frameIndex) |
| `frameIndex` | number | Text frame index to analyze |
| `pageIndex` | number | Page index Default: `0`. |
| `useSelectedFrame` | boolean | Analyze currently selected text frame Default: `false`. |

#### `list_grep_searches`

List all saved GREP searches in the document (like DATUM search for dates)

_No parameters._

#### `list_fonts`

List installed font families with their styles (use them for fontFamily / fontStyle). Filter with search (substring of the family name) or family (exact name); limit caps the number of families shown.

| Parameter | Type | Description |
|---|---|---|
| `search` | string | Case-insensitive substring of the family name |
| `family` | string | Exact family name: list only its styles |
| `limit` | number | Maximum number of families (1-1000) Default: `60`. |

### Styles

#### `create_paragraph_style`

Create a paragraph style. Returns the font that was actually applied.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Style name |
| `baseStyle` | string | Base style to inherit from |
| `fontFamily` | string | Font family (error if not installed) |
| `fontStyle` | string | Font style: Regular, Medium, Bold, Italic, ... |
| `fontSize` | number | Font size in points |
| `leading` | number | Leading in points |
| `tracking` | number | Tracking in 1/1000 em |
| `horizontalScale` | number | Horizontal scale in percent (1-1000, 100 = normal): narrows or widens the glyphs |
| `kerning` | `Metrics` \| `Optical` | Kerning method |
| `spaceBefore` | number | Space before in mm |
| `spaceBeforePt` | number | Space before in points (alternative to spaceBefore) |
| `spaceAfter` | number | Space after in mm |
| `spaceAfterPt` | number | Space after in points (alternative to spaceAfter) |
| `firstLineIndent` | number | First-line indent in mm |
| `leftIndent` | number | Left indent in mm |
| `rightIndent` | number | Right indent in mm |
| `alignment` | `LEFT_ALIGN` \| `CENTER_ALIGN` \| `RIGHT_ALIGN` \| `JUSTIFY` \| `LEFT_JUSTIFIED` \| `CENTER_JUSTIFIED` \| `RIGHT_JUSTIFIED` \| `FULLY_JUSTIFIED` |  |
| `hyphenation` | boolean | Enable hyphenation |
| `keepWithNext` | number | Keep with next N lines (0 = off) |
| `keepLinesTogether` | boolean | Keep lines together |
| `keepFirstLines` | number | Keep first N lines together |
| `keepLastLines` | number | Keep last N lines together |
| `keepWithPrevious` | boolean | Keep with previous paragraph |
| `composer` | `paragraph` \| `single-line` | Composer: "paragraph" = Adobe Paragraph Composer (default look), "single-line" = Adobe Single-line Composer |
| `capitalization` | `normal` \| `small_caps` \| `all_caps` \| `cap_to_small_cap` \| `lower_case` | Capitalisation |
| `ligatures` | boolean | Standard ligatures on/off |
| `openType` | object | OpenType features: booleans discretionaryLigatures, contextualAlternates, swash, titling, fractions, ordinals, slashedZero, historical; figureStyle (default, tabular_lining, proportional_oldstyle, proportional_lining, tabular_oldstyle); stylisticSets (bit mask number) |
| `hyphenateWordsLongerThan` | number | Hyphenation: minimum word length |
| `hyphenateAfterFirst` | number | Hyphenation: minimum letters before the hyphen |
| `hyphenateBeforeLast` | number | Hyphenation: minimum letters after the hyphen |
| `hyphenateLadderLimit` | number | Hyphenation: maximum consecutive hyphenated lines |
| `hyphenateCapitalizedWords` | boolean | Hyphenation: hyphenate capitalised words |
| `hyphenateLastWord` | boolean | Hyphenation: hyphenate the last word of a paragraph |
| `textColor` | string | Swatch name |

#### `modify_paragraph_style`

Modify a paragraph style (same properties as create_paragraph_style). Returns the font that was actually applied.

| Parameter | Type | Description |
|---|---|---|
| `styleName` | string | Paragraph style name to modify |
| `name` | string | Same as styleName (either one) |
| `newName` | string | Rename the style |
| `baseStyle` | string | New base style |
| `fontFamily` | string | Font family (error if not installed) |
| `fontStyle` | string | Font style: Regular, Medium, Bold, Italic, ... |
| `fontSize` | number | Font size in points |
| `leading` | number | Leading in points |
| `tracking` | number | Tracking in 1/1000 em |
| `horizontalScale` | number | Horizontal scale in percent (1-1000, 100 = normal): narrows or widens the glyphs |
| `kerning` | `Metrics` \| `Optical` | Kerning method |
| `spaceBefore` | number | Space before in mm |
| `spaceBeforePt` | number | Space before in points |
| `spaceAfter` | number | Space after in mm |
| `spaceAfterPt` | number | Space after in points |
| `firstLineIndent` | number | First-line indent in mm |
| `leftIndent` | number | Left indent in mm |
| `rightIndent` | number | Right indent in mm |
| `alignment` | `LEFT_ALIGN` \| `CENTER_ALIGN` \| `RIGHT_ALIGN` \| `JUSTIFY` \| `LEFT_JUSTIFIED` \| `CENTER_JUSTIFIED` \| `RIGHT_JUSTIFIED` \| `FULLY_JUSTIFIED` |  |
| `hyphenation` | boolean | Enable hyphenation |
| `keepWithNext` | number | Keep with next N lines (0 = off) |
| `keepLinesTogether` | boolean | Keep lines together |
| `keepFirstLines` | number | Keep first N lines together |
| `keepLastLines` | number | Keep last N lines together |
| `keepWithPrevious` | boolean | Keep with previous paragraph |
| `composer` | `paragraph` \| `single-line` | Composer: "paragraph" = Adobe Paragraph Composer (default look), "single-line" = Adobe Single-line Composer |
| `capitalization` | `normal` \| `small_caps` \| `all_caps` \| `cap_to_small_cap` \| `lower_case` | Capitalisation |
| `ligatures` | boolean | Standard ligatures on/off |
| `openType` | object | OpenType features: booleans discretionaryLigatures, contextualAlternates, swash, titling, fractions, ordinals, slashedZero, historical; figureStyle (default, tabular_lining, proportional_oldstyle, proportional_lining, tabular_oldstyle); stylisticSets (bit mask number) |
| `hyphenateWordsLongerThan` | number | Hyphenation: minimum word length |
| `hyphenateAfterFirst` | number | Hyphenation: minimum letters before the hyphen |
| `hyphenateBeforeLast` | number | Hyphenation: minimum letters after the hyphen |
| `hyphenateLadderLimit` | number | Hyphenation: maximum consecutive hyphenated lines |
| `hyphenateCapitalizedWords` | boolean | Hyphenation: hyphenate capitalised words |
| `hyphenateLastWord` | boolean | Hyphenation: hyphenate the last word of a paragraph |
| `textColor` | string | Swatch name |

#### `apply_paragraph_style`

Apply a paragraph style to a text frame (or a character range of it)

| Parameter | Type | Description |
|---|---|---|
| `styleName` *(required)* | string | Paragraph style name |
| `frameId` | number | Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex. |
| `frameIndex` | number | Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId. |
| `pageIndex` | number | Page index (0-based), used with frameIndex Default: `0`. |
| `startIndex` | number | Start character index (optional) |
| `endIndex` | number | End character index (optional) |

#### `create_character_style`

Create a new character style

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Style name |
| `fontFamily` | string | Font family |
| `fontStyle` | string | Font style (Regular, Bold, Italic) |
| `fontSize` | number | Font size in points |
| `textColor` | string | Text color |
| `tracking` | number | Character tracking |
| `horizontalScale` | number | Horizontal scale in percent (1-1000, 100 = normal) |
| `baseStyle` | string | Base style to inherit from |

#### `modify_character_style`

Modify properties of an existing character style

| Parameter | Type | Description |
|---|---|---|
| `styleName` | string | Character style name to modify |
| `name` | string | Same as styleName (either one) |
| `newName` | string | Rename the style |
| `fontFamily` | string | Font family |
| `fontStyle` | string | Font style (Regular, Bold, Italic) |
| `fontSize` | number | Font size in points |
| `textColor` | string | Text color (swatch name) |
| `tracking` | number | Character tracking |
| `horizontalScale` | number | Horizontal scale in percent (1-1000, 100 = normal) |

#### `create_object_style`

Create a new object style

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Style name |
| `fillColor` | string | Fill color (swatch name) |
| `strokeColor` | string | Stroke color (swatch name) |
| `strokeWidth` | number | Stroke width in points |
| `transparency` | number | Transparency percentage (0-100) |
| `baseStyle` | string | Base style to inherit from |

#### `modify_object_style`

Modify properties of an existing object style

| Parameter | Type | Description |
|---|---|---|
| `styleName` | string | Object style name to modify |
| `name` | string | Same as styleName (either one) |
| `newName` | string | Rename the style |
| `fillColor` | string | Fill color (swatch name) |
| `strokeColor` | string | Stroke color (swatch name) |
| `strokeWidth` | number | Stroke width in points |
| `transparency` | number | Transparency percentage (0-100) |

#### `apply_object_style`

Apply an object style to an object (objectId, or pageIndex + objectIndex) or, if none is given, to the current selection

| Parameter | Type | Description |
|---|---|---|
| `styleName` *(required)* | string | Object style name |
| `objectId` | number | Stable object id (preferred) |
| `objectIndex` | number | Index in list_page_items for that page (optional if objects are selected) |
| `pageIndex` | number | Page index Default: `0`. |

#### `list_styles`

List all available styles in the document

| Parameter | Type | Description |
|---|---|---|
| `styleType` | `paragraph` \| `character` \| `object` \| `all` |  Default: `"all"`. |

### Vector shapes and paths

#### `create_path`

Create an editable open or closed Bezier path from anchor points. Each point: x, y (mm) and optionally leftDirection / rightDirection (handle positions, same coordinate system) and pointType. Returns the object id and the resulting points. Example (S-curve band): points [{x:0,y:8,rightDirection:{x:40,y:0}}, {x:120,y:8,leftDirection:{x:80,y:14},rightDirection:{x:160,y:2}}, ...], closed true.

| Parameter | Type | Description |
|---|---|---|
| `points` *(required)* | object[] | At least 2 anchor points |
| `closed` | boolean | Close the path Default: `false`. |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fill` | string | Fill swatch name, or "none" |
| `stroke` | string | Stroke swatch name, or "none" |
| `strokeWeight` | number | Stroke weight in points |
| `opacity` | number | Object opacity in percent (0-100) |
| `name` | string | Object name (shown in the Layers panel) |
| `label` | string | Script label (shown by list_page_items) |

#### `create_path_from_svg`

Create native, editable path(s) from SVG path data (commands M m L l H h V v C c S s Q q T t A a Z z; quadratics and arcs become cubic Beziers). The data is scaled from viewBox (default: the path bounds) into the target rectangle x, y, width, height (mm); one dimension only keeps the aspect ratio. Several sub-paths become one compound path. Example: d "M0 8 C40 0 80 14 120 8 S190 0 216 6 L216 50 L0 50 Z", viewBox "0 0 216 50", x -3, y 55, width 216, height 48.

| Parameter | Type | Description |
|---|---|---|
| `d` *(required)* | string | SVG path data |
| `viewBox` | string | SVG viewBox "minX minY width height" the data was drawn in (default: bounds of the path) |
| `x` | number | Target left edge in mm Default: `0`. |
| `y` | number | Target top edge in mm Default: `0`. |
| `width` | number | Target width in mm |
| `height` | number | Target height in mm |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fill` | string | Fill swatch name, or "none" |
| `stroke` | string | Stroke swatch name, or "none" |
| `strokeWeight` | number | Stroke weight in points |
| `opacity` | number | Object opacity in percent (0-100) |
| `name` | string | Object name (shown in the Layers panel) |
| `label` | string | Script label (shown by list_page_items) |

#### `edit_path_points`

Read or edit the anchor points and handles of an existing path (any rectangle, oval, polygon or line). action: read \| add \| move \| delete \| set_type \| reverse \| set_closed. Coordinates are mm (same system as create_path). Moving an anchor moves its handles with it unless moveHandles is false.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `action` | `read` \| `add` \| `move` \| `delete` \| `set_type` \| `reverse` \| `set_closed` |  Default: `"read"`. |
| `pathIndex` | number | Sub-path of a compound path (0-based) Default: `0`. |
| `pointIndex` | number | Point to move / delete / retype; for add: insert before this index (default: append) |
| `point` | object | add: the new point { x, y, leftDirection?, rightDirection?, pointType? } |
| `x` | number | move: new anchor x in mm |
| `y` | number | move: new anchor y in mm |
| `leftDirection` | object | move: new absolute position of the left handle |
| `rightDirection` | object | move: new absolute position of the right handle |
| `moveHandles` | boolean | move: translate the handles together with the anchor Default: `true`. |
| `pointType` | `corner` \| `smooth` \| `symmetrical` \| `plain` \| `auto` | set_type: new point type |
| `closed` | boolean | set_closed: true closes, false opens the path |

#### `create_line`

Create a straight or curved line between two points (mm). Curve: give controlPoint1 and/or controlPoint2 (Bezier handles). Options: weight (pt), stroke swatch, dash (solid, a stroke style name, or [dash, gap, ...] in pt), endCap, arrowheads (none, simple, simple-wide, triangle, triangle-wide, barbed, curved, circle, circle-solid, square, square-solid, bar).

| Parameter | Type | Description |
|---|---|---|
| `x1` *(required)* | number | Start x in mm |
| `y1` *(required)* | number | Start y in mm |
| `x2` *(required)* | number | End x in mm |
| `y2` *(required)* | number | End y in mm |
| `controlPoint1` | object | Curve: handle leaving the start point |
| `controlPoint2` | object | Curve: handle arriving at the end point |
| `weight` | number | Stroke weight in points |
| `stroke` | string | Stroke swatch name |
| `dash` | number[] | Custom dash/gap lengths in pt, e.g. [6, 3]. Use dashStyle for a named style or solid. |
| `dashStyle` | string | "solid" or the name of a stroke style (e.g. Dotted, Dashed) |
| `endCap` | `butt` \| `round` \| `projecting` |  |
| `arrowStart` | `none` \| `simple` \| `simple-wide` \| `triangle` \| `triangle-wide` \| `barbed` \| `curved` \| `circle` \| `circle-solid` \| `square` \| `square-solid` \| `bar` | Arrowhead at the start |
| `arrowEnd` | `none` \| `simple` \| `simple-wide` \| `triangle` \| `triangle-wide` \| `barbed` \| `curved` \| `circle` \| `circle-solid` \| `square` \| `square-solid` \| `bar` | Arrowhead at the end |
| `opacity` | number | Opacity in percent (0-100) |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `name` | string | Object name (shown in the Layers panel) |
| `label` | string | Script label (shown by list_page_items) |

#### `create_polygon`

Create a regular polygon or a star as an editable path. x, y is the centre and radius the outer radius (mm). innerRadiusRatio (0-1) makes a star; cornerRadius (mm) rounds the corners; rotation in degrees (0 = first corner points up).

| Parameter | Type | Description |
|---|---|---|
| `x` *(required)* | number | Centre x in mm |
| `y` *(required)* | number | Centre y in mm |
| `radius` *(required)* | number | Outer radius in mm |
| `sides` | number | Number of sides (3-100) or star points Default: `5`. |
| `innerRadiusRatio` | number | Star: inner radius / outer radius (0-1) |
| `cornerRadius` | number | Round corners with this radius in mm Default: `0`. |
| `rotation` | number | Rotation in degrees Default: `0`. |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fill` | string | Fill swatch name, or "none" |
| `stroke` | string | Stroke swatch name, or "none" |
| `strokeWeight` | number | Stroke weight in points |
| `opacity` | number | Object opacity in percent (0-100) |
| `name` | string | Object name (shown in the Layers panel) |
| `label` | string | Script label (shown by list_page_items) |

#### `convert_shape`

Convert a shape with InDesign's Convert Shape: to rectangle, rounded_rectangle, beveled_rectangle, inverse_rounded_rectangle, oval, triangle, polygon (sides, insetPercent, cornerRadius), line, straight_line, open_path or closed_path. Every shape (rectangle, oval, polygon) is an editable path: use edit_path_points to change its points.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `to` *(required)* | `rectangle` \| `rounded_rectangle` \| `beveled_rectangle` \| `inverse_rounded_rectangle` \| `oval` \| `triangle` \| `polygon` \| `line` \| `straight_line` \| `open_path` \| `closed_path` |  |
| `sides` | number | polygon: number of sides |
| `insetPercent` | number | polygon: star inset in percent |
| `cornerRadius` | number | polygon / rounded shapes: corner radius in mm |

#### `set_corner_options`

Set corner effects and radius (mm): option none \| rounded \| inverse_rounded \| inset \| bevel \| fancy, for all corners or per corner (corners: { top_left: { option, radius }, ... }).

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `option` | `none` \| `rounded` \| `inverse_rounded` \| `inset` \| `bevel` \| `fancy` | Effect for all corners (unless corners is given) |
| `radius` | number | Radius in mm for all corners |
| `corners` | object | Per corner settings; keys top_left, top_right, bottom_left, bottom_right; each { option?, radius? } |

#### `pathfinder`

Pathfinder on a list of object ids; returns the id of the result. union / intersect / exclude_overlap combine all shapes. subtract: the FIRST id is kept and all other shapes are cut out of it. minus_back: the frontmost shape is kept and all shapes behind it are cut out. The source objects are consumed.

| Parameter | Type | Description |
|---|---|---|
| `operation` *(required)* | `union` \| `subtract` \| `intersect` \| `exclude_overlap` \| `minus_back` |  |
| `ids` *(required)* | number[] | Ids of the shapes (at least 2, on the same page) |

### Fill, stroke and gradients

#### `set_object_fill`

Change the fill of any existing object (rectangle, oval, path, text frame) in place, so the stacking order is kept. swatch (name or "none"), tint (0-100), opacity of the fill (0-100), or a gradient (name of a gradient swatch) with gradientAngle.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `ids` | number[] | Alternative to id: change several objects at once |
| `swatch` | string | Fill swatch name, or "none" |
| `tint` | number | Fill tint in percent (0-100) |
| `opacity` | number | Fill opacity in percent (0-100) |
| `gradient` | string | Name of a gradient swatch (see create_gradient_swatch) |
| `gradientAngle` | number | Gradient angle in degrees |

#### `set_object_stroke`

Change the stroke of any existing object in place: swatch (name or "none"), weight (pt), tint, dash (custom [dash, gap, ...] pt, or dashStyle "solid" / a stroke style name), alignment (center, inside, outside), join (miter, round, bevel), miterLimit, cap (butt, round, projecting), opacity of the stroke (0-100).

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `ids` | number[] | Alternative to id: change several objects at once |
| `swatch` | string | Stroke swatch name, or "none" |
| `weight` | number | Stroke weight in points |
| `tint` | number | Stroke tint in percent (0-100) |
| `dash` | number[] | Custom dash/gap lengths in pt, e.g. [6, 3] |
| `dashStyle` | string | "solid" or the name of a stroke style |
| `alignment` | `center` \| `inside` \| `outside` |  |
| `join` | `miter` \| `round` \| `bevel` |  |
| `miterLimit` | number | Miter limit (1-500) |
| `cap` | `butt` \| `round` \| `projecting` |  |
| `opacity` | number | Stroke opacity in percent (0-100) |

#### `create_gradient_swatch`

Create a linear or radial gradient swatch from colour stops. stops: [{ swatch, position (0-100), midpoint? (13-87, between this and the previous stop) }]; the first stop must be at 0 and the last at 100. Apply it with set_object_fill (gradient, gradientAngle).

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Gradient name |
| `type` | `linear` \| `radial` |  Default: `"linear"`. |
| `stops` *(required)* | object[] | At least 2 stops |

#### `set_gradient_feather`

Fade an object out with a gradient feather (opacity gradient): type linear/radial, angle, startOpacity (default 100) and endOpacity (default 0). remove: true switches it off.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `type` | `linear` \| `radial` |  Default: `"linear"`. |
| `angle` | number | Angle in degrees Default: `90`. |
| `startOpacity` | number | Opacity at the start (0-100) Default: `100`. |
| `endOpacity` | number | Opacity at the end (0-100) Default: `0`. |
| `remove` | boolean | Remove the gradient feather Default: `false`. |

#### `set_object_opacity`

Set opacity (0-100) and/or blend mode of an object, its fill or its stroke (e.g. semi-transparent colour bands).

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `opacity` | number | Opacity in percent (0-100) |
| `blendMode` | string | BlendMode name: NORMAL, MULTIPLY, SCREEN, OVERLAY, SOFT_LIGHT, HARD_LIGHT, COLOR_DODGE, COLOR_BURN, DARKEN, LIGHTEN, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY |
| `target` | `object` \| `fill` \| `stroke` | What the setting applies to Default: `"object"`. |

#### `set_object_overprint`

Set overprint for the fill and/or stroke of an object (print production)

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `fill` | boolean | Overprint fill |
| `stroke` | boolean | Overprint stroke |

### Objects and layout

#### `create_rectangle`

Create a rectangle shape

| Parameter | Type | Description |
|---|---|---|
| `x` *(required)* | number | X position in mm |
| `y` *(required)* | number | Y position in mm |
| `width` *(required)* | number | Width in mm |
| `height` *(required)* | number | Height in mm |
| `pageIndex` | number | Page index Default: `0`. |
| `fillColor` | string | Fill color (RGB hex or swatch name) |
| `strokeColor` | string | Stroke color |
| `strokeWidth` | number | Stroke width in points Default: `1`. |
| `cornerRadius` | number | Corner radius in mm Default: `0`. |

#### `create_ellipse`

Create an ellipse shape

| Parameter | Type | Description |
|---|---|---|
| `x` *(required)* | number | X position in mm |
| `y` *(required)* | number | Y position in mm |
| `width` *(required)* | number | Width in mm |
| `height` *(required)* | number | Height in mm |
| `pageIndex` | number | Page index Default: `0`. |
| `fillColor` | string | Fill color |
| `strokeColor` | string | Stroke color |
| `strokeWidth` | number | Stroke width in points Default: `1`. |

#### `set_object_geometry`

Move and/or resize an object (x, y, width, height in mm, top-left of the unrotated frame); optionally set absolute rotation and shear (degrees). Omitted values are kept. Rotation is applied about the object centre.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `x` | number | Left edge in mm |
| `y` | number | Top edge in mm |
| `width` | number | Width in mm |
| `height` | number | Height in mm |
| `rotation` | number | Absolute rotation in degrees (counter-clockwise positive) |
| `shear` | number | Absolute shear angle in degrees |

#### `rotate_object`

Rotate an object. Positive angles turn counter-clockwise (as in the InDesign UI). By default the angle is added to the current rotation; with absolute=true it sets the rotation. reference chooses the pivot point.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `angle` *(required)* | number | Degrees, counter-clockwise positive |
| `absolute` | boolean | Set the rotation instead of adding to it Default: `false`. |
| `reference` | `center` \| `top-left` \| `top` \| `top-right` \| `left` \| `right` \| `bottom-left` \| `bottom` \| `bottom-right` | Pivot point Default: `"center"`. |

#### `delete_object`

Delete a text frame, rectangle, ellipse, image frame or group

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `duplicate_object`

Duplicate an object (count copies, each moved by offsetX / offsetY mm relative to the previous one, optionally onto another page). Returns the ids of the copies.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (returned by every create_* tool, place_image and list_page_items) |
| `pageIndex` | number | Page index (0-based); only used with index |
| `index` | number | Position in list_page_items for that page (shifts when objects are added or reordered) |
| `count` | number | Number of copies (1-100) Default: `1`. |
| `offsetX` | number | Horizontal offset in mm between copies Default: `0`. |
| `offsetY` | number | Vertical offset in mm between copies Default: `0`. |
| `toPageIndex` | number | Put the copies on this page (0-based) |

#### `move_to_page`

Move an object (by id) to another page, by page name ("+N" = N-th page). It keeps its position on the page unless x / y (mm) are given.

| Parameter | Type | Description |
|---|---|---|
| `id` *(required)* | number | Object id |
| `page` *(required)* | string | Destination page (page name, or "+N") |
| `x` | number | New left edge in mm (default: unchanged) |
| `y` | number | New top edge in mm (default: unchanged) |

#### `send_to_back`

Send an object to the back of the stacking order

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |

#### `bring_to_front`

Bring an object to the front of the stacking order

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |

#### `send_backward`

Move an object one step back in the stacking order

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |

#### `bring_forward`

Move an object one step forward in the stacking order

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |

#### `group_objects`

Group objects (by id) and return the group id. name: what the group is ("Pattern strip", "Info box"), shown in the Layers panel and by list_page_items. The objects must be on the same spread.

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Ids of the objects to group (at least 2) |
| `name` | string | Name of the group: what it is on the page |

#### `ungroup`

Ungroup a group; returns the ids of the released objects

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |

#### `name_object`

Name an object (any page item, group included) by what it is on the page ("Background", "Headline"): the name shows in the Layers panel, list_page_items and review tables.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `name` *(required)* | string | New name ("" removes it) |

#### `align_objects`

Align objects by id. alignment: left, right, top, bottom, horizontal_center, vertical_center. relativeTo: selection (bounds of the objects), page, margins, spread, bleed, key_object (with keyObjectId).

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Object ids |
| `alignment` *(required)* | `left` \| `right` \| `top` \| `bottom` \| `horizontal_center` \| `vertical_center` |  |
| `relativeTo` | `selection` \| `page` \| `margins` \| `spread` \| `bleed` \| `key_object` |  Default: `"selection"`. |
| `keyObjectId` | number | relativeTo key_object: the object that stays where it is |

#### `distribute_objects`

Distribute objects by id. distribution: left_edges, horizontal_centers, right_edges, top_edges, vertical_centers, bottom_edges, horizontal_space, vertical_space. With spacing (mm) the gaps are fixed (horizontal_space / vertical_space).

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Object ids (at least 3 for a useful result) |
| `distribution` *(required)* | `left_edges` \| `horizontal_centers` \| `right_edges` \| `top_edges` \| `vertical_centers` \| `bottom_edges` \| `horizontal_space` \| `vertical_space` |  |
| `spacing` | number | Fixed gap in mm (horizontal_space / vertical_space) |
| `relativeTo` | `selection` \| `page` \| `margins` \| `spread` \| `bleed` |  Default: `"selection"`. |

#### `set_text_frame_options`

Text frame options (Object > Text Frame Options): insets per side, first baseline (cap height for titles and small text, so the frame top is the top of the capitals), vertical alignment, columns (fixed or flexible width, balanced, column rule), auto-size (with its anchor point and no line breaks), its own baseline grid, ignore text wrap; and text wrap on any object. A frame with rounded or fancy corners keeps one inset for all four sides.

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Stable object id (from create_* tools, place_image or list_page_items). Preferred. |
| `pageIndex` | number | Page index (0-based); used with index Default: `0`. |
| `index` | number | Position in list_page_items for that page (changes when objects are added/reordered) |
| `inset` | number | Inset on all sides in mm |
| `insetTop` | number | Top inset in mm |
| `insetLeft` | number | Left inset in mm |
| `insetBottom` | number | Bottom inset in mm |
| `insetRight` | number | Right inset in mm |
| `firstBaseline` | `cap_height` \| `x_height` \| `ascent` \| `leading` \| `em_box` \| `fixed` | Where the first line sits: cap_height (top of the frame = top of the capitals: titles, labels, aligning text on a grid line), x_height, ascent (default of InDesign), leading (first line on the baseline grid), em_box, fixed (= firstBaselineMin) |
| `firstBaselineMin` | number | Minimum first-baseline offset in mm (the offset itself with firstBaseline: fixed) |
| `verticalAlignment` | `TOP` \| `CENTER` \| `BOTTOM` \| `JUSTIFY` | Vertical alignment of the text in the frame |
| `columns` | number | Number of columns |
| `columnGutter` | number | Column gutter in mm |
| `columnWidth` | number | Fixed column width in mm (the frame width follows the columns) |
| `columnMaxWidth` | number | Flexible columns: maximum column width in mm (columns are added as the frame widens); 0 turns it off |
| `balanceColumns` | boolean | Balance the text across the columns |
| `columnRule` | boolean | A vertical rule between columns |
| `columnRuleWeight` | number | Column rule weight in pt |
| `columnRuleColor` | string | Column rule swatch |
| `autosize` | `OFF` \| `HEIGHT_ONLY` \| `WIDTH_ONLY` \| `HEIGHT_AND_WIDTH` \| `HEIGHT_AND_WIDTH_PROPORTIONALLY` | Auto-sizing type. With a width (WIDTH_ONLY, HEIGHT_AND_WIDTH…) "no line breaks" is turned on, or the text would wrap word by word |
| `autosizeReference` | `top-left` \| `top` \| `top-right` \| `left` \| `center` \| `right` \| `bottom-left` \| `bottom` \| `bottom-right` | Point that stays in place when auto-size resizes the frame: match the alignment (left-aligned text: top-left or left; centred: top or center; right-aligned: top-right or right; text standing on a line: bottom-…). Default: top-left |
| `autosizeMinHeight` | number | Auto-size never makes the frame shorter than this (mm); 0 turns it off |
| `autosizeMinWidth` | number | Auto-size never makes the frame narrower than this (mm); 0 turns it off |
| `noLineBreaks` | boolean | Auto-size grows the width instead of breaking lines (on by default when auto-size changes the width) |
| `baselineGrid` | `document` \| `custom` | custom: the frame has its own baseline grid (a sidebar on another leading) |
| `baselineGridIncrement` | number | Own baseline grid: increment in pt |
| `baselineGridStart` | number | Own baseline grid: start in mm |
| `baselineGridRelativeTo` | `inset` \| `frame` \| `margin` \| `page` | Own baseline grid: start measured from the top inset, the frame, the top margin or the page |
| `ignoreWrap` | boolean | Text in this frame ignores the text wrap of other objects |
| `textWrap` | `NONE` \| `BOUNDING_BOX` \| `CONTOUR` \| `JUMP_OBJECT` \| `NEXT_COLUMN` | How text wraps around this object |
| `textWrapOffset` | number | Text wrap offset on all sides in mm |
| `textWrapOffsets` | number[] | Text wrap offsets [top, left, bottom, right] in mm |
| `textWrapSide` | `both` \| `left` \| `right` \| `towards_spine` \| `away_from_spine` \| `largest_area` | Which side the text flows on |

### Images and graphics

#### `place_image`

Place an image into a new frame (mm). Give width and height for a fixed frame, only width or height to keep the aspect ratio, or neither to use the image size. PDF / AI: pdfPage, crop and position as in place_graphic. Returns the frame id.

| Parameter | Type | Description |
|---|---|---|
| `imagePath` *(required)* | string | Path to the image file |
| `x` | number | X position in mm Default: `10`. |
| `y` | number | Y position in mm Default: `10`. |
| `width` | number | Frame width in mm |
| `height` | number | Frame height in mm |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fitOption` | `FILL_PROPORTIONALLY` \| `PROPORTIONALLY` \| `CONTENT_TO_FRAME` \| `FRAME_TO_CONTENT` \| `CENTER_CONTENT` \| `NONE` | How the image fits the frame, with both width and height (otherwise the frame takes the aspect ratio of the graphic and the option is ignored): PROPORTIONALLY = whole graphic inside the frame, empty bands when the ratios differ (logos, charts, nothing may be cut); FILL_PROPORTIONALLY = covers the frame, edges cropped (photos, backgrounds, grid cells); CONTENT_TO_FRAME = stretched to the frame (distorts); FRAME_TO_CONTENT = frame resized to the graphic at 100% (width/height discarded); CENTER_CONTENT = 100%, centred; NONE = 100%, top-left Default: `"PROPORTIONALLY"`. |
| `contentOffsetX` | number | Move the image inside the frame by this many mm (after fitting) |
| `contentOffsetY` | number | Move the image inside the frame by this many mm (after fitting) |
| `contentScale` | number | Scale the image content to this percentage (after fitting) |
| `createFrame` | boolean | Create a frame first (false = place at x,y with its own size) Default: `true`. |
| `pdfPage` | number | PDF / AI: page (Illustrator: artboard) to place, 1-based Default: `1`. |
| `crop` | `pdf` \| `art` \| `trim` \| `bleed` \| `media` \| `content_visible` \| `content_all` | PDF / AI: what to place: pdf (crop box; for an .ai the artboard), trim (the artboard), bleed (artboard + bleed, from a PDF exported with bleed; an .ai has none), art, media, content_visible, content_all Default: `"pdf"`. |
| `position` | `artboard` \| `bleed` | With crop "bleed": artboard (default) = x, y, width, height describe the artboard and the bleed hangs outside (onto the document bleed for a full-page visual; in a shape: the artboard is fitted, the bleed is cut by the shape); bleed = they describe the whole graphic including the bleed |

#### `place_image_in_shape`

Place an image into an existing shape (path, rectangle, oval, polygon) which acts as the mask. fitOption FILL_PROPORTIONALLY (crop to fill, default), PROPORTIONALLY, CONTENT_TO_FRAME, CENTER_CONTENT or NONE; then optional contentOffsetX/Y (mm) and contentScale (%). PDF / AI: pdfPage, crop and position as in place_graphic; with crop bleed the fit applies to the artboard and the bleed hangs outside the shape. Returns the shape id.

| Parameter | Type | Description |
|---|---|---|
| `shapeId` *(required)* | number | Id of the shape that becomes the mask |
| `imagePath` *(required)* | string | Path of the image file |
| `fitOption` | `FILL_PROPORTIONALLY` \| `PROPORTIONALLY` \| `CONTENT_TO_FRAME` \| `CENTER_CONTENT` \| `NONE` | How the image fits the shape: FILL_PROPORTIONALLY = covers the shape, edges cropped (photos); PROPORTIONALLY = whole image inside, empty areas when the ratios differ; CONTENT_TO_FRAME = stretched to the shape bounds (distorts); CENTER_CONTENT = 100%, centred; NONE = 100%, top-left Default: `"FILL_PROPORTIONALLY"`. |
| `contentOffsetX` | number | Move the image inside the shape (mm) |
| `contentOffsetY` | number | Move the image inside the shape (mm) |
| `contentScale` | number | Scale of the image content in percent |
| `pdfPage` | number | PDF / AI: page (Illustrator: artboard) to place, 1-based Default: `1`. |
| `crop` | `pdf` \| `art` \| `trim` \| `bleed` \| `media` \| `content_visible` \| `content_all` | PDF / AI: what to place: pdf (crop box; for an .ai the artboard), trim (the artboard), bleed (artboard + bleed, from a PDF exported with bleed; an .ai has none), art, media, content_visible, content_all Default: `"pdf"`. |
| `position` | `artboard` \| `bleed` | With crop "bleed": artboard (default) = x, y, width, height describe the artboard and the bleed hangs outside (onto the document bleed for a full-page visual; in a shape: the artboard is fitted, the bleed is cut by the shape); bleed = they describe the whole graphic including the bleed |

#### `place_graphic`

Place a vector graphic (.svg, .ai, .eps, .pdf) into a new frame (mm). Give width and height for a fixed frame, only one for the aspect ratio, or neither for the natural size (SVG: taken from the root width/height, unitless and px as 1 px = 1 pt). PDF/AI: pdfPage (default 1, the artboard of an .ai), crop (default pdf; trim = the artboard, bleed = artboard + bleed) and, with crop bleed, position artboard (default: x/y/width/height are the artboard, the bleed hangs outside). Returns the frame id and whether the result is linked; embed: true unlinks and embeds it.

| Parameter | Type | Description |
|---|---|---|
| `filePath` *(required)* | string | Path of the .svg, .ai, .eps or .pdf file |
| `x` | number | X position in mm Default: `10`. |
| `y` | number | Y position in mm Default: `10`. |
| `width` | number | Frame width in mm |
| `height` | number | Frame height in mm |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fitOption` | `PROPORTIONALLY` \| `FILL_PROPORTIONALLY` \| `CONTENT_TO_FRAME` \| `FRAME_TO_CONTENT` \| `CENTER_CONTENT` \| `NONE` | How the graphic fits the frame, with both width and height (otherwise the frame takes the aspect ratio of the graphic and the option is ignored): PROPORTIONALLY = whole graphic inside the frame, empty bands when the ratios differ (logos, charts, nothing may be cut); FILL_PROPORTIONALLY = covers the frame, edges cropped (photos, backgrounds, grid cells); CONTENT_TO_FRAME = stretched to the frame (distorts); FRAME_TO_CONTENT = frame resized to the graphic at 100% (width/height discarded); CENTER_CONTENT = 100%, centred; NONE = 100%, top-left Default: `"PROPORTIONALLY"`. |
| `embed` | boolean | Unlink and embed the graphic in the document Default: `false`. |
| `pdfPage` | number | PDF / AI: page (Illustrator: artboard) to place, 1-based Default: `1`. |
| `crop` | `pdf` \| `art` \| `trim` \| `bleed` \| `media` \| `content_visible` \| `content_all` | PDF / AI: what to place: pdf (crop box; for an .ai the artboard), trim (the artboard), bleed (artboard + bleed, from a PDF exported with bleed; an .ai has none), art, media, content_visible, content_all Default: `"pdf"`. |
| `position` | `artboard` \| `bleed` | With crop "bleed": artboard (default) = x, y, width, height describe the artboard and the bleed hangs outside (onto the document bleed for a full-page visual; in a shape: the artboard is fitted, the bleed is cut by the shape); bleed = they describe the whole graphic including the bleed |

#### `create_graphic_from_svg`

Place SVG markup (a string) as a vector graphic: the server writes it to a temp .svg under $TMPDIR/indesign-mcp/svg/ (or to saveTo) and places it like place_graphic. Use it as the fallback when a native path cannot express something (text as outlines, complex filters). LIMITS: the result is NOT editable as paths in InDesign, and the RGB colours of the SVG are converted to CMYK only at output, through the CMYK profile of the document (accurate, but you cannot dictate exact CMYK numbers). For exact CMYK values use create_path_from_svg with swatches, or create_cmyk_pdf_shape. With embed: true the graphic is embedded and the temp file deleted; otherwise it stays linked to the file (temp files are removed after 3 days). External references, scripts, entities and external url() in the SVG are rejected.

| Parameter | Type | Description |
|---|---|---|
| `svg` *(required)* | string | Complete SVG markup, starting with <svg ...> |
| `x` | number | X position in mm Default: `10`. |
| `y` | number | Y position in mm Default: `10`. |
| `width` | number | Frame width in mm |
| `height` | number | Frame height in mm |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fitOption` | `PROPORTIONALLY` \| `FILL_PROPORTIONALLY` \| `CONTENT_TO_FRAME` \| `FRAME_TO_CONTENT` \| `CENTER_CONTENT` \| `NONE` | How the graphic fits the frame, with both width and height (otherwise the frame takes the aspect ratio of the graphic and the option is ignored): PROPORTIONALLY = whole graphic inside the frame, empty bands when the ratios differ (logos, charts, nothing may be cut); FILL_PROPORTIONALLY = covers the frame, edges cropped (photos, backgrounds, grid cells); CONTENT_TO_FRAME = stretched to the frame (distorts); FRAME_TO_CONTENT = frame resized to the graphic at 100% (width/height discarded); CENTER_CONTENT = 100%, centred; NONE = 100%, top-left Default: `"PROPORTIONALLY"`. |
| `embed` | boolean | Unlink and embed the graphic in the document Default: `false`. |
| `saveTo` | string | Optional: keep the .svg at this path (inside the allowed folders) instead of a temp file |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `create_cmyk_pdf_shape`

Generate a small vector PDF with EXACT CMYK fill/stroke values from SVG path data and place it (like place_graphic). Use it for logos or multi-colour shapes when you need exact brand CMYK numbers (the SVG route converts RGB through the profile) and native paths (create_path_from_svg with one swatch per colour) do not fit. The result is a linked or embedded graphic, not an editable path.

| Parameter | Type | Description |
|---|---|---|
| `shapes` *(required)* | object[] | Shapes painted in order: { d: SVG path data, fill: [C,M,Y,K] 0-100, stroke: [C,M,Y,K], strokeWidth: pt in viewBox units } |
| `viewBox` | string | SVG viewBox "minX minY width height" of the path data (default: bounds of all shapes) |
| `x` | number | X position in mm Default: `10`. |
| `y` | number | Y position in mm Default: `10`. |
| `width` | number | Frame width in mm |
| `height` | number | Frame height in mm |
| `pageIndex` | number | Page index (0-based) Default: `0`. |
| `fitOption` | `PROPORTIONALLY` \| `FILL_PROPORTIONALLY` \| `CONTENT_TO_FRAME` \| `FRAME_TO_CONTENT` \| `CENTER_CONTENT` \| `NONE` | How the graphic fits the frame, with both width and height (otherwise the frame takes the aspect ratio of the graphic and the option is ignored): PROPORTIONALLY = whole graphic inside the frame, empty bands when the ratios differ (logos, charts, nothing may be cut); FILL_PROPORTIONALLY = covers the frame, edges cropped (photos, backgrounds, grid cells); CONTENT_TO_FRAME = stretched to the frame (distorts); FRAME_TO_CONTENT = frame resized to the graphic at 100% (width/height discarded); CENTER_CONTENT = 100%, centred; NONE = 100%, top-left Default: `"PROPORTIONALLY"`. |
| `embed` | boolean | Unlink and embed the generated PDF (recommended: the temp file is removed afterwards) Default: `true`. |
| `saveTo` | string | Optional: keep the generated .pdf at this path instead of a temp file |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

### Colour

#### `create_color_swatch`

Create a colour swatch. Defaults to CMYK (values 0-100). RGB values (0-255) or a hex code are converted to CMYK in print documents with the colour management of InDesign (the CMYK profile of the document) unless keepRgb is true. Presets: rich_black (60/40/40/100), overprint_black (0/0/0/100; overprint is set per object with set_object_overprint).

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Swatch name |
| `colorModel` | `CMYK` \| `RGB` |  Default: `"CMYK"`. |
| `colorValues` | number[] | [C,M,Y,K] 0-100 for CMYK, or [R,G,B] 0-255 for RGB |
| `hex` | string | Alternative to colorValues: RGB hex such as #FF6600 |
| `preset` | `rich_black` \| `overprint_black` | Predefined CMYK values (overrides colorValues) |
| `keepRgb` | boolean | Keep RGB swatches as RGB even in a print document Default: `false`. |
| `spotColor` | boolean | Create as spot colour Default: `false`. |
| `update` | boolean | If a swatch with this name exists, change its values instead of failing (see also update_color_swatch) Default: `false`. |
| `conversion` | `profile` \| `simple` | How RGB / hex values become CMYK: profile = InDesign's colour management with the document's CMYK profile (accurate, default); simple = plain formula without a profile (hues drift toward blue) Default: `"profile"`. |

#### `update_color_swatch`

Change an existing colour swatch in place (all objects using it follow): new values (colorValues CMYK 0-100 or RGB 0-255, or hex), spot/process, and/or a new name. RGB or hex values are converted to CMYK in print documents with the colour management of InDesign unless keepRgb is true. Built-in swatches (Black, Paper, Registration, None) cannot be changed.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Name of the swatch to change |
| `newName` | string | Rename the swatch |
| `colorModel` | `CMYK` \| `RGB` | Model of colorValues Default: `"CMYK"`. |
| `colorValues` | number[] | [C,M,Y,K] 0-100 or [R,G,B] 0-255 |
| `hex` | string | Alternative to colorValues: RGB hex such as #FF6600 |
| `keepRgb` | boolean | Keep RGB values as RGB even in a print document Default: `false`. |
| `conversion` | `profile` \| `simple` | RGB/hex to CMYK: profile = InDesign colour management (accurate, default); simple = formula without profile Default: `"profile"`. |
| `spotColor` | boolean | true = spot colour, false = process colour |

#### `delete_color_swatch`

Delete a swatch. If objects or styles use it you must say what replaces it (replaceWith: a swatch name, or "none"); the error lists how it is used.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Name of the swatch to delete |
| `replaceWith` | string | Swatch that takes its place where it is used, or "none" |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `list_color_swatches`

List all swatches with kind, model and values (colours), base colour and tint (tints), stops (gradients) and where each is used: number of fills, strokes and styles, plus the ids of up to 10 objects. Local text colour overrides inside stories are not counted.

| Parameter | Type | Description |
|---|---|---|
| `includeUsage` | boolean | Also count where each swatch is used (scans the whole document) Default: `true`. |

#### `apply_color`

Apply color to an object

| Parameter | Type | Description |
|---|---|---|
| `objectId` | number | Stable object id (preferred) |
| `objectIndex` | number | Index in list_page_items for that page (shifts when the stacking order changes) |
| `pageIndex` | number | Page index Default: `0`. |
| `swatchName` *(required)* | string | Color swatch name |
| `property` | `fill` \| `stroke` |  Default: `"fill"`. |

#### `convert_rgb_to_cmyk`

Convert an RGB colour (0-255 values or hex) to CMYK percentages. conversion "profile" (default) uses the colour management of InDesign with the CMYK profile of the active document (accurate: hues stay put, and it tells you when the colour is outside the print gamut and how it will really look). "simple" is a plain formula without a profile, needs no document, and shifts hues (greens toward blue).

| Parameter | Type | Description |
|---|---|---|
| `rgb` | number[] | [R,G,B] 0-255 (sRGB) |
| `hex` | string | Hex colour such as #FF6600 |
| `conversion` | `profile` \| `simple` | profile = InDesign colour management (needs an open document); simple = formula Default: `"profile"`. |

### Tables

#### `create_table`

Create a table in a new text frame (mm; rows include header and footer rows). Returns the frame id, the rows and the columns.

| Parameter | Type | Description |
|---|---|---|
| `x` *(required)* | number | X position in mm |
| `y` *(required)* | number | Y position in mm |
| `width` *(required)* | number | Table width in mm |
| `height` *(required)* | number | Table height in mm |
| `rows` *(required)* | number | Number of rows |
| `columns` *(required)* | number | Number of columns |
| `pageIndex` | number | Page index Default: `0`. |
| `headerRows` | number | Number of header rows Default: `1`. |
| `footerRows` | number | Number of footer rows Default: `0`. |

#### `populate_table`

Populate table with data

| Parameter | Type | Description |
|---|---|---|
| `tableIndex` *(required)* | number | Table index on page |
| `pageIndex` | number | Page index Default: `0`. |
| `data` *(required)* | array[] | Array of arrays with table data |
| `includeHeaders` | boolean | First row contains headers Default: `true`. |

### Layout setup: format, margins, grids, guides

#### `get_layout_setup`

The document's layout setup in one read: format and orientation, facing pages, binding, start page, intent, bleed and slug, page shuffling, spreads, margins and columns of each master (and of pages that differ), guides, baseline and document grids, sections and page numbering, masters and the pages they apply to, alternate layouts, layers.

_No parameters._

#### `set_document_setup`

Document setup (File > Document Setup): page size, facing pages, binding direction, start page number, intent, bleed and slug (uniform or per side), page shuffling. Only the values given change. With facing pages, an even start page number puts the first page on the left.

| Parameter | Type | Description |
|---|---|---|
| `width` | number | Page width (mm) |
| `height` | number | Page height (mm) |
| `facingPages` | boolean | Facing pages (spreads of left and right pages) |
| `binding` | `left` \| `right` | Binding edge: left (left-to-right reading, the default) or right (right-to-left) |
| `startPageNumber` | number | Number of the first page; with facing pages an even number starts on a left page |
| `intent` | `print` \| `web` \| `mobile` | Print (CMYK, mm) or screen (RGB, px) |
| `bleed` | number | Bleed on every side (mm) |
| `bleedTop` | number | Top bleed (mm) |
| `bleedBottom` | number | Bottom bleed (mm) |
| `bleedInside` | number | Inside (left on single pages) |
| `bleedOutside` | number | Outside (right on single pages) |
| `slug` | number | Slug on every side (mm) |
| `allowPageShuffle` | boolean | false: pages keep their spreads when pages are added, removed or moved (needed for spreads of 3+ pages) |
| `adjustLayout` | boolean | With a new page size: move and resize the objects, guides and margins with the page (File > Adjust Layout), type size included Default: `false`. |

#### `set_margins_columns`

Margins and columns (Layout > Margins and Columns) of masters and/or pages. Set them on the masters so every page that uses them follows; set them on a page only for an exception. Only the values given change.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout) |
| `masters` | string[] | Masters (parent pages) by name ("A-Parent"), prefix ("A") or base name: every page of each |
| `top` | number | Top margin (mm) |
| `bottom` | number | Bottom margin (mm) |
| `inside` | number | Inside margin (mm; left margin on single pages) |
| `outside` | number | Outside margin (mm; right margin on single pages) |
| `columns` | number | Number of columns |
| `gutter` | number | Column gutter (mm) |

#### `create_grid_guides`

Layout grid as guides (Layout > Create Guides): columns and rows with gutters, inside the margins or across the page, on masters and/or pages. A 12-column grid with a 4–5 mm gutter is the usual base: 2, 3, 4 and 6 columns all fall on it. Guides on a master show on every page that uses it.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout) |
| `masters` | string[] | Masters (parent pages) by name ("A-Parent"), prefix ("A") or base name: every page of each |
| `columns` | number | Columns (e.g. 12, 6, 24); 0 = no vertical guides Default: `12`. |
| `rows` | number | Rows of a modular grid; 0 = none Default: `0`. |
| `columnGutter` | number | Gutter between columns (mm); default: the margins gutter |
| `rowGutter` | number | Gutter between rows (mm); default: the column gutter |
| `fitTo` | `margins` \| `page` | Divide the margin box (default) or the whole page Default: `"margins"`. |
| `replace` | boolean | Remove the existing guides of those pages first Default: `false`. |
| `color` | string | Guide / grid colour name: RED, BLUE, LIGHT_BLUE, GREEN, YELLOW, MAGENTA, CYAN, ORANGE, VIOLET, GRAY, BLACK… |

#### `add_guides`

Ruler guides at given positions (mm from the page's top-left corner) on masters and/or pages.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout) |
| `masters` | string[] | Masters (parent pages) by name ("A-Parent"), prefix ("A") or base name: every page of each |
| `vertical` | number[] | x positions (mm) |
| `horizontal` | number[] | y positions (mm) |
| `acrossSpread` | boolean | Guides across the whole spread instead of the page Default: `false`. |
| `color` | string | Guide / grid colour name: RED, BLUE, LIGHT_BLUE, GREEN, YELLOW, MAGENTA, CYAN, ORANGE, VIOLET, GRAY, BLACK… |
| `locked` | boolean | Lock the new guides Default: `false`. |

#### `delete_guides`

Remove ruler guides from masters and/or pages: all, or only vertical / horizontal ones.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout) |
| `masters` | string[] | Masters (parent pages) by name ("A-Parent"), prefix ("A") or base name: every page of each |
| `orientation` | `all` \| `vertical` \| `horizontal` |  Default: `"all"`. |

#### `set_grids`

Baseline grid and document grid (Preferences > Grids), plus guide display. Body text aligns on the baseline grid when its increment equals the body leading (11 pt type on 14 pt leading: increment 14 pt). Only the values given change.

| Parameter | Type | Description |
|---|---|---|
| `baselineIncrement` | number | Baseline grid increment (pt) |
| `baselineStart` | number | Baseline grid start (mm) |
| `baselineRelativeTo` | `page` \| `margin` | Start measured from the top of the page or the top margin |
| `baselineColor` | string | Guide / grid colour name: RED, BLUE, LIGHT_BLUE, GREEN, YELLOW, MAGENTA, CYAN, ORANGE, VIOLET, GRAY, BLACK… |
| `baselineShown` | boolean | Show the baseline grid |
| `documentGridEvery` | number | Document grid: a gridline every N mm |
| `documentGridSubdivisions` | number | Subdivisions between gridlines |
| `documentGridShown` | boolean | Show the document grid |
| `snapToDocumentGrid` | boolean | Snap objects to the document grid |
| `guidesInBack` | boolean | Guides and grids behind the objects |

### Aligning on the grid

#### `get_page_grid`

The reference lines of a page, with their positions in mm: margins, columns (start and end of each), ruler guides of the page and of its master, page edges and centre, bleed, and the baseline grid when asked. Use it before aligning, to name the lines objects should sit on.

| Parameter | Type | Description |
|---|---|---|
| `page` *(required)* | string | Page as named in InDesign ("12", "+3", "Tablette:2") |
| `baseline` | boolean | Also list the baseline grid lines Default: `false`. |

#### `snap_to_grid`

Snap objects that sit a few mm off the page structure onto it: each edge (left, right, top, bottom) goes to the nearest margin, column edge, guide (page or master), page edge or centre, or bleed within the tolerance; mode center puts the centre of each object on the nearest line instead (column centres included). dryRun: report without changing. The lines used show in the review images.

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Object ids |
| `tolerance` | number | Maximum distance to a line (mm) Default: `3`. |
| `targets` | string[] | Lines to snap to (default: margin, column, guide, page, bleed; baseline on request) |
| `mode` | `auto` \| `move` \| `resize` \| `center` | auto: resize when both edges are near lines, else move; move: never resize; resize: each near edge on its own; center: the centre of the object goes to the nearest line (a column centre, the page centre, a guide), size kept Default: `"auto"`. |
| `axis` | `both` \| `x` \| `y` | Snap horizontally (x), vertically (y) or both Default: `"both"`. |
| `dryRun` | boolean | Only report what would move Default: `false`. |

#### `fit_to_grid`

Place objects on the column grid of their page (margins and columns of the page, set_margins_columns) and, with rowCount, on rows: span columns 3 to 6 (fit: span), or keep the size and align to the start, end or centre of those columns. columns / rows are 1-based and inclusive ([3, 6] = columns 3, 4, 5, 6). The lines used show in the review images.

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Object ids |
| `columns` | number[] | [first, last] column (1-based) |
| `rows` | number[] | [first, last] row (1-based); needs rowCount |
| `rowCount` | number | Rows of the modular grid inside the margins (as in create_grid_guides) |
| `rowGutter` | number | Gutter between rows in mm (default: the column gutter) |
| `fit` | `span` \| `start` \| `end` \| `center` | span: the object fills the columns / rows; start / end / center: it keeps its size and aligns there Default: `"span"`. |

### French typography

#### `french_typography`

French typography rules on text, rule by rule: spaces: Double spaces, spaces at the start or end of paragraphs, before , and . or inside ( ) and [ ] removed \| high_punctuation: Thin no-break space before ; ! ? and word no-break space before : (no space before the second sign of ?! or after a URL / a time) \| french_quotes_spacing: Word no-break space inside « » (only where « » are already used) \| quotes (off by default): Straight "double quotes" → « guillemets » with their spaces. Contextual: English text, code, inches (12") keep theirs; turn on when the text is French and the user wants it \| apostrophe: Straight apostrophe between letters → typographic ’ (l'été → l’été) \| ellipsis: ... → … (one character); « etc. » never followed by an ellipsis \| numbers: Thin no-break space between thousands (10 000), word no-break space before units, % and currencies (12 €, 30 %, 5 km) \| dates_names: Word no-break space in dates (12 mars), after M., Mme, Dr, Me, n°, p., art., fig., chap., vol., §, and between a number and the word it counts (3 pages stays breakable) \| dashes: Spaced hyphen " - " → spaced en dash " – " (incise), number ranges 1990-2000 → 1990–2000 (not phone numbers or dates with more parts) \| ordinals: 1er, 2e, XIXe: ème / ième / me → e, suffix in superscript (1re, 2de, 3es) \| ligatures: oe → œ in the words that take it (cœur, œuvre, sœur, œil, bœuf, nœud, vœu, œuf, manœuvre…), capitals included \| accented_capitals: Accents on capitals: A la → À la (sentence start), Etat → État, Ecole → École, Equipe → Équipe… \| multiplication (off by default): Times sign between numbers: 3 x 4 → 3 × 4, 21x29,7 → 21 × 29,7 (dimensions). Contextual: off by default \| lists: punctuation of bulleted lists (report by default; semicolon = items end with ; and the last with .; none; period). Scope: one story (frameId), pages, or the whole document (master text included). dryRun counts what each rule would change, with examples: run it first and let the user turn rules off (rules: { quotes: true, ordinals: false }).

| Parameter | Type | Description |
|---|---|---|
| `frameId` | number | The story of this text frame |
| `pages` | any[] | The stories with text on these pages (a story that runs on goes with them) |
| `allPages` | boolean | Every story of the document Default: `false`. |
| `rules` | object | Turn rules on or off, e.g. { "quotes": true, "ordinals": false }. Rules: spaces, high_punctuation, french_quotes_spacing, quotes, apostrophe, ellipsis, numbers, dates_names, dashes, ordinals, ligatures, accented_capitals, multiplication |
| `only` | string[] | Run only these rules |
| `lists` | `report` \| `semicolon` \| `none` \| `period` | Bulleted lists: report the punctuation (default), or fix it (semicolon, none, period) Default: `"report"`. |
| `dryRun` | boolean | Count and show examples, change nothing Default: `false`. |

### Page numbers, sections, spreads

#### `insert_special_character`

Insert a special character in a text frame: page numbers (page_number = current page, which updates when pages move; next/previous_page_number for "continued on"), section_marker, typographic spaces (fixed_nonbreaking_space = U+202F, the French space before ; : ! ? and inside « », nonbreaking_space stretches with justification, thin, hair, em, en, figure), dashes, discretionary / nonbreaking hyphens, breaks (column, frame, page, odd/even page, forced line), right_indent_tab, indent_to_here, end_nested_style, symbols. Folios: put page_number in a frame on the master. Where: at the end (default) or start of the story, or after / before / instead of a text.

| Parameter | Type | Description |
|---|---|---|
| `frameId` *(required)* | number | Text frame id (its story) |
| `character` *(required)* | `page_number` \| `next_page_number` \| `previous_page_number` \| `section_marker` \| `nonbreaking_space` \| `fixed_nonbreaking_space` \| `thin_space` \| `hair_space` \| `em_space` \| `en_space` \| `figure_space` \| `punctuation_space` \| `flush_space` \| `em_dash` \| `en_dash` \| `discretionary_hyphen` \| `nonbreaking_hyphen` \| `forced_line_break` \| `column_break` \| `frame_break` \| `page_break` \| `odd_page_break` \| `even_page_break` \| `right_indent_tab` \| `indent_to_here` \| `end_nested_style` \| `ellipsis` \| `bullet` \| `copyright` \| `registered` \| `trademark` \| `section_symbol` \| `paragraph_symbol` \| `degree` \| `left_double_quote` \| `right_double_quote` \| `left_single_quote` \| `right_single_quote` |  |
| `position` | `end` \| `start` |  Default: `"end"`. |
| `after` | string | Insert after the first occurrence of this text |
| `before` | string | Insert before the first occurrence of this text |
| `replace` | string | Replace every occurrence of this text with the character (e.g. a typed folio "12" by page_number) |

#### `set_section`

Start a section at a page (Numbering & Section Options): page numbering restart, style (1, 01, i, I, a, A), prefix and section marker. The page numbers shown by page-number characters follow it. remove: true removes the section that starts at that page (the first page always keeps one).

| Parameter | Type | Description |
|---|---|---|
| `page` *(required)* | string | Page where the section starts (as named in InDesign, or "+N") |
| `startNumber` | number | Restart numbering at this number (omit to continue from the previous section) |
| `style` | `1` \| `01` \| `001` \| `0001` \| `i` \| `I` \| `a` \| `A` | Number style: 1, 01, 001, 0001, i, I, a, A |
| `prefix` | string | Section prefix (e.g. "A-") |
| `includePrefix` | boolean | Show the prefix in page numbers on the pages |
| `marker` | string | Section marker text (shown by the section_marker character) |
| `remove` | boolean | Remove the section that starts at this page Default: `false`. |

#### `set_spread_options`

Spreads: keep the spreads of these pages together (allowShuffle: false, an "island spread" that stays as it is when pages are added or moved), or let them reflow again; join pages into one spread (a gatefold of 3 or 4 pages: joinPages, in reading order).

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout) |
| `allowShuffle` | boolean | false keeps each spread of these pages together |
| `joinPages` | any[] | Pages to gather into the spread of the first one, in order (e.g. ["4", "5", "6"]) |

#### `view_page_map`

The document seen from above: every spread as small page images, like the Pages panel, page names under the pages and a band with the name of each alternate layout. Returns the image file to show the user. layout: only that layout.

| Parameter | Type | Description |
|---|---|---|
| `layout` | string | Only the pages of this alternate layout |
| `language` | `fr` \| `en` |  Default: `"fr"`. |

### Masters (parent pages)

#### `find_repeated_items`

Find objects repeated at the same place on several pages (backgrounds, headers, footers, folios, logos, frames of a recurring layout): candidates for a master. Each pattern lists its pages and the object ids on one page, with the create_master call that turns it into a master. Typed folios (digits only) count as the same object.

| Parameter | Type | Description |
|---|---|---|
| `pages` | any[] | Pages to scan (default: all) |
| `minPages` | number | Report objects found on at least this many pages Default: `3`. |
| `tolerance` | number | Position tolerance (mm) Default: `0.5`. |

#### `create_master`

Create a master (parent page). Optionally copy objects into it (fromIds: objects of one page, or of a left and a right page for facing masters; they land on the master page of the same side at the same place), turn typed folios into automatic page numbers (pageNumberIds), apply it to pages, and delete from those pages the objects the master now provides (removeMatching). Without fromIds the master is empty (or a copy of basedOn's items through inheritance).

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Base name, e.g. "Chapitre" |
| `prefix` | string | Prefix shown on pages (1-4 characters); default: next free letter |
| `pageCount` | number | Pages in the master: 2 for facing pages (default), 1 otherwise |
| `basedOn` | string | Parent master: this master inherits its objects and changes with it |
| `fromIds` | number[] | Objects to copy into the master (they stay where they are) |
| `pageNumberIds` | number[] | Among fromIds: text frames whose digits become the automatic page number |
| `applyTo` | any[] | Pages to apply the master to |
| `removeMatching` | boolean | On those pages, delete the objects that match fromIds (same kind, place, colours, text; folios match any number) Default: `false`. |
| `tolerance` | number | Matching tolerance (mm) Default: `0.5`. |

#### `copy_to_master`

Copy objects (by id) into an existing master, at the same place on the master page of the same side. Same options as create_master: pageNumberIds, removeOriginals (delete the copied objects from their page), applyTo + removeMatching.

| Parameter | Type | Description |
|---|---|---|
| `master` *(required)* | string | Master by name ("B-Chapitre"), prefix ("B") or base name |
| `ids` *(required)* | number[] | Objects to copy into the master |
| `pageNumberIds` | number[] | Among ids: text frames whose digits become the automatic page number |
| `removeOriginals` | boolean | Delete the copied objects from their page Default: `false`. |
| `applyTo` | any[] | Pages to apply the master to |
| `removeMatching` | boolean | On those pages, delete the objects that match ids Default: `false`. |
| `tolerance` | number | Matching tolerance (mm) Default: `0.5`. |

#### `apply_master`

Apply a master to pages ("none" removes it), and/or show or hide master objects on their spreads.

| Parameter | Type | Description |
|---|---|---|
| `pages` *(required)* | any[] | Pages as named in InDesign ("12", "+3", "Tablette:2") |
| `master` | string | Master name / prefix, or "none" |
| `showMasterItems` | boolean | false hides the master objects on the spreads of these pages |

#### `list_master_items`

Objects of a master, page by page, with their ids: edit them with the usual tools (set_object_geometry, edit_text_frame, find_replace_text…) to change every page that uses the master. With page: the master objects shown on that page, and the ones already overridden there.

| Parameter | Type | Description |
|---|---|---|
| `master` | string | Master by name ("B-Chapitre"), prefix ("B") or base name |
| `page` | string | A document page instead: its master objects and overrides |

#### `override_master_items`

Override master objects on a page (Ctrl/Cmd+Shift+click): the page gets an editable copy linked to the master object, with a new id (returned). all: true overrides every master object of the page. detach: true cuts the link (the copy no longer follows the master).

| Parameter | Type | Description |
|---|---|---|
| `page` *(required)* | string | Page as named in InDesign |
| `ids` | number[] | Master object ids (list_master_items) |
| `all` | boolean | Override every master object of the page Default: `false`. |
| `detach` | boolean | Cut the link to the master Default: `false`. |

#### `remove_master_overrides`

Give overridden objects back to their master: the page copy (and its edits) is deleted and the master version shows again. ids: overridden copies on the page; all: true every override of the page.

| Parameter | Type | Description |
|---|---|---|
| `page` *(required)* | string | Page as named in InDesign |
| `ids` | number[] | Overridden copies on the page |
| `all` | boolean | Every override of the page Default: `false`. |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `set_master`

Rename a master (name and/or prefix), or base it on another master ("none" to stop inheriting).

| Parameter | Type | Description |
|---|---|---|
| `master` *(required)* | string | Master by name ("B-Chapitre"), prefix ("B") or base name |
| `newName` | string | New base name |
| `prefix` | string | New prefix (1-4 characters) |
| `basedOn` | string | Parent master, or "none" |

#### `delete_master`

Delete a master. Its pages get replaceWith (a master name or "none"; default "none"). Overridden copies stay on their pages as plain objects.

| Parameter | Type | Description |
|---|---|---|
| `master` *(required)* | string | Master by name ("B-Chapitre"), prefix ("B") or base name |
| `replaceWith` | string | Master for the pages that used it, or "none" Default: `"none"`. |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

### Alternate layouts

#### `create_alternate_layout`

Create an alternate layout (Layout > Create Alternate Layout): a copy of a layout's pages in another format or as a variant, in the same document. Text stays linked to the source by default (edits to the source can be pushed to it); pass linkStories: false for an independent version. Its pages are named "Layout:page" in the tools. rule: how objects adapt to the new size (preserve = as laid out on the source, scale, recenter, guides, objects = liquid layout rules, master).

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layout name, e.g. "A5 portrait" or "Version B" |
| `from` | string | Source layout (default: the first one) |
| `preset` | `A3` \| `A4` \| `A5` \| `A6` \| `Letter` \| `Legal` \| `Tabloid` | Page size preset |
| `orientation` | `portrait` \| `landscape` |  |
| `width` | number | Page width (mm); default: the source size |
| `height` | number | Page height (mm) |
| `linkStories` | boolean | Keep text linked to the source layout Default: `true`. |
| `copyStyles` | boolean | Copy the text styles into a style group of the new layout Default: `false`. |
| `rule` | `preserve` \| `off` \| `scale` \| `recenter` \| `guides` \| `objects` \| `master` |  Default: `"preserve"`. |

#### `delete_alternate_layout`

Delete an alternate layout and its pages.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layout to delete |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

#### `compare_layouts`

Compare two alternate layouts page by page (the n-th page of one with the n-th of the other), or two given pages (pageA / pageB, e.g. "3" and "Tablette:3"): images side by side, each layout named, with numbered zones (orange = differs, red / green = only on one side), and a table of what differs: place and size (mm and % of the page), text, type size, fonts, styles, colours, images. Use it to explain how one version differs from the other.

| Parameter | Type | Description |
|---|---|---|
| `a` | string | First layout |
| `b` | string | Second layout |
| `pages` | any[] | Only these positions in the layouts ("1", "+2"…: page names of layout a) |
| `pageA` | string | Or: one page ("Layout:page" or a page name) |
| `pageB` | string | Its counterpart |
| `maxImages` | number | Images returned inline (all are saved) Default: `3`. |
| `language` | `fr` \| `en` |  Default: `"fr"`. |

### Layers

#### `create_layer`

Create a new layer with a name, optional guide colour, visibility and lock state. Fails if the name is taken.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layer name |
| `color` | string | Layer colour name, e.g. RED, BLUE, LIGHT_BLUE, GREEN, YELLOW (error if unknown) |
| `visible` | boolean | Layer visibility Default: `true`. |
| `locked` | boolean | Layer locked state Default: `false`. |

#### `set_active_layer`

Set the active layer

| Parameter | Type | Description |
|---|---|---|
| `layerName` *(required)* | string | Layer name to activate |

#### `list_layers`

List all layers in the document, top of the stack first

_No parameters._

#### `move_layer`

Change the stacking order of a layer: to the top or bottom of the stack, or directly above / below another layer. Layers higher in the stack paint over lower ones.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layer to move |
| `position` | `top` \| `bottom` | Top or bottom of the layer stack |
| `above` | string | Or: put it directly above this layer |
| `below` | string | Or: put it directly below this layer |

#### `move_to_layer`

Move objects (by id) to another layer. They keep their page and position; on the target layer they sit above what is already there.

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Object ids |
| `layerName` *(required)* | string | Target layer |

#### `set_layer`

Change a layer: rename it, show / hide, lock / unlock, printing on / off (non-printing layers hold notes and guides for the team), its colour, and whether its guides show or are locked.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layer to change |
| `newName` | string | New name |
| `visible` | boolean | Show or hide the layer |
| `locked` | boolean | Lock or unlock the layer |
| `printable` | boolean | false: the layer is not printed or exported |
| `color` | string | Layer colour name, e.g. RED, BLUE, LIGHT_BLUE, GREEN, YELLOW |
| `showGuides` | boolean | Show the guides of this layer |
| `lockGuides` | boolean | Lock the guides of this layer |

#### `delete_layer`

Delete a layer. Its objects are deleted with it, unless moveItemsTo names a layer to keep them on.

| Parameter | Type | Description |
|---|---|---|
| `name` *(required)* | string | Layer to delete |
| `moveItemsTo` | string | Layer that receives the objects first |
| `confirmDestructive` | boolean | Confirm an action that deletes or overwrites (only when the user asked for it) Default: `false`. |

### Export and production

#### `export_pdf`

Export the active document as PDF. preset: Print/HighQualityPrint = [High Quality Print], Web/SmallestFileSize = [Smallest File Size], PressQuality = [Press Quality], PDFX1a/PDFX3/PDFX4 = the PDF/X presets, or the exact name of any PDF preset in InDesign. includeBleed uses the document bleed; includeSlug the slug. Overwriting an existing file needs confirmDestructive.

| Parameter | Type | Description |
|---|---|---|
| `filePath` *(required)* | string | Output PDF file path |
| `preset` | string | Preset alias or exact PDF preset name Default: `"HighQualityPrint"`. |
| `pageRange` | string | Pages, e.g. "1", "2-3", "1,3-5" or "all" Default: `"all"`. |
| `layout` | string | Only the pages of this alternate layout (pageRange then counts within it: "1-2" = its first two pages) |
| `includeBleed` | boolean | Use the document bleed Default: `false`. |
| `includeSlug` | boolean | Include the slug area Default: `false`. |
| `confirmDestructive` | boolean | Required only when the file already exists (it is overwritten) Default: `false`. |

#### `export_images`

Export pages as PNG or JPEG, one file per page: <folder>/<documentname>_page<N>.<ext>. The folder is created if missing. Returns the list of files written.

| Parameter | Type | Description |
|---|---|---|
| `folderPath` *(required)* | string | Output folder path |
| `format` | `PNG` \| `JPEG` |  Default: `"PNG"`. |
| `resolution` | number | Export resolution in dpi (e.g. 72, 100, 300) Default: `300`. |
| `pageRange` | string | Pages, e.g. "1", "2-3", "1,3-5" or "all" Default: `"all"`. |
| `layout` | string | Only the pages of this alternate layout (pageRange then counts within it) |
| `includeBleed` | boolean | Include the document bleed Default: `false`. |
| `confirmDestructive` | boolean | Required only when the folder already holds files Default: `false`. |

#### `export_epub`

Export document as EPUB

| Parameter | Type | Description |
|---|---|---|
| `filePath` *(required)* | string | Output EPUB file path |
| `version` | `EPUB2` \| `EPUB3` |  Default: `"EPUB3"`. |
| `imageFormat` | `AUTOMATIC` \| `PNG` \| `JPEG` \| `GIF` | Image conversion Default: `"AUTOMATIC"`. |
| `confirmDestructive` | boolean | Required only when the file already exists (it is overwritten) Default: `false`. |

#### `package_document`

Package document for print production

| Parameter | Type | Description |
|---|---|---|
| `folderPath` *(required)* | string | Output folder path |
| `includeLinkedFiles` | boolean | Include linked files Default: `true`. |
| `includeFonts` | boolean | Include fonts Default: `true`. |
| `createReport` | boolean | Create packaging report Default: `true`. |
| `confirmDestructive` | boolean | Required only when the folder already holds files Default: `false`. |

#### `preflight_document`

Run preflight check on the document

| Parameter | Type | Description |
|---|---|---|
| `profile` | string | Preflight profile name |
| `scope` | `document` \| `selection` |  Default: `"document"`. |

#### `data_merge`

Merge the active document (which needs data field placeholders) with a CSV/TXT data source. Writes ONE merged file per format into outputFolder: <document>_merged.pdf and/or <document>_merged.indd

| Parameter | Type | Description |
|---|---|---|
| `dataSourcePath` *(required)* | string | Path to CSV data source |
| `outputFolder` *(required)* | string | Output folder (created if missing) |
| `fileFormat` | `INDD` \| `PDF` \| `BOTH` |  Default: `"PDF"`. |
| `recordRange` | string | Records: "all", a single number ("3") or a range ("1-10") Default: `"all"`. |
| `confirmDestructive` | boolean | Required only when the output folder already holds files Default: `false`. |

### Utilities

#### `run_script`

Run a short ExtendScript (ES3) on the active document for a case no tool covers yet: a property the tools do not expose, a one-off batch over many objects, a check. Prefer it to changing the server when the need is particular or not critical. `doc` is the active document; __findById(doc, id) finds an object; lengths are mm with the origin at each page's top-left; the last expression is the result (return text: ids, values, what changed). Files, the system, menus, saving and exporting stay with their tools. Each run is noted in NOTES.md (purpose, missing tool, code) for the author; a need that comes back or blocks a task deserves a real tool instead.

| Parameter | Type | Description |
|---|---|---|
| `purpose` *(required)* | string | One line: what the script does (it titles the note) |
| `code` *(required)* | string | ExtendScript (ES3: var, function, no arrow functions or template strings); the last expression is the result |
| `missing` | string | What tool or option would have made the script unnecessary |
| `ids` | number[] | Objects the script changes (their pages join the automatic snapshot, so review_compare shows the change) |
| `pageIndex` | number | Page the script changes (0-based), when it changes no object by id |

#### `execute_indesign_code`

⚠️ Execute custom ExtendScript code in InDesign (REQUIRES INDESIGN_ALLOW_ARBITRARY_CODE=1)

| Parameter | Type | Description |
|---|---|---|
| `code` *(required)* | string | ExtendScript/JavaScript code to execute in InDesign. WARNING: Can access filesystem, network, and system APIs! |

#### `add_improvement_note`

Write a note for the author of this server in NOTES.md: a bug, a missing feature, a better way you found, or a fix you made yourself in the server files. Every local change to the server must have a note (files and what changed). Check read_improvement_notes first to avoid duplicates. Keep notes generic: no client names or client text.

| Parameter | Type | Description |
|---|---|---|
| `kind` *(required)* | `bug` \| `feature` \| `workaround` \| `observation` | bug, feature (wanted), workaround (a better way found), observation |
| `title` *(required)* | string | One line: what it is about |
| `details` *(required)* | string | What happened, how to reproduce it, what you expected, what would help (Markdown) |
| `status` | `wanted` \| `fixed-locally` \| `workaround-found` | wanted (needs the author), fixed-locally (you changed server files), workaround-found Default: `"wanted"`. |
| `tool` | string | The tool concerned, if any (e.g. export_pdf) |
| `filesChanged` | string[] | Server files you changed, relative to the server folder, each with what changed (e.g. "tools/export-tools.js: keep the preset name") |

#### `read_improvement_notes`

Read NOTES.md, the improvement notes written so far for the author of this server (bugs, wanted features, workarounds, local fixes), with the path of the server folder.

_No parameters._

### Other

#### `paste_into`

Put existing objects inside a shape (Paste Into): the shape (rectangle, oval, polygon) becomes their mask and they keep their page position. Two or more objects are grouped first (name, default "Contenu"), so they move as one inside the mask. The objects get new ids (listed old → new); the clipboard then holds the cut objects. The shape must be empty and on the same spread.

| Parameter | Type | Description |
|---|---|---|
| `ids` *(required)* | number[] | Ids of the objects to put inside the shape |
| `shapeId` *(required)* | number | Id of the empty shape that becomes the mask |
| `name` | string | Name of the group made from two or more objects Default: `"Contenu"`. |

<!-- TOOLS:END -->

## Known limits

- **macOS and Windows.** On macOS the application name is detected automatically (a running InDesign first, then the newest `Adobe InDesign <year>.app` in `/Applications` or `~/Applications`, else `Adobe InDesign 2026`); set `INDESIGN_APP_NAME` to override it. On Windows the version-independent COM ProgID `InDesign.Application` is used (the newest registered version); set `INDESIGN_APP_NAME` or `INDESIGN_COM_PROGID` to pick another installed version.
- One script runs at a time; calls are queued. A modal dialog open in InDesign blocks all tools until it is closed (calls time out after 60 s; on Windows, a call that has to start InDesign first gets 5 minutes).
- Fonts must be installed: unknown fonts are an error (`Font not installed: ...`), not silently ignored.
- Tool scripts run with InDesign's user interaction set to "never interact" (restored afterwards), so an invalid request produces a tool error instead of a modal dialog that would block InDesign.
- Tests and tools act on the *active* document: do not open, close or switch documents in InDesign while a tool run or `npm test` is in progress.
- `place_graphic` handles `.svg`, `.pdf`, `.ai` and `.eps`; only SVG and PDF are covered by the tests.
- Vector previews are limited to 4000 px on the longest side.
- `set_object_overprint` fails for objects with transparency or a blend mode (an InDesign restriction).
- Bright RGB blues, oranges and some greens are outside the CMYK gamut: the conversion returns the nearest printable colour (`convert_rgb_to_cmyk` reports the difference).
- `insert_markdown_text` supports headers, bold, italic and paragraphs only.
- Objects are addressed by id; `pageIndex`/`index` addressing shifts when the stacking order changes.
- `data_merge` needs a document that already contains data field placeholders; it writes one merged file per format (`<document>_merged.pdf` / `.indd`), not one per record.
- `export_epub` uses InDesign's default EPUB settings apart from `version` and `imageFormat`; `package_document` needs a saved document and always ignores preflight errors.
