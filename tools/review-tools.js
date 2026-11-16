// Project workflow: the usage guide, backups, and the before/after review for a project manager.
//
//   get_usage_guide   returns GUIDE.md (read it before modifying a document)
//   backup_document   dated, named copy in "InDesign Agent Backups" (never deleted by the server)
//   list_backups      backups of the active document
//   restore_backup    put a backup back in place of the active document (current state backed up first)
//   review_snapshot   "before": page images + object inventory, in a temp folder
//   review_compare    "after": side-by-side images with numbered red/green zones + a change table
//
// Review files live under $TMPDIR/indesign-mcp-review/ (removed after 3 days): never in the
// repository and never next to the InDesign file. Backups are the opposite: they are kept.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsStr, jsNum, jsJson } from '../lib/script-runtime.js';
import { decodePng, encodePng } from '../lib/png.js';
import {
  diffInventories, groupRows, pixelDiffRegions, boundsToRect, intersects, buildPageComposite, changeRows, changesTable, labelsFor, cropRectFor, cropImage,
} from '../lib/review-diff.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GUIDE_PATH = path.join(ROOT, 'GUIDE.md');
export const BACKUP_FOLDER_NAME = 'InDesign Agent Backups';
const REVIEW_ROOT_NAME = 'indesign-mcp-review';
const TEXT_PROPS = new Set(['text', 'tableText']);

// Part of g inside r (grown by pad, clipped to r), or null
const clipRect = (g, r, pad = 0) => {
  const x0 = Math.max(r.x, g.x - pad), y0 = Math.max(r.y, g.y - pad);
  const x1 = Math.min(r.x + r.w, g.x + g.w + pad), y1 = Math.min(r.y + r.h, g.y + g.h + pad);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

// Merge regions closer than pad (fine regions -> one visual zone per area)
const mergeNear = (rects, pad) => {
  const out = rects.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        j = i;
      }
    }
  }
  return out;
};
const REVIEW_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const MAX_PAGES = 200;

const has = (v) => v !== undefined && v !== null;
const pad2 = (n) => String(n).padStart(2, '0');

export function slugify(text, max = 60) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

