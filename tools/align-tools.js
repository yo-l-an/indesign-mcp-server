// Alignment on the page's structure: margins, columns, rows, ruler guides (the page's and its
// master's), baseline grid, page edges and centre, bleed.
//
//   get_page_grid   every reference line of a page, with its position
//   snap_to_grid    objects a few mm off a line are moved (or resized) onto it
//   fit_to_grid     objects placed on columns / rows: span them, or align to their start / end / centre
//
// Each alignment is remembered for the current task (workflow.alignments, by snapshot), so
// review_compare draws the lines used on the BEFORE and AFTER images and labels the object with an
// alignment icon.

import { PAGES_SCRIPT, parsePageLines, resolvePageRefs } from './review-tools.js';
import { LAYOUT_JS } from './layout-tools.js';
import { has } from '../lib/tool-context.js';

const KINDS = ['margin', 'column', 'guide', 'page', 'bleed', 'baseline'];

// ES3: reference lines of a page -> [{ o: "v" | "h", pos, kind, n }] (mm from the page's top-left)
const LINES_JS = `
  function __refLines(doc, pg, want) {
    var out = [], seen = {};
    function add(o, pos, kind, n) {
      var key = o + Math.round(pos * 100);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ o: o, pos: Math.round(pos * 1000) / 1000, kind: kind, n: n || 0 });
    }
    var box = __marginBox(pg), w = box.width, h = box.height, mp = pg.marginPreferences;
    var left = String(pg.side).indexOf("LEFT") === 0;
    if (want.margin) { add("v", box.left, "margin"); add("v", box.right, "margin"); add("h", box.top, "margin"); add("h", box.bottom, "margin"); }
    if (want.column && mp.columnCount > 1) {
      var n = mp.columnCount, g = mp.columnGutter, cw = (box.right - box.left - (n - 1) * g) / n;
      for (var c = 0; c < n; c++) { var x0 = box.left + c * (cw + g); add("v", x0, "column-start", c + 1); add("v", x0 + cw, "column-end", c + 1); if (want.center) add("v", x0 + cw / 2, "column-center", c + 1); }
    }
    if (want.guide) {
      var gs = [], k;
      for (k = 0; k < pg.guides.length; k++) gs.push([pg.guides[k], "guide"]);
      try {
        var m = pg.appliedMaster;
        if (m && m.isValid) {
          var mpg = m.pages[m.pages.length - 1];
          for (var q = 0; q < m.pages.length; q++) if (String(m.pages[q].side) === String(pg.side)) mpg = m.pages[q];
          for (k = 0; k < mpg.guides.length; k++) gs.push([mpg.guides[k], "master-guide"]);
        }
      } catch (e) {}
      for (k = 0; k < gs.length; k++) {
        var gd = gs[k][0], vert = String(gd.orientation).indexOf("VERTICAL") === 0;
        add(vert ? "v" : "h", gd.location, gs[k][1]);
      }
    }
    if (want.page) { add("v", 0, "page-edge"); add("v", w, "page-edge"); add("v", w / 2, "page-center"); add("h", 0, "page-edge"); add("h", h, "page-edge"); add("h", h / 2, "page-center"); }
    if (want.bleed) {
      var dp = doc.documentPreferences;
      var bl = left ? dp.documentBleedOutsideOrRightOffset : dp.documentBleedInsideOrLeftOffset, br = left ? dp.documentBleedInsideOrLeftOffset : dp.documentBleedOutsideOrRightOffset;
      if (dp.facingPages === false) { bl = dp.documentBleedInsideOrLeftOffset; br = dp.documentBleedOutsideOrRightOffset; }
      if (bl > 0) add("v", -bl, "bleed"); if (br > 0) add("v", w + br, "bleed");
      if (dp.documentBleedTopOffset > 0) add("h", -dp.documentBleedTopOffset, "bleed");
      if (dp.documentBleedBottomOffset > 0) add("h", h + dp.documentBleedBottomOffset, "bleed");
    }
    if (want.baseline) {
      var gp = doc.gridPreferences, inc = gp.baselineDivision, y = gp.baselineStart + (String(gp.baselineGridRelativeOption).indexOf("MARGIN") >= 0 ? box.top : 0), i = 1;
      while (y <= h && inc > 0 && i < 400) { add("h", y, "baseline", i); y += inc; i++; }
    }
    return out;
  }
  function __lineStr(l) { return l.o + ":" + l.pos + ":" + l.kind + ":" + l.n; }
`;

