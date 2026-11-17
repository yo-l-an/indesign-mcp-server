// Document setup for designers: page format, facing pages and binding, bleed and slug, margins and
// columns, layout grids and guides, baseline and document grids, sections and page numbering,
// special characters, spreads. One read tool (get_layout_setup) shows all of it at once.
//
// Pages are named as the user says them (resolvePageRefs: "12", "+3", "Tablette:2"); master pages
// by master name ("A-Parent", "A" or the base name). Lengths in mm, baseline increments in pt.

import { PAGES_SCRIPT, parsePageLines, resolvePageRefs } from './review-tools.js';
import { has } from '../lib/tool-context.js';

// ES3 helpers shared by the scripts of this module and of master-tools.js
export const LAYOUT_JS = `
  function __mm(n) { return Math.round(n * 10) / 10; }
  // A master spread by full name ("A-Parent"), prefix ("A") or base name ("Parent")
  function __master(doc, name) {
    var m = doc.masterSpreads.itemByName(name);
    if (m.isValid) return m;
    for (var i = 0; i < doc.masterSpreads.length; i++) {
      var s = doc.masterSpreads[i];
      if (s.namePrefix === name || s.baseName === name) return s;
    }
    var names = [];
    for (var j = 0; j < doc.masterSpreads.length; j++) names.push(doc.masterSpreads[j].name);
    throw new Error("Master not found: " + name + ". Masters: " + names.join(", "));
  }
  // Pages by index (document pages) plus every page of the named masters
  function __targetPages(doc, idx, masters) {
    var out = [];
    for (var i = 0; i < idx.length; i++) out.push(doc.pages[idx[i]]);
    for (var k = 0; k < masters.length; k++) {
      var m = __master(doc, masters[k]);
      for (var q = 0; q < m.pages.length; q++) out.push(m.pages[q]);
    }
    if (!out.length) throw new Error("Say where: pages (as named in InDesign) and/or masters");
    return out;
  }
  function __pageLabel(pg) {
    try { if (pg.parent.constructor.name === "MasterSpread") return "master " + pg.parent.name + (pg.parent.pages.length > 1 ? " (" + (String(pg.side).indexOf("LEFT") === 0 ? "left" : "right") + ")" : ""); } catch (e) {}
    return "page " + pg.name;
  }
  // Outer edges of the margins, left to right on the page: inside / outside swap on left-hand pages
  function __marginBox(pg) {
    var b = pg.bounds, w = b[3] - b[1], h = b[2] - b[0], mp = pg.marginPreferences;
    var left = mp.left, right = mp.right;
    if (String(pg.side).indexOf("LEFT") === 0) { left = mp.right; right = mp.left; }
    return { top: mp.top, left: left, bottom: h - mp.bottom, right: w - right, width: w, height: h };
  }
  function __describeMargins(pg) {
    var mp = pg.marginPreferences;
    var facing = pg.parent.pages.length > 1 || String(pg.side) !== "SINGLE_SIDED";
    return "top " + __mm(mp.top) + " · bottom " + __mm(mp.bottom) + " · " + (facing ? "inside " : "left ") + __mm(mp.left) + " · " + (facing ? "outside " : "right ") + __mm(mp.right) +
      " mm, " + mp.columnCount + " column" + (mp.columnCount > 1 ? "s" : "") + (mp.columnCount > 1 ? " (gutter " + __mm(mp.columnGutter) + " mm)" : "");
  }
`;

const NUMBER_STYLES = {
  '1': 'ARABIC', '01': 'SINGLE_LEADING_ZEROS', '001': 'DOUBLE_LEADING_ZEROS', '0001': 'TRIPLE_LEADING_ZEROS',
  i: 'LOWER_ROMAN', I: 'UPPER_ROMAN', a: 'LOWER_LETTERS', A: 'UPPER_LETTERS',
};

// insert_special_character: name -> SpecialCharacters member, or a Unicode character
export const SPECIAL_CHARACTERS = {
  page_number: 'AUTO_PAGE_NUMBER', next_page_number: 'NEXT_PAGE_NUMBER', previous_page_number: 'PREVIOUS_PAGE_NUMBER', section_marker: 'SECTION_MARKER',
  nonbreaking_space: 'NONBREAKING_SPACE', fixed_nonbreaking_space: 'FIXED_WIDTH_NONBREAKING_SPACE',
  thin_space: 'THIN_SPACE', hair_space: 'HAIR_SPACE', em_space: 'EM_SPACE', en_space: 'EN_SPACE', figure_space: 'FIGURE_SPACE', punctuation_space: 'PUNCTUATION_SPACE', flush_space: 'FLUSH_SPACE',
  em_dash: 'EM_DASH', en_dash: 'EN_DASH', discretionary_hyphen: 'DISCRETIONARY_HYPHEN', nonbreaking_hyphen: 'NONBREAKING_HYPHEN',
  forced_line_break: 'FORCED_LINE_BREAK', column_break: 'COLUMN_BREAK', frame_break: 'FRAME_BREAK', page_break: 'PAGE_BREAK', odd_page_break: 'ODD_PAGE_BREAK', even_page_break: 'EVEN_PAGE_BREAK',
  right_indent_tab: 'RIGHT_INDENT_TAB', indent_to_here: 'INDENT_HERE_TAB', end_nested_style: 'END_NESTED_STYLE',
  ellipsis: 'ELLIPSIS_CHARACTER', bullet: 'BULLET_CHARACTER', copyright: 'COPYRIGHT_SYMBOL', registered: 'REGISTERED_TRADEMARK', trademark: 'TRADEMARK_SYMBOL',
  section_symbol: 'SECTION_SYMBOL', paragraph_symbol: 'PARAGRAPH_SYMBOL', degree: 'DEGREE_SYMBOL',
  left_double_quote: 'DOUBLE_LEFT_QUOTE', right_double_quote: 'DOUBLE_RIGHT_QUOTE', left_single_quote: 'SINGLE_LEFT_QUOTE', right_single_quote: 'SINGLE_RIGHT_QUOTE',
};