// "Brochure__2026-11-16_14h05m09__avant-correction-prix.indd"
export function backupFileName(docName, reason, date = new Date()) {
  const base = String(docName).replace(/\.indd$/i, '');
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}h${pad2(date.getMinutes())}m${pad2(date.getSeconds())}`;
  const slug = slugify(reason) || 'backup';
  return `${base}__${stamp}__${slug}.indd`;
}

export function readGuide() {
  return fs.readFileSync(GUIDE_PATH, 'utf8');
}

// ExtendScript: JSON serialiser (ExtendScript has no JSON object). Backslash and quote are built
// with fromCharCode so this source needs no escaping inside the template literal.
const JSON_ES = `
var __BS = String.fromCharCode(92), __Q = String.fromCharCode(34);
function __js(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") {
    var s = __Q;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i), ch = v.charAt(i);
      if (ch === __Q || ch === __BS) s += __BS + ch;
      else if (c < 32 || c > 126) { var h = c.toString(16); while (h.length < 4) h = "0" + h; s += __BS + "u" + h; }
      else s += ch;
    }
    return s + __Q;
  }
  if (v instanceof Array) { var a = []; for (var j = 0; j < v.length; j++) a.push(__js(v[j])); return "[" + a.join(",") + "]"; }
  var parts = [];
  for (var k in v) if (v.hasOwnProperty(k)) parts.push(__js(k) + ":" + __js(v[k]));
  return "{" + parts.join(",") + "}";
}
function __r1(n) { return Math.round(n * 10) / 10; }
function __nm(x) { try { if (x === null || x === undefined) return null; if (typeof x === "string") return x; return x.name; } catch (e) { return null; } }
function __uniq(list) { var seen = {}, out = []; for (var i = 0; i < list.length; i++) { var k = String(list[i]); if (!seen[k]) { seen[k] = 1; out.push(list[i]); } } return out; }
`;

// ExtendScript: inventory of the active document (selected pages, or all) as JSON
// pageIds: pages to include (null = all). knownIds: with pageIds, also include pages not in this
// list (pages added since the snapshot).
function inventoryScript(pageIds, knownIds = null) {
  return `
    ${JSON_ES}
    var SKIP = { Image: 1, EPS: 1, PDF: 1, PICT: 1, WMF: 1, ImportedPage: 1, SVG: 1, Graphic: 1, Group: 1 };
    function __item(it) {
      var o = { id: it.id, type: it.constructor.name };
      try { var b = it.visibleBounds; o.bounds = [__r1(b[0]), __r1(b[1]), __r1(b[2]), __r1(b[3])]; } catch (e) {}
      try { o.rotation = __r1(it.rotationAngle); } catch (e) {}
      try { o.fill = __nm(it.fillColor); if (it.fillTint >= 0 && it.fillTint < 100) o.fill += " " + __r1(it.fillTint) + "%"; } catch (e) {}
      try { o.stroke = __nm(it.strokeColor); } catch (e) {}
      try { o.strokeWeight = __r1(it.strokeWeight); } catch (e) {}
      try { o.opacity = __r1(it.transparencySettings.blendingSettings.opacity); } catch (e) {}
      try { o.visible = it.visible; } catch (e) {}
      try { o.layer = it.itemLayer.name; } catch (e) {}
      try { o.name = it.name || it.label || ""; } catch (e) { try { o.name = it.label || ""; } catch (e2) {} }
      try { o.objectStyle = it.appliedObjectStyle.name; } catch (e) {}
      if (o.type === "TextFrame") {
        try {
          var story = it.parentStory;
          var whole = story.textContainers.length === 1;
          var txt = whole ? story.texts[0] : it.texts[0];
          o.text = txt.contents;
          if (txt.tables.length > 0) {
            var tt = [];
            for (var ti = 0; ti < txt.tables.length; ti++) {
              var rowsT = txt.tables[ti].rows;
              for (var ri = 0; ri < rowsT.length; ri++) {
                var cc = rowsT[ri].cells.everyItem().contents;
                if (!(cc instanceof Array)) cc = [cc];
                tt.push(cc.join(" | "));
              }
              tt.push("");
            }
            o.tableText = tt.join(String.fromCharCode(10));
          }
          if (txt.paragraphs.length > 0) {
            var ps = txt.paragraphs.everyItem().appliedParagraphStyle, names = [];
            if (!(ps instanceof Array)) ps = [ps];
            for (var i = 0; i < ps.length; i++) names.push(__nm(ps[i]));
            o.paragraphStyles = __uniq(names);
          } else o.paragraphStyles = [];
          if (txt.textStyleRanges.length > 0) {
            var fonts = txt.textStyleRanges.everyItem().appliedFont, sizes = txt.textStyleRanges.everyItem().pointSize, fn = [], sz = [];
            if (!(fonts instanceof Array)) fonts = [fonts];
            if (!(sizes instanceof Array)) sizes = [sizes];
            for (var f = 0; f < fonts.length; f++) fn.push(__nm(fonts[f]));
            for (var z = 0; z < sizes.length; z++) sz.push(__r1(sizes[z]));
            o.fonts = __uniq(fn);
            o.pointSize = __uniq(sz).sort(function (a, b) { return a - b; });
          } else { o.fonts = []; o.pointSize = []; }
          o.overflows = it.overflows;
        } catch (e) {}
      }
      try {
        if (o.type !== "TextFrame" && it.allGraphics.length > 0) {
          var lk = it.allGraphics[0].itemLink;
          if (lk && lk.isValid) { o.link = lk.name; o.linkStatus = String(lk.status); }
          else o.link = "(embedded)";
        }
      } catch (e) {}
      return o;
    }
    var doc = __requireDoc();
    var want = null, known = null;
    ${pageIds ? `want = {}; var __w = ${JSON.stringify(pageIds.map(Number))}; for (var w = 0; w < __w.length; w++) want[__w[w]] = 1;` : ''}
    ${knownIds ? `known = {}; var __k = ${JSON.stringify(knownIds.map(Number))}; for (var w2 = 0; w2 < __k.length; w2++) known[__k[w2]] = 1;` : ''}
    var pages = [], allIds = [];
    for (var p = 0; p < doc.pages.length; p++) {
      var pg = doc.pages[p];
      allIds.push(pg.id);
      if (want && !want[pg.id] && !(known && !known[pg.id])) continue;
      var pb = pg.bounds;
      var items = [], all = pg.allPageItems;
      for (var q = 0; q < all.length; q++) {
        var it = all[q];
        if (SKIP[it.constructor.name]) continue;
        try { items.push(__item(it)); } catch (e) {}
      }
      pages.push({ id: pg.id, index: p, number: p + 1, name: pg.name, widthMm: __r1(pb[3] - pb[1]), heightMm: __r1(pb[2] - pb[0]), items: items });
    }
    function __styles(list, isPara) {
      var out = [];
      for (var s = 0; s < list.length; s++) {
        var st = list[s];
        try {
          if (st.name.charAt(0) === "[") continue;
          var v = {};
          try { var fnt = st.appliedFont; v.font = (typeof fnt === "string" ? fnt : fnt.name); } catch (e) {}
          try { if (st.fontStyle) v.style = st.fontStyle; } catch (e) {}
          try { v.size = __r1(st.pointSize); } catch (e) {}
          try { v.leading = (typeof st.leading === "number") ? __r1(st.leading) : String(st.leading); } catch (e) {}
          try { v.color = __nm(st.fillColor); } catch (e) {}
          try { if (isPara) v.based = __nm(st.basedOn); } catch (e) {}
          out.push({ name: st.name, value: v });
        } catch (e) {}
      }
      return out;
    }
    var sw = [];
    for (var k = 0; k < doc.swatches.length; k++) {
      var s0 = doc.swatches[k];
      try {
        var v0 = {};
        try { v0.model = String(s0.model); v0.values = s0.colorValue; } catch (e) {}
        try { if (s0.constructor.name === "Tint") { v0.tint = s0.tintValue; v0.base = s0.baseColor.name; } } catch (e) {}
        sw.push({ name: s0.name, value: v0 });
      } catch (e) {}
    }
    var path = null;
    if (__hasFile(doc)) path = doc.fullName.fsName;
    "INVENTORY\\n" + __js({
      document: { name: doc.name, path: path, modified: doc.modified, pageCount: doc.pages.length, allPageIds: allIds,
        paragraphStyles: __styles(doc.allParagraphStyles, true), characterStyles: __styles(doc.allCharacterStyles, false), swatches: sw },
      pages: pages
    });
  `;
}


// ExtendScript: every page as "id<TAB>name<TAB>index" (cheap; used to resolve page names)
const PAGES_SCRIPT = `
  var doc = __requireDoc();
  var out = [];
  for (var i = 0; i < doc.pages.length; i++) out.push(doc.pages[i].id + "\\t" + doc.pages[i].name + "\\t" + i);
  "PAGES\\n" + out.join("\\n");