const parseLine = (s) => { const [o, pos, kind, n] = s.split(':'); return { o, pos: Number(pos), kind, n: /^d+$/.test(n) ? Number(n) : (n && n !== '0' ? n.replace('-', '–') : 0) }; };
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const LABELS = { margin: 'margin', 'column-start': 'column start', 'column-end': 'column end', 'column-center': 'column centre', 'row-center': 'row centre', 'row-start': 'row start', 'row-end': 'row end', guide: 'guide', 'master-guide': 'master guide', 'page-edge': 'page edge', 'page-center': 'page centre', bleed: 'bleed', baseline: 'baseline' };
const label = (l) => `${LABELS[l.kind] || l.kind}${l.n ? ` ${l.n}` : ''} (${l.o === 'v' ? 'x' : 'y'} ${fmt(l.pos)})`;

export function createAlignTools(ctx) {
  const { run, respond, jsNum, jsJson } = ctx;
  const idsParam = { type: 'array', items: { type: 'number' }, description: 'Object ids' };

  const definitions = [
    {
      name: 'get_page_grid',
      modifies: false,
      description: 'The reference lines of a page, with their positions in mm: margins, columns (start and end of each), ruler guides of the page and of its master, page edges and centre, bleed, and the baseline grid when asked. Use it before aligning, to name the lines objects should sit on.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page as named in InDesign ("12", "+3", "Tablette:2")' },
          baseline: { type: 'boolean', description: 'Also list the baseline grid lines', default: false },
        },
        required: ['page'],
      },
    },
    {
      name: 'snap_to_grid',
      modifies: true,
      description: 'Snap objects that sit a few mm off the page structure onto it: each edge (left, right, top, bottom) goes to the nearest margin, column edge, guide (page or master), page edge or centre, or bleed within the tolerance; mode center puts the centre of each object on the nearest line instead (column centres included). dryRun: report without changing. The lines used show in the review images.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: idsParam,
          tolerance: { type: 'number', description: 'Maximum distance to a line (mm)', default: 3 },
          targets: { type: 'array', items: { type: 'string', enum: KINDS }, description: `Lines to snap to (default: ${KINDS.slice(0, 5).join(', ')}; baseline on request)` },
          mode: { type: 'string', enum: ['auto', 'move', 'resize', 'center'], description: 'auto: resize when both edges are near lines, else move; move: never resize; resize: each near edge on its own; center: the centre of the object goes to the nearest line (a column centre, the page centre, a guide), size kept', default: 'auto' },
          axis: { type: 'string', enum: ['both', 'x', 'y'], description: 'Snap horizontally (x), vertically (y) or both', default: 'both' },
          dryRun: { type: 'boolean', default: false, description: 'Only report what would move' },
        },
        required: ['ids'],
      },
    },
    {
      name: 'fit_to_grid',
      modifies: true,
      description: 'Place objects on the column grid of their page (margins and columns of the page, set_margins_columns) and, with rowCount, on rows: span columns 3 to 6 (fit: span), or keep the size and align to the start, end or centre of those columns. columns / rows are 1-based and inclusive ([3, 6] = columns 3, 4, 5, 6). The lines used show in the review images.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: idsParam,
          columns: { type: 'array', items: { type: 'number' }, description: '[first, last] column (1-based)' },
          rows: { type: 'array', items: { type: 'number' }, description: '[first, last] row (1-based); needs rowCount' },
          rowCount: { type: 'number', description: 'Rows of the modular grid inside the margins (as in create_grid_guides)' },
          rowGutter: { type: 'number', description: 'Gutter between rows in mm (default: the column gutter)' },
          fit: { type: 'string', enum: ['span', 'start', 'end', 'center'], description: 'span: the object fills the columns / rows; start / end / center: it keeps its size and aligns there', default: 'span' },
        },
        required: ['ids'],
      },
    },
  ];

  const readPages = async () => parsePageLines(await run(PAGES_SCRIPT));
  const ids = (list) => {
    const out = (list || []).map((v) => jsNum(v, 'ids'));
    if (!out.length) throw new Error('ids: the objects to align');
    return out;
  };
  const wantJs = (targets) => {
    const t = Array.isArray(targets) && targets.length ? targets : KINDS.slice(0, 5);
    for (const k of t) if (!KINDS.includes(k)) throw new Error(`Unknown target: ${k} (${KINDS.join(', ')})`);
    return jsJson(Object.fromEntries(t.map((k) => [k, true])));
  };
  // Remember the lines each object was aligned on, for the review of the current task
  const remember = (records) => {
    const snap = ctx.workflow?.lastSnapshot;
    if (!snap || !records.length) return;
    ctx.workflow.alignments ||= new Map();
    if (!ctx.workflow.alignments.has(snap)) ctx.workflow.alignments.set(snap, new Map());
    const m = ctx.workflow.alignments.get(snap);
    // a new alignment on an axis replaces the previous one on that axis
    for (const r of records) {
      const axes = new Set(r.lines.map((l) => l.o));
      m.set(r.id, { lines: [...(m.get(r.id)?.lines || []).filter((l) => !axes.has(l.o)), ...r.lines] });
    }
  };

  const handlers = {};

  handlers.get_page_grid = async (args) => {
    const [page] = resolvePageRefs([args.page], await readPages());
    const out = String(await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${LINES_JS}
      var pg = doc.pages[${page.index}];
      var ls = __refLines(doc, pg, ${jsJson({ margin: true, column: true, guide: true, page: true, bleed: true, baseline: !!args.baseline })}), out = [];
      for (var i = 0; i < ls.length; i++) out.push(__lineStr(ls[i]));
      var b = pg.bounds;
      (Math.round((b[3] - b[1]) * 10) / 10) + "x" + (Math.round((b[2] - b[0]) * 10) / 10) + "|" + __describeMargins(pg) + "\\n" + out.join("\\n");
    `));
    const [head, ...rest] = out.split('\n');
    const [size, margins] = head.split('|');
    const lines = rest.filter(Boolean).map(parseLine);
    const group = (o) => lines.filter((l) => l.o === o).sort((a, b) => a.pos - b.pos).map(label);
    return respond([
      `Page ${page.name}: ${size.replace('x', ' × ')} mm, ${margins}`,
      `Vertical lines (x): ${group('v').join(' · ') || '—'}`,
      `Horizontal lines (y): ${group('h').join(' · ') || '—'}`,
    ].join('\n'), 'Page Grid');
  };

  handlers.snap_to_grid = async (args) => {
    const list = ids(args.ids);
    const tol = has(args.tolerance) ? jsNum(args.tolerance, 'tolerance') : 3;
    if (tol <= 0 || tol > 50) throw new Error('tolerance: 0 to 50 mm');
    const mode = args.mode || 'auto';
    const axis = args.axis || 'both';
    const out = String(await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${LINES_JS}
      var ids = ${jsJson(list)}, tol = ${tol}, mode = ${JSON.stringify(mode)}, axis = ${JSON.stringify(axis)}, dry = ${args.dryRun ? 'true' : 'false'}, want = ${wantJs(args.targets)};
      if (mode === "center") want.center = true;
      // a left / top edge goes to the start of a column or row, a right / bottom edge to its end (never into a gutter)
      function nearest(ls, o, v, side) { var best = null; for (var i = 0; i < ls.length; i++) { if (ls[i].o !== o) continue; var kd = ls[i].kind; if ((side === "lo" && /-end$/.test(kd)) || (side === "hi" && /-start$/.test(kd)) || (side !== "mid" && /-center$/.test(kd)) || (side === "mid" && /-start$|-end$|^margin$|^bleed$|^page-edge$/.test(kd))) continue; var d = Math.abs(ls[i].pos - v); if (d <= tol && (!best || d < best.d)) best = { l: ls[i], d: d }; } return best; }
      var rows = [];
      for (var k = 0; k < ids.length; k++) {
        var it = __findById(doc, ids[k]);
        if (!it) throw new Error("No object with id " + ids[k]);
        var pg = it.parentPage;
        if (!pg) { rows.push(ids[k] + "\\tskip\\ton the pasteboard"); continue; }
        if (Math.abs(it.rotationAngle) > 0.01) { rows.push(ids[k] + "\\tskip\\trotated (" + it.rotationAngle + "°): align it by hand"); continue; }
        var ls = __refLines(doc, pg, want);
        var b = it.geometricBounds, t = b[0], l = b[1], bo = b[2], r = b[3];
        var used = [], nb = [t, l, bo, r], canResize = it.constructor.name !== "Group" && mode !== "move";
        function solve(o, lo, hi, iLo, iHi) {
          if (mode === "center") {
            var m = nearest(ls, o, (lo + hi) / 2, "mid");
            if (m) { var dc = m.l.pos - (lo + hi) / 2; nb[iLo] = lo + dc; nb[iHi] = hi + dc; used.push(m.l); }
            return;
          }
          var a = nearest(ls, o, lo, "lo"), z = nearest(ls, o, hi, "hi");
          if (a && z && a.l === z.l) { if (a.d <= z.d) z = null; else a = null; }
          if (a && z && canResize && (mode === "resize" || mode === "auto")) { nb[iLo] = a.l.pos; nb[iHi] = z.l.pos; used.push(a.l, z.l); return; }
          if (mode === "resize" && canResize) { if (a) { nb[iLo] = a.l.pos; used.push(a.l); } if (z) { nb[iHi] = z.l.pos; used.push(z.l); } return; }
          var best = a && (!z || a.d <= z.d) ? { l: a.l, d: a.l.pos - lo } : (z ? { l: z.l, d: z.l.pos - hi } : null);
          if (best) { nb[iLo] = lo + best.d; nb[iHi] = hi + best.d; used.push(best.l); }
        }
        if (axis !== "y") solve("v", l, r, 1, 3);
        if (axis !== "x") solve("h", t, bo, 0, 2);
        var moved = Math.abs(nb[0] - t) > 0.001 || Math.abs(nb[1] - l) > 0.001 || Math.abs(nb[2] - bo) > 0.001 || Math.abs(nb[3] - r) > 0.001;
        var resized = Math.abs((nb[3] - nb[1]) - (r - l)) > 0.001 || Math.abs((nb[2] - nb[0]) - (bo - t)) > 0.001;
        if (moved && !dry) {
          if (resized) it.geometricBounds = nb; else it.move(undefined, [nb[1] - l, nb[0] - t]);
        }
        var us = [];
        for (var u = 0; u < used.length; u++) us.push(__lineStr(used[u]));
        rows.push(ids[k] + "\\t" + (moved ? (resized ? "resized" : "moved") : (used.length ? "aligned" : "none")) + "\\t" + [l, t, r - l, bo - t].join(",") + "\\t" + [nb[1], nb[0], nb[3] - nb[1], nb[2] - nb[0]].join(",") + "\\t" + us.join(";") + "\\t" + pg.name);
      }
      rows.join("\\n");
    `));
    const records = [], lines = [];
    for (const row of out.split('\n').filter(Boolean)) {
      const [id, what, a, b, used, page] = row.split('\t');
      if (!what) continue;
      if (what === 'skip') { lines.push(`  #${id}: skipped – ${a}`); continue; }
      const L = (used || '').split(';').filter(Boolean).map(parseLine);
      if (what === 'none') { lines.push(`  #${id}: no line within ${tol} mm`); continue; }
      const [x0, y0, w0, h0] = a.split(',').map(Number), [x1, y1, w1, h1] = b.split(',').map(Number);
      const change = what === 'aligned' ? 'already on the lines' : `${what}: x ${fmt(x0)} → ${fmt(x1)}, y ${fmt(y0)} → ${fmt(y1)}${what === 'resized' ? `, ${fmt(w0)} × ${fmt(h0)} → ${fmt(w1)} × ${fmt(h1)} mm` : ' mm'}`;
      lines.push(`  #${id} (page ${page}): ${change} – on ${L.map(label).join(', ')}`);
      if (what !== 'aligned' && !args.dryRun) records.push({ id: Number(id), lines: L });
    }
    remember(records);
    return respond(`${args.dryRun ? 'Dry run (nothing changed)' : `${records.length} object(s) snapped`} – tolerance ${tol} mm, mode ${mode}:\n${lines.join('\n')}`, 'Snap To Grid');
  };

  handlers.fit_to_grid = async (args) => {
    const list = ids(args.ids);
    const pair = (v, label) => {
      if (!has(v)) return null;
      if (!Array.isArray(v) || !v.length || v.length > 2) throw new Error(`${label}: [first, last] (1-based), e.g. [3, 6]`);
      const [a, b = v[0]] = v.map((n) => Math.round(jsNum(n, label)));
      if (a < 1 || b < a) throw new Error(`${label}: [first, last] with 1 <= first <= last`);
      return [a, b];
    };
    const cols = pair(args.columns, 'columns'), rows = pair(args.rows, 'rows');
    if (!cols && !rows) throw new Error('Give columns and/or rows');
    if (rows && !has(args.rowCount)) throw new Error('rows needs rowCount (the rows of the grid inside the margins)');
    const rc = has(args.rowCount) ? Math.round(jsNum(args.rowCount, 'rowCount')) : 0;
    const rg = has(args.rowGutter) ? jsNum(args.rowGutter, 'rowGutter') : null;
    const fit = args.fit || 'span';
    const out = String(await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${LINES_JS}
      var ids = ${jsJson(list)}, cols = ${jsJson(cols)}, rws = ${jsJson(rows)}, rc = ${rc}, fit = ${JSON.stringify(fit)}, res = [];
      for (var k = 0; k < ids.length; k++) {
        var it = __findById(doc, ids[k]);
        if (!it) throw new Error("No object with id " + ids[k]);
        var pg = it.parentPage;
        if (!pg) throw new Error("Object " + ids[k] + " is on the pasteboard");
        var box = __marginBox(pg), mp = pg.marginPreferences, g = mp.columnGutter;
        var b = it.geometricBounds, nb = [b[0], b[1], b[2], b[3]], used = [];
        function place(lo, hi, iLo, iHi, kindS, kindE, nS, nE, o) {
          var size = nb[iHi] - nb[iLo];
          if (fit === "span") { nb[iLo] = lo; nb[iHi] = hi; used.push({ o: o, pos: lo, kind: kindS, n: nS }, { o: o, pos: hi, kind: kindE, n: nE }); }
          else if (fit === "start") { nb[iLo] = lo; nb[iHi] = lo + size; used.push({ o: o, pos: lo, kind: kindS, n: nS }); }
          else if (fit === "end") { nb[iHi] = hi; nb[iLo] = hi - size; used.push({ o: o, pos: hi, kind: kindE, n: nE }); }
          else { var c = (lo + hi) / 2; nb[iLo] = c - size / 2; nb[iHi] = c + size / 2; used.push({ o: o, pos: c, kind: kindS.replace("-start", "-center"), n: nS === nE ? nS : nS + "-" + nE }); }
        }
        if (cols) {
          var n = mp.columnCount;
          if (cols[1] > n) throw new Error("Page " + pg.name + " has " + n + " column(s) (set_margins_columns): columns " + cols[0] + "-" + cols[1] + " do not exist");
          var cw = (box.right - box.left - (n - 1) * g) / n;
          place(box.left + (cols[0] - 1) * (cw + g), box.left + (cols[1] - 1) * (cw + g) + cw, 1, 3, "column-start", "column-end", cols[0], cols[1], "v");
        }
        if (rws) {
          if (rws[1] > rc) throw new Error("rows " + rws[0] + "-" + rws[1] + " beyond rowCount " + rc);
          var rgut = ${rg === null ? 'g' : rg}, rh = (box.bottom - box.top - (rc - 1) * rgut) / rc;
          place(box.top + (rws[0] - 1) * (rh + rgut), box.top + (rws[1] - 1) * (rh + rgut) + rh, 0, 2, "row-start", "row-end", rws[0], rws[1], "h");
        }
        if (it.constructor.name === "Group" && (Math.abs((nb[3] - nb[1]) - (b[3] - b[1])) > 0.001 || Math.abs((nb[2] - nb[0]) - (b[2] - b[0])) > 0.001)) throw new Error("Object " + ids[k] + " is a group: use fit start / end / center (a group is moved, not stretched)");
        it.geometricBounds = nb;
        var us = [];
        for (var u = 0; u < used.length; u++) us.push(__lineStr(used[u]));
        res.push(ids[k] + "\\t" + pg.name + "\\t" + [b[1], b[0], b[3] - b[1], b[2] - b[0]].join(",") + "\\t" + [nb[1], nb[0], nb[3] - nb[1], nb[2] - nb[0]].join(",") + "\\t" + us.join(";"));
      }
      res.join("\\n");
    `));
    const records = [], lines = [];
    for (const row of out.split('\n').filter(Boolean)) {
      const [id, page, a, b, used = ''] = row.split('\t');
      if (!b) continue;
      const L = used.split(';').filter(Boolean).map(parseLine);
      const [x0, y0, w0, h0] = a.split(',').map(Number), [x1, y1, w1, h1] = b.split(',').map(Number);
      lines.push(`  #${id} (page ${page}): x ${fmt(x0)} → ${fmt(x1)}, y ${fmt(y0)} → ${fmt(y1)}, ${fmt(w0)} × ${fmt(h0)} → ${fmt(w1)} × ${fmt(h1)} mm – on ${L.map(label).join(', ')}`);
      records.push({ id: Number(id), lines: L });
    }
    remember(records);
    return respond(`${records.length} object(s) placed (fit ${fit}${cols ? `, columns ${cols[0]}–${cols[1]}` : ''}${rows ? `, rows ${rows[0]}–${rows[1]} of ${rc}` : ''}):\n${lines.join('\n')}`, 'Fit To Grid');
  };

  return { definitions, handlers };
}