const UI_COLOURS = 'Guide / grid colour name: RED, BLUE, LIGHT_BLUE, GREEN, YELLOW, MAGENTA, CYAN, ORANGE, VIOLET, GRAY, BLACK…';
const where = {
  pages: { type: 'array', items: {}, description: 'Pages as named in InDesign ("12", "+3" = 3rd page of the file, "Tablette:2" = page 2 of an alternate layout)' },
  masters: { type: 'array', items: { type: 'string' }, description: 'Masters (parent pages) by name ("A-Parent"), prefix ("A") or base name: every page of each' },
};

export function createLayoutTools(ctx) {
  const { run, respond, jsStr, jsNum, jsJson } = ctx;

  const definitions = [
    {
      name: 'get_layout_setup',
      modifies: false,
      description: 'The document\'s layout setup in one read: format and orientation, facing pages, binding, start page, intent, bleed and slug, page shuffling, spreads, margins and columns of each master (and of pages that differ), guides, baseline and document grids, sections and page numbering, masters and the pages they apply to, alternate layouts, layers.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'set_document_setup',
      modifies: true,
      description: 'Document setup (File > Document Setup): page size, facing pages, binding direction, start page number, intent, bleed and slug (uniform or per side), page shuffling. Only the values given change. With facing pages, an even start page number puts the first page on the left.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'Page width (mm)' },
          height: { type: 'number', description: 'Page height (mm)' },
          facingPages: { type: 'boolean', description: 'Facing pages (spreads of left and right pages)' },
          binding: { type: 'string', enum: ['left', 'right'], description: 'Binding edge: left (left-to-right reading, the default) or right (right-to-left)' },
          startPageNumber: { type: 'number', description: 'Number of the first page; with facing pages an even number starts on a left page' },
          intent: { type: 'string', enum: ['print', 'web', 'mobile'], description: 'Print (CMYK, mm) or screen (RGB, px)' },
          bleed: { type: 'number', description: 'Bleed on every side (mm)' },
          bleedTop: { type: 'number', description: 'Top bleed (mm)' }, bleedBottom: { type: 'number', description: 'Bottom bleed (mm)' },
          bleedInside: { type: 'number', description: 'Inside (left on single pages)' }, bleedOutside: { type: 'number', description: 'Outside (right on single pages)' },
          slug: { type: 'number', description: 'Slug on every side (mm)' },
          allowPageShuffle: { type: 'boolean', description: 'false: pages keep their spreads when pages are added, removed or moved (needed for spreads of 3+ pages)' },
          adjustLayout: { type: 'boolean', description: 'With a new page size: move and resize the objects, guides and margins with the page (File > Adjust Layout), type size included', default: false },
        },
      },
    },
    {
      name: 'set_margins_columns',
      modifies: true,
      description: 'Margins and columns (Layout > Margins and Columns) of masters and/or pages. Set them on the masters so every page that uses them follows; set them on a page only for an exception. Only the values given change.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          top: { type: 'number', description: 'Top margin (mm)' },
          bottom: { type: 'number', description: 'Bottom margin (mm)' },
          inside: { type: 'number', description: 'Inside margin (mm; left margin on single pages)' },
          outside: { type: 'number', description: 'Outside margin (mm; right margin on single pages)' },
          columns: { type: 'number', description: 'Number of columns' },
          gutter: { type: 'number', description: 'Column gutter (mm)' },
        },
      },
    },
    {
      name: 'create_grid_guides',
      modifies: true,
      description: 'Layout grid as guides (Layout > Create Guides): columns and rows with gutters, inside the margins or across the page, on masters and/or pages. A 12-column grid with a 4–5 mm gutter is the usual base: 2, 3, 4 and 6 columns all fall on it. Guides on a master show on every page that uses it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          columns: { type: 'number', description: 'Columns (e.g. 12, 6, 24); 0 = no vertical guides', default: 12 },
          rows: { type: 'number', description: 'Rows of a modular grid; 0 = none', default: 0 },
          columnGutter: { type: 'number', description: 'Gutter between columns (mm); default: the margins gutter' },
          rowGutter: { type: 'number', description: 'Gutter between rows (mm); default: the column gutter' },
          fitTo: { type: 'string', enum: ['margins', 'page'], description: 'Divide the margin box (default) or the whole page', default: 'margins' },
          replace: { type: 'boolean', description: 'Remove the existing guides of those pages first', default: false },
          color: { type: 'string', description: UI_COLOURS },
        },
      },
    },
    {
      name: 'add_guides',
      modifies: true,
      description: 'Ruler guides at given positions (mm from the page\'s top-left corner) on masters and/or pages.',
      inputSchema: {
        type: 'object',
        properties: {
          ...where,
          vertical: { type: 'array', items: { type: 'number' }, description: 'x positions (mm)' },
          horizontal: { type: 'array', items: { type: 'number' }, description: 'y positions (mm)' },
          acrossSpread: { type: 'boolean', description: 'Guides across the whole spread instead of the page', default: false },
          color: { type: 'string', description: UI_COLOURS },
          locked: { type: 'boolean', description: 'Lock the new guides', default: false },
        },
      },
    },
    {
      name: 'delete_guides',
      modifies: true,
      description: 'Remove ruler guides from masters and/or pages: all, or only vertical / horizontal ones.',
      inputSchema: {
        type: 'object',
        properties: { ...where, orientation: { type: 'string', enum: ['all', 'vertical', 'horizontal'], default: 'all' } },
      },
    },
    {
      name: 'set_grids',
      modifies: true,
      description: 'Baseline grid and document grid (Preferences > Grids), plus guide display. Body text aligns on the baseline grid when its increment equals the body leading (11 pt type on 14 pt leading: increment 14 pt). Only the values given change.',
      inputSchema: {
        type: 'object',
        properties: {
          baselineIncrement: { type: 'number', description: 'Baseline grid increment (pt)' },
          baselineStart: { type: 'number', description: 'Baseline grid start (mm)' },
          baselineRelativeTo: { type: 'string', enum: ['page', 'margin'], description: 'Start measured from the top of the page or the top margin' },
          baselineColor: { type: 'string', description: UI_COLOURS },
          baselineShown: { type: 'boolean', description: 'Show the baseline grid' },
          documentGridEvery: { type: 'number', description: 'Document grid: a gridline every N mm' },
          documentGridSubdivisions: { type: 'number', description: 'Subdivisions between gridlines' },
          documentGridShown: { type: 'boolean', description: 'Show the document grid' },
          snapToDocumentGrid: { type: 'boolean', description: 'Snap objects to the document grid' },
          guidesInBack: { type: 'boolean', description: 'Guides and grids behind the objects' },
        },
      },
    },
    {
      name: 'set_section',
      modifies: true,
      description: 'Start a section at a page (Numbering & Section Options): page numbering restart, style (1, 01, i, I, a, A), prefix and section marker. The page numbers shown by page-number characters follow it. remove: true removes the section that starts at that page (the first page always keeps one).',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page where the section starts (as named in InDesign, or "+N")' },
          startNumber: { type: 'number', description: 'Restart numbering at this number (omit to continue from the previous section)' },
          style: { type: 'string', enum: Object.keys(NUMBER_STYLES), description: 'Number style: 1, 01, 001, 0001, i, I, a, A' },
          prefix: { type: 'string', description: 'Section prefix (e.g. "A-")' },
          includePrefix: { type: 'boolean', description: 'Show the prefix in page numbers on the pages' },
          marker: { type: 'string', description: 'Section marker text (shown by the section_marker character)' },
          remove: { type: 'boolean', description: 'Remove the section that starts at this page', default: false },
        },
        required: ['page'],
      },
    },
    {
      name: 'insert_special_character',
      modifies: true,
      description: 'Insert a special character in a text frame: page numbers (page_number = current page, which updates when pages move; next/previous_page_number for "continued on"), section_marker, typographic spaces (fixed_nonbreaking_space = U+202F, the French space before ; : ! ? and inside « », nonbreaking_space stretches with justification, thin, hair, em, en, figure), dashes, discretionary / nonbreaking hyphens, breaks (column, frame, page, odd/even page, forced line), right_indent_tab, indent_to_here, end_nested_style, symbols. Folios: put page_number in a frame on the master. Where: at the end (default) or start of the story, or after / before / instead of a text.',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Text frame id (its story)' },
          character: { type: 'string', enum: Object.keys(SPECIAL_CHARACTERS) },
          position: { type: 'string', enum: ['end', 'start'], default: 'end' },
          after: { type: 'string', description: 'Insert after the first occurrence of this text' },
          before: { type: 'string', description: 'Insert before the first occurrence of this text' },
          replace: { type: 'string', description: 'Replace every occurrence of this text with the character (e.g. a typed folio "12" by page_number)' },
        },
        required: ['frameId', 'character'],
      },
    },
    {
      name: 'set_spread_options',
      modifies: true,
      description: 'Spreads: keep the spreads of these pages together (allowShuffle: false, an "island spread" that stays as it is when pages are added or moved), or let them reflow again; join pages into one spread (a gatefold of 3 or 4 pages: joinPages, in reading order).',
      inputSchema: {
        type: 'object',
        properties: {
          pages: where.pages,
          allowShuffle: { type: 'boolean', description: 'false keeps each spread of these pages together' },
          joinPages: { type: 'array', items: {}, description: 'Pages to gather into the spread of the first one, in order (e.g. ["4", "5", "6"])' },
        },
      },
    },
  ];

  const readPages = async () => parsePageLines(await run(PAGES_SCRIPT));
  // pages refs -> 0-based indexes (resolved like every other tool: names, "+N", "Layout:name")
  const pageIndexes = async (refs) => (Array.isArray(refs) && refs.length ? resolvePageRefs(refs, await readPages()).map((p) => p.index) : []);
  const targets = async (args) => {
    const idx = await pageIndexes(args.pages);
    const masters = Array.isArray(args.masters) ? args.masters.map(String) : [];
    if (!idx.length && !masters.length) throw new Error('Say where: pages (as named in InDesign) and/or masters (e.g. ["A"])');
    return `__targetPages(doc, ${jsJson(idx)}, ${jsJson(masters)})`;
  };
  const colour = (name, label) => {
    if (!has(name)) return null;
    const c = String(name).toUpperCase().replace(/[\s-]+/g, '_');
    if (!/^[A-Z_]+$/.test(c)) throw new Error(`Invalid ${label}: ${name}`);
    return `(function () { var c; try { c = UIColors[${jsStr(c)}]; } catch (e) {} if (c === undefined) throw new Error("Unknown colour: " + ${jsStr(name)} + " (examples: RED, BLUE, LIGHT_BLUE, GREEN, MAGENTA, CYAN, GRAY)"); return c; })()`;
  };
  const num = (v, label, { min = -Infinity, max = Infinity } = {}) => {
    const n = jsNum(v, label);
    if (n < min || n > max) throw new Error(`Invalid ${label}: ${v} (${min} to ${max})`);
    return n;
  };

  const handlers = {};

  handlers.get_layout_setup = async () => respond(await run(`
    var doc = __requireDoc();
    ${LAYOUT_JS}
    var L = [], dp = doc.documentPreferences;
    var facing = dp.facingPages;
    // with alternate layouts, page names repeat: name pages "Layout:page"
    var __lays = {}, __nl = 0;
    for (var s0 = 0; s0 < doc.sections.length; s0++) if (!__lays[doc.sections[s0].alternateLayout]) { __lays[doc.sections[s0].alternateLayout] = 1; __nl++; }
    function __lay(pg) { try { return pg.appliedAlternateLayout.alternateLayout; } catch (e) { return ""; } }
    function __ref(pg) { return __nl > 1 ? __lay(pg) + ":" + pg.name : pg.name; }
    var w = dp.pageWidth, h = dp.pageHeight;
    var intent = String(dp.intent).replace("_INTENT", "").toLowerCase();
    L.push("Format: " + __mm(w) + " × " + __mm(h) + " mm " + (w > h ? "landscape" : (w < h ? "portrait" : "square")) + ", " + doc.pages.length + " pages, " + (facing ? "facing pages" : "single pages") +
      ", binding " + (String(dp.pageBinding) === "RIGHT_TO_LEFT" ? "right (right-to-left)" : "left (left-to-right)") + ", starts at page " + dp.startPageNumber + ", intent " + intent);
    L.push("Bleed: top " + __mm(dp.documentBleedTopOffset) + " · bottom " + __mm(dp.documentBleedBottomOffset) + " · " + (facing ? "inside " : "left ") + __mm(dp.documentBleedInsideOrLeftOffset) + " · " + (facing ? "outside " : "right ") + __mm(dp.documentBleedOutsideOrRightOffset) + " mm" +
      " | Slug: top " + __mm(dp.slugTopOffset) + " · bottom " + __mm(dp.slugBottomOffset) + " · " + __mm(dp.slugInsideOrLeftOffset) + " · " + __mm(dp.slugRightOrOutsideOffset) + " mm");
    var spr = [], fixed = [], lastLay = null;
    for (var s = 0; s < doc.spreads.length; s++) {
      var sp = doc.spreads[s], nm = [];
      for (var q = 0; q < sp.pages.length; q++) nm.push(sp.pages[q].name);
      var ly0 = __lay(sp.pages[0]);
      spr.push((__nl > 1 && ly0 !== lastLay ? "[" + ly0 + "] " : "") + nm.join(" "));
      lastLay = ly0;
      if (sp.allowPageShuffle === false) fixed.push((__nl > 1 ? ly0 + ":" : "") + nm.join("-"));
    }
    L.push("Spreads (" + doc.spreads.length + "): " + spr.join(" | ") + (dp.allowPageShuffle ? "" : " — page shuffling off") + (fixed.length ? " — kept together: " + fixed.join(", ") : ""));
    // pages whose size differs from the first page of their layout
    var odd = [], first = {};
    for (var p = 0; p < doc.pages.length; p++) {
      var pb = doc.pages[p].bounds, pw = pb[3] - pb[1], ph = pb[2] - pb[0], lk = __lay(doc.pages[p]);
      if (!first[lk]) { first[lk] = [pw, ph]; if (__nl > 1) L.push("Layout " + lk + ": " + __mm(pw) + " × " + __mm(ph) + " mm"); continue; }
      if (Math.abs(pw - first[lk][0]) > 0.1 || Math.abs(ph - first[lk][1]) > 0.1) odd.push(__ref(doc.pages[p]) + " (" + __mm(pw) + "×" + __mm(ph) + ")");
    }
    if (odd.length) L.push("Pages of another size: " + odd.join(", "));
    var gp = doc.gridPreferences;
    L.push("Baseline grid: every " + (Math.round(gp.baselineDivision / 25.4 * 72 * 100) / 100) + " pt from " + __mm(gp.baselineStart) + " mm (" + (String(gp.baselineGridRelativeOption).indexOf("MARGIN") >= 0 ? "top margin" : "top of page") + ")" + (gp.baselineGridShown ? ", shown" : ", hidden"));
    L.push("Document grid: every " + __mm(gp.horizontalGridlineDivision) + " mm, " + gp.horizontalGridSubdivision + " subdivisions" + (gp.documentGridShown ? ", shown" : ", hidden") + (gp.documentGridSnapto ? ", snap on" : ""));
    // masters
    L.push("Masters (parent pages):");
    var usage = {};
    for (var u = 0; u < doc.pages.length; u++) { var am = doc.pages[u].appliedMaster; var key = am && am.isValid ? am.name : "[None]"; (usage[key] = usage[key] || []).push(__ref(doc.pages[u])); }
    for (var m = 0; m < doc.masterSpreads.length; m++) {
      var ms = doc.masterSpreads[m], items = 0, guides = 0;
      for (var mq = 0; mq < ms.pages.length; mq++) guides += ms.pages[mq].guides.length;
      items = ms.allPageItems.length;
      var based = "";
      try { if (ms.appliedMaster && ms.appliedMaster.isValid) based = ", based on " + ms.appliedMaster.name; } catch (e) {}
      L.push("  " + ms.name + " (" + ms.pages.length + " page" + (ms.pages.length > 1 ? "s" : "") + based + ") – " + __describeMargins(ms.pages[ms.pages.length - 1]) + "; " + items + " object(s), " + guides + " guide(s); used by: " + (usage[ms.name] ? usage[ms.name].join(", ") : "no page"));
    }
    if (usage["[None]"]) L.push("  [None]: " + usage["[None]"].join(", "));
    // pages whose margins / columns differ from their master's page of the same side
    var diff = [];
    for (var d = 0; d < doc.pages.length; d++) {
      var pg = doc.pages[d], mm = pg.appliedMaster;
      if (!mm || !mm.isValid) continue;
      var ref = mm.pages[mm.pages.length - 1];
      for (var r = 0; r < mm.pages.length; r++) if (String(mm.pages[r].side) === String(pg.side)) ref = mm.pages[r];
      var a = pg.marginPreferences, b = ref.marginPreferences;
      if (Math.abs(a.top - b.top) > 0.05 || Math.abs(a.bottom - b.bottom) > 0.05 || Math.abs(a.left - b.left) > 0.05 || Math.abs(a.right - b.right) > 0.05 || a.columnCount !== b.columnCount || Math.abs(a.columnGutter - b.columnGutter) > 0.05) diff.push("page " + __ref(pg) + ": " + __describeMargins(pg));
    }
    if (diff.length) L.push("Pages with their own margins / columns: " + diff.join("; "));
    var pg_guides = [];
    for (var g = 0; g < doc.pages.length; g++) if (doc.pages[g].guides.length) pg_guides.push(__ref(doc.pages[g]) + " (" + doc.pages[g].guides.length + ")");
    if (pg_guides.length) L.push("Pages with their own guides: " + pg_guides.join(", "));
    // sections and alternate layouts
    var styles = { ARABIC: "1", SINGLE_LEADING_ZEROS: "01", DOUBLE_LEADING_ZEROS: "001", TRIPLE_LEADING_ZEROS: "0001", LOWER_ROMAN: "i", UPPER_ROMAN: "I", LOWER_LETTERS: "a", UPPER_LETTERS: "A" };
    var secs = [], layouts = [];
    for (var k = 0; k < doc.sections.length; k++) {
      var sc = doc.sections[k];
      var st = styles[String(sc.pageNumberStyle)] || String(sc.pageNumberStyle).toLowerCase();
      secs.push("from page +" + (sc.pageStart.documentOffset + 1) + " (" + sc.pageStart.name + "): " + (sc.continueNumbering ? "continues" : "starts at " + sc.pageNumberStart) + ", style " + st +
        (sc.sectionPrefix ? ", prefix \\"" + sc.sectionPrefix + "\\"" + (sc.includeSectionPrefix ? " shown" : "") : "") + (sc.marker ? ", marker \\"" + sc.marker + "\\"" : "") + (sc.alternateLayout ? ", layout " + sc.alternateLayout : ""));
      if (sc.alternateLayout) {
        var last = layouts.length ? layouts[layouts.length - 1] : null;
        if (last && last.name === sc.alternateLayout) last.count += sc.length; else layouts.push({ name: sc.alternateLayout, first: sc.pageStart.documentOffset + 1, count: sc.length });
      }
    }
    L.push("Sections: " + secs.join("; "));
    if (layouts.length > 1) {
      var lo = [];
      for (var y = 0; y < layouts.length; y++) lo.push(layouts[y].name + " (pages +" + layouts[y].first + "–+" + (layouts[y].first + layouts[y].count - 1) + ")");
      L.push("Alternate layouts: " + lo.join(", ") + ". Address their pages as \\"Layout:page\\".");
    } else if (layouts.length === 1) L.push("Alternate layouts: one (" + layouts[0].name + ")");
    var ly = [];
    for (var z = 0; z < doc.layers.length; z++) { var la = doc.layers[z]; ly.push(la.name + (la.visible ? "" : " (hidden)") + (la.locked ? " (locked)" : "") + (la.printable ? "" : " (non-printing)")); }
    L.push("Layers (top first): " + ly.join(", "));
    L.join("\\n");
  `), 'Layout Setup');

  handlers.set_document_setup = async (args) => {
    const set = [];
    const mm = (k, prop, opts) => { if (has(args[k])) set.push(`dp.${prop} = ${num(args[k], k, opts)};`); };
    mm('width', 'pageWidth', { min: 1, max: 5486 });
    mm('height', 'pageHeight', { min: 1, max: 5486 });
    if (has(args.facingPages)) set.push(`dp.facingPages = ${args.facingPages ? 'true' : 'false'};`);
    if (has(args.binding)) set.push(`dp.pageBinding = PageBindingOptions.${args.binding === 'right' ? 'RIGHT_TO_LEFT' : 'LEFT_TO_RIGHT'};`);
    if (has(args.startPageNumber)) set.push(`dp.startPageNumber = ${num(args.startPageNumber, 'startPageNumber', { min: 1, max: 999999 })};`);
    if (has(args.intent)) set.push(`dp.intent = DocumentIntentOptions.${{ print: 'PRINT_INTENT', web: 'WEB_INTENT', mobile: 'MOBILE_INTENT' }[args.intent]};`);
    if (has(args.bleed)) {
      const b = num(args.bleed, 'bleed', { min: 0, max: 152.4 });
      set.push(`dp.documentBleedUniformSize = true; dp.documentBleedTopOffset = ${b};`);
    }
    const sides = [['bleedTop', 'documentBleedTopOffset'], ['bleedBottom', 'documentBleedBottomOffset'], ['bleedInside', 'documentBleedInsideOrLeftOffset'], ['bleedOutside', 'documentBleedOutsideOrRightOffset']];
    if (sides.some(([k]) => has(args[k]))) {
      set.push('dp.documentBleedUniformSize = false;');
      for (const [k, prop] of sides) mm(k, prop, { min: 0, max: 152.4 });
    }
    if (has(args.slug)) {
      const s = num(args.slug, 'slug', { min: 0, max: 500 });
      set.push(`dp.documentSlugUniformSize = true; dp.slugTopOffset = ${s};`);
    }
    if (has(args.allowPageShuffle)) set.push(`dp.allowPageShuffle = ${args.allowPageShuffle ? 'true' : 'false'};`);
    if (!set.length) throw new Error('Nothing to change: pass at least one setting (width, height, facingPages, binding, startPageNumber, intent, bleed…, slug, allowPageShuffle)');
    const adjust = args.adjustLayout === true;
    if (adjust && !has(args.width) && !has(args.height)) throw new Error('adjustLayout goes with a new width and/or height');
    const out = await run(`
      var doc = __requireDoc();
      var dp = doc.documentPreferences;
      ${adjust ? `var alp = doc.adjustLayoutPreferences, __al = [alp.enableAdjustLayout, alp.allowFontSizeAndLeadingAdjustment, alp.enableAutoAdjustMargins];
      alp.enableAdjustLayout = true; alp.allowFontSizeAndLeadingAdjustment = true; alp.enableAutoAdjustMargins = true;
      try {` : ''}
      ${set.join('\n      ')}
      ${adjust ? '} finally { alp.enableAdjustLayout = __al[0]; alp.allowFontSizeAndLeadingAdjustment = __al[1]; alp.enableAutoAdjustMargins = __al[2]; }' : ''}
      "Document setup: " + dp.pageWidth.toFixed(1) + " × " + dp.pageHeight.toFixed(1) + " mm, " + (dp.facingPages ? "facing pages" : "single pages") + ", binding " + String(dp.pageBinding).toLowerCase() +
        ", start page " + dp.startPageNumber + ", bleed " + dp.documentBleedTopOffset.toFixed(1) + "/" + dp.documentBleedBottomOffset.toFixed(1) + "/" + dp.documentBleedInsideOrLeftOffset.toFixed(1) + "/" + dp.documentBleedOutsideOrRightOffset.toFixed(1) +
        " mm (top/bottom/inside/outside), slug " + dp.slugTopOffset.toFixed(1) + " mm, " + doc.pages.length + " pages in " + doc.spreads.length + " spreads";
    `);
    return respond(out, 'Document Setup');
  };

  handlers.set_margins_columns = async (args) => {
    const set = [];
    for (const [k, prop] of [['top', 'top'], ['bottom', 'bottom'], ['inside', 'left'], ['outside', 'right']]) {
      if (has(args[k])) set.push(`mp.${prop} = ${num(args[k], k, { min: 0, max: 5000 })};`);
    }
    if (has(args.columns)) set.push(`mp.columnCount = ${num(args.columns, 'columns', { min: 1, max: 216 })};`);
    if (has(args.gutter)) set.push(`mp.columnGutter = ${num(args.gutter, 'gutter', { min: 0, max: 5000 })};`);
    if (!set.length) throw new Error('Nothing to change: pass top, bottom, inside, outside, columns and/or gutter');
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var pgs = ${await targets(args)}, done = [];
      for (var i = 0; i < pgs.length; i++) {
        var mp = pgs[i].marginPreferences;
        ${set.join(' ')}
        done.push(__pageLabel(pgs[i]) + ": " + __describeMargins(pgs[i]));
      }
      done.join("\\n");
    `);
    return respond(out, 'Margins and Columns');
  };

  handlers.create_grid_guides = async (args) => {
    const cols = num(args.columns ?? 12, 'columns', { min: 0, max: 200 });
    const rows = num(args.rows ?? 0, 'rows', { min: 0, max: 200 });
    if (!cols && !rows) throw new Error('columns and rows are both 0: nothing to draw');
    const cg = has(args.columnGutter) ? num(args.columnGutter, 'columnGutter', { min: 0, max: 500 }) : null;
    const rg = has(args.rowGutter) ? num(args.rowGutter, 'rowGutter', { min: 0, max: 500 }) : null;
    const col = colour(args.color, 'color');
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var pgs = ${await targets(args)}, done = [];
      for (var i = 0; i < pgs.length; i++) {
        var pg = pgs[i];
        ${args.replace ? 'pg.guides.everyItem().remove();' : ''}
        var box = __marginBox(pg);
        ${args.fitTo === 'page' ? 'box = { top: 0, left: 0, bottom: box.height, right: box.width };' : ''}
        var cgut = ${cg === null ? 'pg.marginPreferences.columnGutter' : cg};
        var rgut = ${rg === null ? 'cgut' : rg};
        var props = {};
        ${col ? `props.guideColor = ${col};` : ''}
        var n = 0, positions = [];
        // columns: an edge guide on each side of every gutter, plus the outer edges
        var C = ${cols}, R = ${rows};
        if (C > 0) {
          var cw = (box.right - box.left - (C - 1) * cgut) / C;
          if (cw <= 0) throw new Error("Columns do not fit: " + C + " columns with a " + cgut + " mm gutter in " + __mm(box.right - box.left) + " mm (" + __pageLabel(pg) + ")");
          for (var c = 0; c <= C; c++) {
            var xs = c === 0 ? [box.left] : (c === C ? [box.right] : [box.left + c * cw + (c - 1) * cgut, box.left + c * (cw + cgut)]);
            for (var a = 0; a < xs.length; a++) { props.orientation = HorizontalOrVertical.VERTICAL; props.location = xs[a]; pg.guides.add(undefined, props); n++; }
          }
          positions.push(C + " columns of " + __mm(cw) + " mm, gutter " + __mm(cgut) + " mm");
        }
        if (R > 0) {
          var rh = (box.bottom - box.top - (R - 1) * rgut) / R;
          if (rh <= 0) throw new Error("Rows do not fit: " + R + " rows with a " + rgut + " mm gutter in " + __mm(box.bottom - box.top) + " mm (" + __pageLabel(pg) + ")");
          for (var r = 0; r <= R; r++) {
            var ys = r === 0 ? [box.top] : (r === R ? [box.bottom] : [box.top + r * rh + (r - 1) * rgut, box.top + r * (rh + rgut)]);
            for (var b = 0; b < ys.length; b++) { props.orientation = HorizontalOrVertical.HORIZONTAL; props.location = ys[b]; pg.guides.add(undefined, props); n++; }
          }
          positions.push(R + " rows of " + __mm(rh) + " mm, gutter " + __mm(rgut) + " mm");
        }
        done.push(__pageLabel(pg) + ": " + n + " guides – " + positions.join(", ") + " (" + ${args.fitTo === 'page' ? '"page"' : '"margins"'} + " x " + __mm(box.left) + "–" + __mm(box.right) + ", y " + __mm(box.top) + "–" + __mm(box.bottom) + " mm)");
      }
      done.join("\\n");
    `);
    return respond(out, 'Grid Guides');
  };

  handlers.add_guides = async (args) => {
    const xs = (args.vertical || []).map((v) => num(v, 'vertical', { min: -5000, max: 5000 }));
    const ys = (args.horizontal || []).map((v) => num(v, 'horizontal', { min: -5000, max: 5000 }));
    if (!xs.length && !ys.length) throw new Error('Give vertical and/or horizontal positions (mm)');
    const col = colour(args.color, 'color');
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var pgs = ${await targets(args)}, done = [];
      var xs = ${jsJson(xs)}, ys = ${jsJson(ys)};
      for (var i = 0; i < pgs.length; i++) {
        var props = { fitToPage: ${args.acrossSpread ? 'false' : 'true'}, locked: ${args.locked ? 'true' : 'false'} };
        ${col ? `props.guideColor = ${col};` : ''}
        for (var a = 0; a < xs.length; a++) { props.orientation = HorizontalOrVertical.VERTICAL; props.location = xs[a]; pgs[i].guides.add(undefined, props); }
        for (var b = 0; b < ys.length; b++) { props.orientation = HorizontalOrVertical.HORIZONTAL; props.location = ys[b]; pgs[i].guides.add(undefined, props); }
        done.push(__pageLabel(pgs[i]));
      }
      (xs.length + ys.length) + " guide(s) added on " + done.join(", ");
    `);
    return respond(out, 'Add Guides');
  };

  handlers.delete_guides = async (args) => {
    const o = args.orientation || 'all';
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var pgs = ${await targets(args)}, done = [];
      for (var i = 0; i < pgs.length; i++) {
        var n = 0, gs = pgs[i].guides;
        for (var g = gs.length - 1; g >= 0; g--) {
          var ori = String(gs[g].orientation);
          ${o === 'all' ? '' : `if (ori !== ${jsStr(o.toUpperCase())}) continue;`}
          if (gs[g].locked) gs[g].locked = false;
          gs[g].remove(); n++;
        }
        done.push(__pageLabel(pgs[i]) + ": " + n);
      }
      "Guides removed – " + done.join(", ");
    `);
    return respond(out, 'Delete Guides');
  };

  handlers.set_grids = async (args) => {
    const set = [];
    if (has(args.baselineIncrement)) set.push(`gp.baselineDivision = "${num(args.baselineIncrement, 'baselineIncrement', { min: 1, max: 1000 })}pt";`);
    if (has(args.baselineStart)) set.push(`gp.baselineStart = ${num(args.baselineStart, 'baselineStart', { min: 0, max: 5000 })};`);
    if (has(args.baselineRelativeTo)) set.push(`gp.baselineGridRelativeOption = BaselineGridRelativeOption.${args.baselineRelativeTo === 'margin' ? 'TOP_OF_MARGIN_OF_BASELINE_GRID_RELATIVE_OPTION' : 'TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION'};`);
    const bc = colour(args.baselineColor, 'baselineColor');
    if (bc) set.push(`gp.baselineColor = ${bc};`);
    if (has(args.baselineShown)) set.push(`gp.baselineGridShown = ${args.baselineShown ? 'true' : 'false'};`);
    if (has(args.documentGridEvery)) {
      const e = num(args.documentGridEvery, 'documentGridEvery', { min: 0.1, max: 5000 });
      set.push(`gp.horizontalGridlineDivision = ${e}; gp.verticalGridlineDivision = ${e};`);
    }
    if (has(args.documentGridSubdivisions)) {
      const s = num(args.documentGridSubdivisions, 'documentGridSubdivisions', { min: 1, max: 1000 });
      set.push(`gp.horizontalGridSubdivision = ${s}; gp.verticalGridSubdivision = ${s};`);
    }
    if (has(args.documentGridShown)) set.push(`gp.documentGridShown = ${args.documentGridShown ? 'true' : 'false'};`);
    if (has(args.snapToDocumentGrid)) set.push(`gp.documentGridSnapto = ${args.snapToDocumentGrid ? 'true' : 'false'};`);
    if (has(args.guidesInBack)) set.push(`gp.gridsInBack = ${args.guidesInBack ? 'true' : 'false'}; try { doc.guidePreferences.guidesInBack = ${args.guidesInBack ? 'true' : 'false'}; } catch (e) {}`);
    if (!set.length) throw new Error('Nothing to change: pass a baseline* or documentGrid* setting');
    const out = await run(`
      var doc = __requireDoc();
      var gp = doc.gridPreferences;
      ${set.join('\n      ')}
      // baselineDivision reads back in the document's units (mm): show it in points as well
      var incPt = Math.round(gp.baselineDivision / 25.4 * 72 * 100) / 100;
      "Baseline grid: every " + incPt + " pt (" + (Math.round(gp.baselineDivision * 100) / 100) + " mm) from " + (Math.round(gp.baselineStart * 10) / 10) + " mm (" + (String(gp.baselineGridRelativeOption).indexOf("MARGIN") >= 0 ? "top margin" : "top of page") + "), " + (gp.baselineGridShown ? "shown" : "hidden") +
        "; document grid every " + gp.horizontalGridlineDivision + " mm / " + gp.horizontalGridSubdivision + (gp.documentGridShown ? ", shown" : ", hidden");
    `);
    return respond(out, 'Grids');
  };

  handlers.set_section = async (args) => {
    const [page] = resolvePageRefs([args.page], await readPages());
    const props = [];
    if (has(args.startNumber)) props.push(`continueNumbering: false, pageNumberStart: ${num(args.startNumber, 'startNumber', { min: 1, max: 999999 })}`);
    if (has(args.style)) props.push(`pageNumberStyle: PageNumberStyle.${NUMBER_STYLES[args.style]}`);
    if (has(args.prefix)) props.push(`sectionPrefix: ${jsStr(args.prefix)}`);
    if (has(args.includePrefix)) props.push(`includeSectionPrefix: ${args.includePrefix ? 'true' : 'false'}`);
    if (has(args.marker)) props.push(`marker: ${jsStr(args.marker)}`);
    const out = await run(`
      var doc = __requireDoc();
      var pg = doc.pages[${page.index}];
      var sec = pg.appliedSection, starts = sec.pageStart.id === pg.id;
      ${args.remove ? `
        if (!starts) throw new Error("No section starts at page " + pg.name);
        if (pg.documentOffset === 0) throw new Error("The first page always starts a section: change it instead of removing it");
        sec.remove();
      ` : `
        var props = { ${props.join(', ')} };
        if (starts) sec.properties = props;
        else sec = doc.sections.add(pg, props);
        ${has(args.startNumber) ? '' : 'if (!starts && props.pageNumberStart === undefined) sec.continueNumbering = true;'}
      `}
      var names = [];
      for (var i = 0; i < doc.pages.length; i++) names.push(doc.pages[i].name);
      var styles = ${jsJson(Object.fromEntries(Object.entries(NUMBER_STYLES).map(([k, v]) => [v, k])))};
      ${args.remove ? '"Section removed."' : '"Section from page +" + (pg.documentOffset + 1) + ": " + (sec.continueNumbering ? "continues" : "starts at " + sec.pageNumberStart) + ", style " + (styles[String(sec.pageNumberStyle)] || String(sec.pageNumberStyle).toLowerCase()) + (sec.marker ? ", marker \\"" + sec.marker + "\\"" : "") + "."'} + " Page names now: " + (names.length > 40 ? names.slice(0, 20).join(", ") + " … " + names.slice(-10).join(", ") : names.join(", "));
    `);
    return respond(out, 'Section');
  };

  handlers.insert_special_character = async (args) => {
    const spec = SPECIAL_CHARACTERS[args.character];
    if (!spec) throw new Error(`Unknown character: ${args.character}. Characters: ${Object.keys(SPECIAL_CHARACTERS).join(', ')}`);
    const value = /^[A-Z_]+$/.test(spec) ? `SpecialCharacters.${spec}` : jsStr(spec);
    const modes = ['after', 'before', 'replace'].filter((k) => has(args[k]));
    if (modes.length > 1) throw new Error('Give only one of after, before or replace');
    const mode = modes[0] || args.position || 'end';
    const needle = modes.length ? String(args[mode]) : '';
    if (modes.length && !needle) throw new Error(`${mode} must not be empty`);
    const out = await run(`
      var doc = __requireDoc();
      var frame = __findById(doc, ${num(args.frameId, 'frameId')});
      if (!frame || frame.constructor.name !== "TextFrame") throw new Error("No text frame with id " + ${num(args.frameId, 'frameId')});
      var story = frame.parentStory, n = 0;
      var mode = ${jsStr(mode)}, needle = ${jsStr(needle)};
      if (mode === "end") { story.insertionPoints[-1].contents = ${value}; n = 1; }
      else if (mode === "start") { story.insertionPoints[0].contents = ${value}; n = 1; }
      else {
        var text = story.contents, at = text.indexOf(needle);
        if (at < 0) throw new Error("Text not found in the story of frame " + frame.id + ": " + needle);
        if (mode === "after") { story.insertionPoints[at + needle.length].contents = ${value}; n = 1; }
        else if (mode === "before") { story.insertionPoints[at].contents = ${value}; n = 1; }
        else {
          // last occurrence first, so earlier indexes stay valid
          var hits = [];
          while (at >= 0) { hits.push(at); at = text.indexOf(needle, at + needle.length); }
          for (var h = hits.length - 1; h >= 0; h--) {
            var ch = story.characters.itemByRange(hits[h], hits[h] + needle.length - 1);
            ch.contents = ${value};
            n++;
          }
        }
      }
      var pgName = "";
      try { pgName = frame.parentPage ? frame.parentPage.name : "pasteboard"; } catch (e) {}
      n + " × " + ${jsStr(args.character)} + " inserted (" + mode + ") in frame " + frame.id + " on " + (pgName.length ? pgName : "?") + (frame.overflows ? " – the text now overflows" : "");
    `);
    return respond(out, 'Special Character');
  };

  handlers.set_spread_options = async (args) => {
    if (!has(args.allowShuffle) && !(args.joinPages || []).length) throw new Error('Pass allowShuffle and/or joinPages');
    const pages = await readPages();
    const idx = Array.isArray(args.pages) && args.pages.length ? resolvePageRefs(args.pages, pages).map((p) => p.index) : [];
    const join = Array.isArray(args.joinPages) && args.joinPages.length ? resolvePageRefs(args.joinPages, pages).map((p) => p.index) : [];
    if (has(args.allowShuffle) && !idx.length && !join.length) throw new Error('Say which pages: pages (their spreads are kept together or freed)');
    if (join.length === 1) throw new Error('joinPages needs at least two pages');
    const out = await run(`
      var doc = __requireDoc();
      var lines = [];
      var idx = ${jsJson(idx)}, join = ${jsJson(join)};
      ${has(args.allowShuffle) ? `
        for (var i = 0; i < idx.length; i++) doc.pages[idx[i]].parent.allowPageShuffle = ${args.allowShuffle ? 'true' : 'false'};
        lines.push("Spreads of " + idx.length + " page(s): " + (${args.allowShuffle ? 'true' : 'false'} ? "reflow freely" : "kept together"));
      ` : ''}
      if (join.length) {
        // pages are moved one by one after the previous one, into the first page's spread;
        // that spread must not reshuffle, or InDesign splits it again
        var ids = [];
        for (var j = 0; j < join.length; j++) ids.push(doc.pages[join[j]].id);
        var first = doc.pages.itemByID(ids[0]);
        first.parent.allowPageShuffle = false;
        for (var k = 1; k < ids.length; k++) {
          var pg = doc.pages.itemByID(ids[k]), prev = doc.pages.itemByID(ids[k - 1]);
          pg.move(LocationOptions.AFTER, prev);
        }
        var sp = doc.pages.itemByID(ids[0]).parent, names = [];
        for (var q = 0; q < sp.pages.length; q++) names.push(sp.pages[q].name);
        lines.push("Spread now holds pages " + names.join(", ") + " (kept together)");
      }
      var spr = [];
      for (var s = 0; s < doc.spreads.length; s++) { var nm = []; for (var t = 0; t < doc.spreads[s].pages.length; t++) nm.push(doc.spreads[s].pages[t].name); spr.push(nm.join(" ")); }
      lines.push("Spreads: " + spr.join(" | "));
      lines.join("\\n");
    `);
    return respond(out, 'Spread Options');
  };

  return { definitions, handlers };
}