`;

// Resolve page references as the project manager says them: the page name shown in InDesign
// ("12", "iv", "A-3"), or "+N" for the N-th page of the file. Numbers count as names.
export function resolvePageRefs(refs, pages) {
  return refs.map((ref) => {
    const s = String(ref).trim();
    const byName = pages.filter((p) => p.name === s);
    if (byName.length === 1) return byName[0];
    const abs = s.match(/^\+(\d+)$/);
    if (abs) {
      const p = pages[Number(abs[1]) - 1];
      if (!p) throw new Error(`Page ${s}: the document has ${pages.length} pages`);
      return p;
    }
    if (byName.length > 1) {
      throw new Error(`Page name "${s}" is used ${byName.length} times (sections). Use the absolute position: ${byName.map((p) => `"+${p.index + 1}"`).join(', ')}`);
    }
    const names = pages.map((p) => p.name);
    const shown = names.length > 16 ? `${names.slice(0, 8).join(', ')} … ${names.slice(-6).join(', ')}` : names.join(', ');
    throw new Error(`Page "${s}" not found. Page names: ${shown} (or "+N" for the N-th page)`);
  });
}

const pageRange = (pages) => (pages.length > 8 ? `${pages.length} pages (${pages[0].name} … ${pages[pages.length - 1].name})` : `page${pages.length > 1 ? 's' : ''} ${pages.map((p) => p.name).join(', ')}`);

const excerpt = (t, n) => {
  const s = String(t || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\uFFFC/g, '▣').replace(/[\r\n\u2028]+/g, ' ¶ ').replace(/\s+/g, ' ').replace(/^(\s*¶\s*)+/, '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

// One line per object: what the agent needs to act (id, kind, place, short content). Small
// shapes without text or image (icon parts, bullets, rules) are folded into one line.
const SMALL_SHAPE_MM2 = 400;
export function pageSummary(page, maxItems = 60) {
  const lines = [`Page ${page.name} (pageIndex ${page.index}, ${page.widthMm}×${page.heightMm} mm) – ${page.items.length} objects:`];
  const small = [];
  const main = [];
  for (const it of page.items) {
    const b = it.bounds || [0, 0, 0, 0];
    const area = (b[3] - b[1]) * (b[2] - b[0]);
    if (it.type !== 'TextFrame' && !it.link && area < SMALL_SHAPE_MM2 && !it.name) small.push(it);
    else main.push(it);
  }
  for (const it of main.slice(0, maxItems)) {
    const b = it.bounds || [0, 0, 0, 0];
    let line = `  id=${it.id} ${it.type} x${Math.round(b[1])} y${Math.round(b[0])} ${Math.round(b[3] - b[1])}×${Math.round(b[2] - b[0])}`;
    if (it.type === 'TextFrame') {
      if (it.paragraphStyles?.length) line += ` [${it.paragraphStyles.slice(0, 2).join(', ')}${it.paragraphStyles.length > 2 ? ', …' : ''}]`;
      if (it.overflows) line += ' OVERSET';
      if (it.tableText) line += ` table(${it.tableText.split('\n').filter(Boolean).length} rows: «${excerpt(it.tableText.split('\n')[0], 50)}»)`;
      const t = excerpt(it.text, 70);
      if (t) line += ` «${t}»`;
    } else if (it.link) {
      line += ` image=${it.link}${it.linkStatus && it.linkStatus !== 'NORMAL' ? ` (${it.linkStatus})` : ''}`;
    } else if (it.fill && it.fill !== 'None') {
      line += ` fill=${it.fill}`;
    }
    if (it.name) line += ` name=${excerpt(it.name, 30)}`;
    if (it.visible === false) line += ' hidden';
    lines.push(line);
  }
  if (main.length > maxItems) lines.push(`  … ${main.length - maxItems} more (list_page_items)`);
  if (small.length) lines.push(`  + ${small.length} small shapes (icons, bullets, rules): ids ${small.slice(0, 8).map((i) => i.id).join(', ')}${small.length > 8 ? ', …' : ''}`);
  return lines.join('\n');
}

export function createReviewTools(server) {
  const run = (script) => server.executeInDesignScript(script);
  const reviewRoot = () => path.join(os.tmpdir(), REVIEW_ROOT_NAME);
  server.workflow = server.workflow || { guideRead: false, backups: new Set(), lastSnapshot: null };

  const pruneReviews = () => {
    try {
      const cutoff = Date.now() - REVIEW_MAX_AGE_MS;
      for (const d of fs.readdirSync(reviewRoot())) {
        const p = path.join(reviewRoot(), d);
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch { /* best effort */ }
  };

  const readInventory = async (pageIds, knownIds) => {
    const out = String(await run(inventoryScript(pageIds, knownIds)));
    try {
      return JSON.parse(out.replace(/^INVENTORY\n/, ''));
    } catch (e) {
      throw new Error(`Could not read the document inventory: ${e.message}`);
    }
  };

  const readPages = async () => String(await run(PAGES_SCRIPT)).replace(/^PAGES\n/, '').split('\n').filter(Boolean).map((l) => {
    const [id, name, index] = l.split('\t');
    return { id: Number(id), name, index: Number(index) };
  });

  // pages (names / "+N") or pageIndexes (0-based) -> page ids; allPages -> null (= every page)
  const targetPageIds = async (args, { required }) => {
    if (args.allPages === true) return null;
    const refs = Array.isArray(args.pages) ? args.pages : [];
    const idx = Array.isArray(args.pageIndexes) ? args.pageIndexes : [];
    if (!refs.length && !idx.length) {
      if (required) throw new Error('Say which pages: pages (names as shown in InDesign, e.g. ["12"]) or pageIndexes (0-based). allPages: true only for document-wide changes.');
      return null;
    }
    const pages = await readPages();
    const found = resolvePageRefs(refs, pages);
    for (const i of idx) {
      if (!Number.isInteger(i) || i < 0 || i >= pages.length) throw new Error(`Invalid page index: ${i} (document has ${pages.length} pages, 0-based)`);
      found.push(pages[i]);
    }
    return [...new Set(found.map((p) => p.id))];
  };

  // All pages in one InDesign script (one round trip instead of one per page)
  const renderPages = async (pages, resolution, dir) => {
    if (!pages.length) return;
    const jobs = pages.map((p) => ({ i: p.index, f: path.join(dir, `page-${p.id}.png`) }));
    await run(`
      var doc = __requireDoc();
      var jobs = ${jsJson(jobs)};
      var prefs = app.pngExportPreferences;
      prefs.exportResolution = ${resolution};
      // Opaque page: InDesign paints the page (paper) behind the content
      try { prefs.transparentBackground = false; } catch (e) {}
      prefs.useDocumentBleeds = false;
      prefs.pngExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
      prefs.exportingSpread = false;
      for (var j = 0; j < jobs.length; j++) {
        prefs.pageString = "+" + (jobs[j].i + 1);
        var out = File(jobs[j].f);
        doc.exportFile(ExportFormat.PNG_FORMAT, out, false);
        if (!out.exists) throw new Error("The page export did not create " + out.fsName);
      }
      "ok";
    `);
  };

  // A document converted from an older InDesign version has no fullName until it is saved, but
  // filePath still points at the folder of the original file: use folder + name.
  const docInfoScript = `
    var doc = __requireDoc();
    var p = "", conv = false;
    try { conv = doc.converted; } catch (e) {}
    if (__hasFile(doc)) p = doc.fullName.fsName;
    else { try { var fp = doc.filePath; if (fp) p = fp.fsName + "/" + doc.name.replace(/\\s*\\[[^\\]]*\\]$/, ""); } catch (e) {} }
    doc.name + "\\n" + p + "\\n" + (doc.modified ? "1" : "0") + "\\n" + (conv ? "1" : "0");
  `;
  const activeDoc = async () => {
    const [name, filePath, modified, converted] = String(await run(docInfoScript)).split('\n');
    return { name, filePath: filePath && fs.existsSync(filePath) ? filePath : null, modified: modified === '1', converted: converted === '1' };
  };

  const backupDirFor = (doc, override) => {
    if (override) return server.validateFilePath(override);
    if (process.env.INDESIGN_BACKUP_DIR) return server.validateFilePath(process.env.INDESIGN_BACKUP_DIR);
    const base = doc.filePath ? path.dirname(doc.filePath) : path.join(os.homedir(), 'Documents');
    return server.validateFilePath(path.join(base, BACKUP_FOLDER_NAME));
  };

  const makeBackup = async (doc, reason, dirOverride) => {
    const dir = backupDirFor(doc, dirOverride);
    fs.mkdirSync(dir, { recursive: true });
    let target = path.join(dir, backupFileName(doc.name, reason));
    for (let n = 2; fs.existsSync(target); n++) target = target.replace(/(-\d+)?\.indd$/i, `-${n}.indd`);
    await run(`
      var doc = __requireDoc();
      var f = File(${jsStr(target)});
      doc.saveACopy(f);
      if (!f.exists) throw new Error("The backup copy was not created");
      "ok";
    `);
    server.workflow.backups.add(doc.filePath || doc.name);
    return target;
  };

  const PAGE_REF_PROPS = {
    pages: { type: 'array', items: {}, description: 'Pages as the user names them (page name shown in InDesign, e.g. ["12", "13"]); "+N" = N-th page of the file' },
    pageIndexes: { type: 'array', items: { type: 'number' }, description: 'Alternative: 0-based page indexes' },
  };

  const definitions = [
    {
      name: 'get_usage_guide',
      description: 'READ ONCE PER SESSION, before the first change to a document: the workflow (prepare_edit -> changes -> review_compare), backups, page addressing, rules of thumb and errors.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'find_text',
      description: 'Locate text without reading whole stories: returns each match with page name, pageIndex, text frame id and a short context. Use it when the user quotes text instead of a page, and before a find_replace_text you are not sure about.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text (or GREP with useGrep) to find' },
          useGrep: { type: 'boolean', description: 'text is a GREP expression', default: false },
          caseSensitive: { type: 'boolean', description: 'Case-sensitive search (plain text)', default: false },
          ...PAGE_REF_PROPS,
          limit: { type: 'number', description: 'Maximum matches listed (1-100)', default: 20 },
        },
        required: ['text'],
      },
    },
    {
      name: 'prepare_edit',
      description: `ONE CALL BEFORE CHANGING A DOCUMENT. For the pages the task touches: (1) backup copy in "${BACKUP_FOLDER_NAME}", (2) BEFORE snapshot of those pages only (temp folder), (3) shows the first page in InDesign, (4) returns one line per object of those pages (id, type, position, text excerpt) so you can act without list_page_items. Then make the changes and call review_compare.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...PAGE_REF_PROPS,
          allPages: { type: 'boolean', description: 'Snapshot every page: only for document-wide changes (styles, swatches, global replace)', default: false },
          reason: { type: 'string', description: 'What the task is, for the backup name, e.g. "correction prix p12"' },
          backup: { type: 'boolean', description: 'false = no backup (only if the user declined it or one was made for this task already)', default: true },
          listObjects: { type: 'boolean', description: 'Return the object list of the pages (off when you already know the ids)', default: true },
          resolution: { type: 'number', description: 'Snapshot resolution in dpi (36-150)', default: 72 },
        },
        required: ['reason'],
      },
    },
    {
      name: 'review_compare',
      description: 'AFTER the changes: compares the snapshot pages with the current state. Returns only the changed pages, as BEFORE | AFTER images with numbered dotted zones (orange modified, green added, red removed; text edits framed on the changed lines) and a side gutter minimap, cropped to the changed area, plus a Markdown change table (# | Page | Element | Property | Before | After | Change). Show both to the user. Can be called again after further corrections (always against the same BEFORE).',
      inputSchema: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string', description: 'From prepare_edit (default: the latest of this session)' },
          language: { type: 'string', enum: ['fr', 'en'], description: 'Language of image labels and table', default: 'fr' },
          maxImages: { type: 'number', description: 'Page images returned inline (0-10; all are saved to files). Many changes: lower it and rely on the table', default: 3 },
          crop: { type: 'boolean', description: 'Crop images to the changed area', default: true },
          sensitivity: { type: 'string', enum: ['low', 'normal', 'high'], description: 'Pixel sensitivity for changes no object explains', default: 'normal' },
        },
      },
    },
    {
      name: 'backup_document',
      description: `Extra backup outside prepare_edit (e.g. before a risky step): dated, named copy of the active document in "${BACKUP_FOLDER_NAME}" next to the .indd. The open document is not changed. Backups are never deleted by the server.`,
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short description, used in the file name' },
          backupDir: { type: 'string', description: 'Optional: another backup folder (inside the allowed directories)' },
        },
        required: ['reason'],
      },
    },
    {
      name: 'list_backups',
      description: `Backups of the active document (newest first) with date, reason and path, for restore_backup.`,
      inputSchema: { type: 'object', properties: { backupDir: { type: 'string', description: 'Optional: another backup folder' } } },
    },
    {
      name: 'restore_backup',
      description: 'Go back to a backup, only when the user asks: backs up the current state, closes the document WITHOUT saving, copies the backup over the .indd and reopens it. Needs confirmDestructive: true. The backup is kept.',
      inputSchema: {
        type: 'object',
        properties: {
          backupPath: { type: 'string', description: 'Backup file name from list_backups (or its full path)' },
          confirmDestructive: { type: 'boolean', description: 'Must be true: the open document is replaced', default: false },
        },
        required: ['backupPath'],
      },
    },
  ];

  const handlers = {};

  handlers.get_usage_guide = async () => {
    server.workflow.guideRead = true;
    return { content: [{ type: 'text', text: readGuide() }] };
  };

  handlers.find_text = async (args) => {
    const limit = Math.max(1, Math.min(100, has(args.limit) ? jsNum(args.limit, 'limit') : 20));
    const pageIds = await targetPageIds(args, { required: false });
    const script = `
      var doc = __requireDoc();
      var want = null;
      ${pageIds ? `want = {}; var __w = ${JSON.stringify(pageIds)}; for (var w = 0; w < __w.length; w++) want[__w[w]] = 1;` : ''}
      app.findTextPreferences = NothingEnum.nothing;
      app.findGrepPreferences = NothingEnum.nothing;
      var found;
      try {
        ${args.useGrep ? `
          app.findGrepPreferences.findWhat = ${jsStr(args.text)};
          found = doc.findGrep();
        ` : `
          app.findTextPreferences.findWhat = ${jsStr(args.text)};
          app.findChangeTextOptions.caseSensitive = ${args.caseSensitive ? 'true' : 'false'};
          app.findChangeTextOptions.wholeWord = false;
          found = doc.findText();
        `}
      } finally {
        app.findTextPreferences = NothingEnum.nothing;
        app.findGrepPreferences = NothingEnum.nothing;
      }
      var out = [], total = 0;
      for (var i = 0; i < found.length; i++) {
        var t = found[i], where = "overset", pg = null, fid = "-";
        try {
          var tf = t.parentTextFrames;
          if (tf.length) { fid = tf[0].id; pg = tf[0].parentPage; where = pg ? ("p." + pg.name + " (pageIndex " + pg.documentOffset + ")") : "pasteboard"; }
        } catch (e) {}
        if (want && !(pg && want[pg.id])) continue;
        total++;
        if (out.length >= ${limit}) continue;
        var ctx = "";
        try {
          var s = t.parentStory.contents, a = Math.max(0, t.index - 40), b = Math.min(s.length, t.index + t.length + 40);
          ctx = (a > 0 ? "..." : "") + s.substring(a, t.index) + "[" + s.substring(t.index, t.index + t.length) + "]" + s.substring(t.index + t.length, b) + (b < s.length ? "..." : "");
          ctx = ctx.replace(/[\\r\\n]+/g, " / ").replace(/[\\uFFFC\\u0016]/g, "");
        } catch (e) {}
        out.push(where + " frame " + fid + ": " + ctx);
      }
      total + " match(es)" + (total > out.length ? " (first " + out.length + " shown)" : "") + (out.length ? ":\\n" + out.join("\\n") : "");
    `;
    return server.formatResponse(await run(script), 'Find Text');
  };

  handlers.prepare_edit = async (args) => {
    pruneReviews();
    const resolution = has(args.resolution) ? jsNum(args.resolution, 'resolution') : 72;
    if (resolution < 36 || resolution > 150) throw new Error('resolution must be 36-150 dpi');
    const pageIds = await targetPageIds(args, { required: true });
    const doc = await activeDoc();
    const lines = [];
    if (args.backup !== false) {
      const target = await makeBackup(doc, args.reason);
      lines.push(`Backup: ${target}${doc.converted ? ' (document converted from an older InDesign version: saving it will ask for a new name)' : doc.modified ? ' (includes unsaved changes)' : ''}`);
    } else {
      lines.push('Backup: skipped (backup: false)');
    }
    const inv = await readInventory(pageIds);
    if (inv.pages.length > MAX_PAGES) throw new Error(`${inv.pages.length} pages: name the pages (at most ${MAX_PAGES})`);
    const d = new Date();
    const id = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}_${slugify(inv.document.name.replace(/\.indd$/i, ''), 40) || 'document'}_${slugify(args.reason, 30)}`;
    const dir = path.join(reviewRoot(), id, 'before');
    fs.mkdirSync(dir, { recursive: true });
    await renderPages(inv.pages, resolution, dir);
    fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify({ resolution, pageIds, ...inv }));
    server.workflow.lastSnapshot = id;
    server.workflow.prepared = true;
    try {
      if (inv.pages.length) await run(`var doc = __requireDoc(); app.activeWindow.activePage = doc.pages[${inv.pages[0].index}]; "ok";`);
    } catch { /* no window (e.g. document opened without one): not needed */ }
    lines.push(`Snapshot: snapshotId=${id} – ${pageRange(inv.pages)}`);
    if (args.listObjects !== false && inv.pages.length <= 6) lines.push('', ...inv.pages.map((p) => pageSummary(p)));
    else if (args.listObjects !== false) lines.push(`(${inv.pages.length} pages: object lists omitted; use list_page_items or find_text for the page you work on)`);
    lines.push('', 'Next: make the changes (use the ids), then review_compare.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };

  handlers.backup_document = async (args) => {
    const doc = await activeDoc();
    const target = await makeBackup(doc, args.reason, args.backupDir);
    const size = fs.statSync(target).size;
    const lines = [`Backup created: ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`];
    if (!doc.filePath) lines.push('The document has never been saved: the backup is its only copy on disk.');
    if (doc.modified) lines.push('It includes the unsaved changes of the open document.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };

  const listBackupFiles = (doc, dirOverride) => {
    const dir = backupDirFor(doc, dirOverride);
    const base = doc.name.normalize('NFC').replace(/\.indd$/i, '');
    let files = [];
    try { files = fs.readdirSync(dir); } catch { return { dir, items: [] }; }
    const items = files
      .map((f) => f.normalize('NFC'))
      .filter((f) => f.startsWith(`${base}__`) && /\.indd$/i.test(f))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        const m = f.slice(base.length + 2).match(/^(\d{4}-\d{2}-\d{2})_(\d{2})h(\d{2})m(\d{2})__(.*)\.indd$/i);
        return { path: full, size: st.size, mtime: st.mtimeMs, when: m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : new Date(st.mtimeMs).toISOString(), reason: m ? m[5] : '' };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return { dir, items };
  };

  handlers.list_backups = async (args) => {
    const doc = await activeDoc();
    const { dir, items } = listBackupFiles(doc, args.backupDir);
    if (!items.length) return { content: [{ type: 'text', text: `No backups of ${doc.name} in ${dir}` }] };
    const rows = items.map((b, i) => `${i + 1}. ${b.when}  ${b.reason || '-'}  (${(b.size / 1024 / 1024).toFixed(1)} MB)  ${path.basename(b.path)}`);
    return { content: [{ type: 'text', text: `Backups of ${doc.name}, newest first, in ${dir}:\n${rows.join('\n')}` }] };
  };

  handlers.restore_backup = async (args) => {
    const doc0 = /[\\/]/.test(args.backupPath) ? null : await activeDoc();
    const backup = server.validateFilePath(doc0 ? path.join(backupDirFor(doc0), args.backupPath) : args.backupPath);
    if (!fs.existsSync(backup) || !/\.indd$/i.test(backup)) throw new Error(`Backup not found or not an .indd file: ${backup}`);
    const envDir = process.env.INDESIGN_BACKUP_DIR ? server.validateFilePath(process.env.INDESIGN_BACKUP_DIR) : null;
    if (path.basename(path.dirname(backup)) !== BACKUP_FOLDER_NAME && path.dirname(backup) !== envDir) {
      throw new Error(`Only files inside a "${BACKUP_FOLDER_NAME}" folder can be restored`);
    }
    const doc = await activeDoc();
    if (!doc.filePath) throw new Error('The active document has never been saved: open the backup with open_document instead');
    const base = doc.name.normalize('NFC').replace(/\.indd$/i, '');
    if (!path.basename(backup).normalize('NFC').startsWith(`${base}__`)) {
      throw new Error(`${path.basename(backup)} is not a backup of the active document ${doc.name}. Activate the right document first.`);
    }
    server.validateDestructiveOperation(args, 'Restore backup', `${doc.filePath} <- ${backup}`);
    const safety = await makeBackup(doc, 'avant restauration');
    await run(`var doc = __requireDoc(); doc.close(SaveOptions.NO); "closed";`);
    fs.copyFileSync(backup, doc.filePath);
    await run(`
      var f = File(${jsStr(doc.filePath)});
      if (!f.exists) throw new Error("File not found after restore: " + f.fsName);
      app.open(f).name;
    `);
    return { content: [{ type: 'text', text: `Restored ${doc.filePath} from ${backup}\nPrevious state saved as: ${safety}\nThe document is open again.` }] };
  };

  handlers.review_compare = async (args) => {
    const id = args.snapshotId || server.workflow.lastSnapshot;
    if (!id) throw new Error('No snapshot: call prepare_edit before the changes');
    if (!/^[\w.-]+$/.test(id)) throw new Error(`Invalid snapshotId: ${id}`);
    const caseDir = path.join(reviewRoot(), id);
    const beforeDir = path.join(caseDir, 'before');
    if (!fs.existsSync(path.join(beforeDir, 'inventory.json'))) throw new Error(`Snapshot not found: ${id} (snapshots are removed after 3 days)`);
    const before = JSON.parse(fs.readFileSync(path.join(beforeDir, 'inventory.json'), 'utf8'));
    const L = labelsFor(args.language || 'fr');
    const fr = L === labelsFor('fr');
    const maxImages = Math.max(0, Math.min(10, has(args.maxImages) ? jsNum(args.maxImages, 'maxImages') : 3));
    const sens = { low: { threshold: 60, minPixels: 6 }, normal: { threshold: 40, minPixels: 3 }, high: { threshold: 20, minPixels: 1 } }[args.sensitivity || 'normal'];

    // AFTER: the snapshot pages that still exist, plus pages added since (nothing else is read)
    const after = await readInventory(before.pageIds ? before.pages.map((p) => p.id) : null, before.pageIds ? before.document.allPageIds : null);
    if (after.document.name !== before.document.name) {
      throw new Error(`The active document is ${after.document.name}, the snapshot is of ${before.document.name}. Activate the right document first.`);
    }
    let n = 1;
    while (fs.existsSync(path.join(caseDir, `after-${n}`))) n++;
    const afterDir = path.join(caseDir, `after-${n}`);
    fs.mkdirSync(afterDir, { recursive: true });
    await renderPages(after.pages, before.resolution, afterDir);
    fs.writeFileSync(path.join(afterDir, 'inventory.json'), JSON.stringify(after));

    const diff = diffInventories(before, after);
    const pageKeys = [...new Set([...before.pages.map((p) => p.id), ...after.pages.map((p) => p.id)])];
    const visualZones = [];
    let nextZone = diff.changes.length + 1;
    const pagesOut = [];
    for (const pid of pageKeys) {
      const pb = before.pages.find((p) => p.id === pid) || null;
      const pa = after.pages.find((p) => p.id === pid) || null;
      let imgB = pb ? decodePng(fs.readFileSync(path.join(beforeDir, `page-${pid}.png`))) : null;
      let imgA = pa ? decodePng(fs.readFileSync(path.join(afterDir, `page-${pid}.png`))) : null;
      let beforeZones = [], afterZones = [];
      const sameSize = imgB && imgA && imgB.width === imgA.width && imgB.height === imgA.height;
      const regions = imgB && imgA ? pixelDiffRegions(imgB, imgA, { cell: 4, gap: 1, ...sens }) : [];
      const explained = [];
      const isTextOnly = (c) => c.kind === 'modified' && c.props.every((p) => TEXT_PROPS.has(p.prop));
      // Areas of the other changes (moves, fills, added, removed objects) on this page: their pixels
      // must not be attributed to a text change in an object underneath
      const otherRects = [];
      for (const c of diff.changes) {
        if (isTextOnly(c)) continue;
        if (c.before && c.kind !== 'added' && c.before.pageId === pid && imgB) { const r = boundsToRect(c.before.bounds, pb.widthMm, imgB); if (r) otherRects.push(r); }
        if (c.after && c.kind !== 'removed' && c.after.pageId === pid && imgA) { const r = boundsToRect(c.after.bounds, pa.widthMm, imgA); if (r) otherRects.push(r); }
      }
      const area = (r) => r.w * r.h;
      const mostlyIn = (g, o) => { const i = clipRect(g, o); return i && area(i) > 0.5 * area(g); };
      // A text-only change marks the changed lines (pixel areas inside the object), not the whole
      // frame, so a one-word edit shows as a small zone and a short gutter bar
      const zonesFor = (c, r) => {
        explained.push(r);
        if (!isTextOnly(c) || !sameSize) return [r];
        const near = Math.max(6, Math.round(imgA.width / 80));
        const own = regions.filter((g) => intersects(g, r) && !otherRects.some((o) => mostlyIn(g, o)));
        const inside = mergeNear(own.map((g) => clipRect(g, r, 2)).filter(Boolean), near);
        return inside.length ? inside : [r];
      };
      for (const c of diff.changes) {
        if (c.kind !== 'added' && c.before.pageId === pid && imgB) {
          const r = boundsToRect(c.before.bounds, pb.widthMm, imgB);
          if (r) zonesFor(c, r).forEach((rect, i) => beforeZones.push({ rect, zone: c.zone, kind: c.kind, noLabel: i > 0 }));
        }
        if (c.kind !== 'removed' && c.after.pageId === pid && imgA) {
          const r = boundsToRect(c.after.bounds, pa.widthMm, imgA);
          if (r) zonesFor(c, r).forEach((rect, i) => afterZones.push({ rect, zone: c.zone, kind: c.kind, noLabel: i > 0 }));
        }
      }
      if (imgB && imgA) {
        const pad = Math.round(imgA.width / 100);
        for (const r of mergeNear(regions, pad)) {
          if (explained.some((e) => intersects(r, e, pad))) continue;
          const zone = nextZone++;
          visualZones.push({ zone, pageNumber: pa.name, rect: r });
          beforeZones.push({ rect: r, zone, kind: 'visual' });
          afterZones.push({ rect: r, zone, kind: 'visual' });
        }
      }
      if (!beforeZones.length && !afterZones.length && pb && pa) continue;
      // Crop both sides to the same changed area (same page size only)
      let cropped = false;
      if (args.crop !== false && imgB && imgA && imgB.width === imgA.width && imgB.height === imgA.height) {
        const cr = cropRectFor([...beforeZones, ...afterZones].map((z) => z.rect), imgA.width, imgA.height);
        if (cr) {
          const shift = (zones) => zones.map((z) => ({ zone: z.zone, kind: z.kind, noLabel: z.noLabel, rect: { ...z.rect, x: z.rect.x - cr.x, y: z.rect.y - cr.y } }));
          imgB = cropImage(imgB, cr); imgA = cropImage(imgA, cr);
          beforeZones = shift(beforeZones); afterZones = shift(afterZones);
          cropped = true;
        }
      }
      const page = pa || pb;
      const composite = buildPageComposite({ before: imgB, after: imgA, beforeZones, afterZones, pageNumber: page.name, L, cropped });
      const file = path.join(afterDir, `review-page-${String(page.index + 1).padStart(3, '0')}.png`);
      const png = encodePng(composite);
      fs.writeFileSync(file, png);
      pagesOut.push({ index: page.index, name: page.name, file, png, zones: new Set([...beforeZones, ...afterZones].map((z) => z.zone)).size });
    }
    pagesOut.sort((x, y) => x.index - y.index);

    const allRows = changeRows(diff, visualZones, L);
    const rows = groupRows(allRows);
    const table = rows.length ? changesTable(rows, L) : '';
    const counts = { modified: 0, added: 0, removed: 0 };
    diff.changes.forEach((c) => counts[c.kind]++);
    const pagesList = pagesOut.map((p) => p.name).join(', ') || '—';
    const summary = !allRows.length
      ? (fr ? 'Aucune différence détectée.' : 'No difference found.')
      : fr
        ? `${counts.modified} modifié(s), ${counts.added} ajouté(s), ${counts.removed} supprimé(s)${visualZones.length ? `, ${visualZones.length} zone(s) visuelle(s)` : ''}${diff.docChanges.length ? `, ${diff.docChanges.length} au niveau document` : ''} – pages ${pagesList}.`
        : `${counts.modified} modified, ${counts.added} added, ${counts.removed} removed${visualZones.length ? `, ${visualZones.length} visual area(s)` : ''}${diff.docChanges.length ? `, ${diff.docChanges.length} document-level` : ''} – pages ${pagesList}.`;

    const title = fr ? `Revue des modifications – ${after.document.name}` : `Change review – ${after.document.name}`;
    const htmlFile = path.join(afterDir, 'report.html');
    fs.writeFileSync(htmlFile, reportHtml({ title, summary, pages: pagesOut, rows: allRows, L }));

    const text = [summary];
    if (pagesOut.length) text.push(fr ? 'Images : AVANT à gauche, APRÈS à droite ; orange = modifié, vert = ajouté, rouge = supprimé ; numéros = colonne #.' : 'Images: BEFORE left, AFTER right; orange = modified, green = added, red = removed; numbers = # column.');
    if (table) text.push('', table);
    if (allRows.length) {
      text.push('', `Folder: ${afterDir}`);
      text.push(`  report.html (${fr ? 'images + tableau détaillé, une ligne par objet' : 'images + detailed table, one row per object'})`);
      if (pagesOut.length) text.push(`  ${pagesOut.map((p) => path.basename(p.file)).join(', ')}`);
      if (pagesOut.length > maxImages) text.push(fr ? `${pagesOut.length - maxImages} image(s) non affichée(s) ici.` : `${pagesOut.length - maxImages} image(s) not shown here.`);
    }
    const content = [{ type: 'text', text: text.join('\n') }];
    for (const p of pagesOut.slice(0, maxImages)) content.push({ type: 'image', data: p.png.toString('base64'), mimeType: 'image/png' });
    return { content };
  };

  return { definitions, handlers };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Markdown emphasis from the text diff -> HTML
const mdInline = (s) => esc(s).replace(/~~(.+?)~~/g, '<del>$1</del>').replace(/\*\*(.+?)\*\*/g, '<ins>$1</ins>').replace(/\\\|/g, '|');

function reportHtml({ title, summary, pages, rows, L }) {
  const kindClass = (k) => Object.entries(L.kinds).find(([, v]) => v === k)?.[0] || '';
  return `<!doctype html>
<html lang="${L === labelsFor('en') ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg:#f7f7f8; --fg:#1f2328; --muted:#6b7280; --line:#e5e7eb; --red:#dc2626; --green:#00c846; --card:#fff; }
@media (prefers-color-scheme: dark) { :root { --bg:#16181d; --fg:#e6e6e6; --muted:#9ca3af; --line:#2d3139; --card:#1f2228; } }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width:1400px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; } p.summary { color:var(--muted); margin:0 0 24px; }
figure { margin:0 0 24px; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; }
figure img { width:100%; height:auto; display:block; } figcaption { color:var(--muted); font-size:12px; margin-top:6px; }
.table-wrap { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:8px; }
table { border-collapse:collapse; width:100%; } th, td { text-align:left; vertical-align:top; padding:8px 10px; border-bottom:1px solid var(--line); }
th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); background:var(--card); }
td.num { font-variant-numeric:tabular-nums; font-weight:600; text-align:right; }
del { color:var(--red); } ins { color:var(--green); text-decoration:none; font-weight:600; }
.k { font-size:12px; font-weight:600; padding:2px 8px; border-radius:999px; white-space:nowrap; border:1px solid var(--line); }
.k-modified { color:#d98200; } .k-added { color:var(--green); } .k-removed { color:var(--red); } .k-visual { color:var(--muted); }
</style></head><body><main>
<h1>${esc(title)}</h1><p class="summary">${esc(summary)}</p>
${pages.map((p) => `<figure><img alt="${esc(L.page)} ${esc(p.name)}" src="data:image/png;base64,${p.png.toString('base64')}"><figcaption>${esc(L.page)} ${esc(p.name)} – ${p.zones} zone(s)</figcaption></figure>`).join('\n')}
${rows.length ? `<div class="table-wrap"><table><thead><tr>${L.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r) => `<tr><td class="num">${esc(r.zone)}</td><td>${esc(r.page)}</td><td>${esc(r.element)}</td><td>${esc(r.property)}</td><td>${mdInline(r.before)}</td><td>${mdInline(r.after)}</td><td><span class="k k-${kindClass(r.kind)}">${esc(r.kind)}</span></td></tr>`).join('\n')}
</tbody></table></div>` : ''}
</main></body></html>`;
}
