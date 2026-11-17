// Before/after review: pure functions (no InDesign, no file system) that compare two snapshots
// of a document and draw the result for a project manager.
//
//  * diffInventories   compares the object inventories (text, position, colours, images, styles)
//  * pixelDiffRegions  finds the areas of a page image that changed
//  * buildPageComposite draws "before | after" side by side with numbered red / green zones
//  * changesTable      renders the changes as a Markdown table (the review table template)
//
// Images are { width, height, data: RGBA Uint8Array } (see lib/png.js).

import {
  createImage, blit, fillRect, strokeRect, roundRect, strokeRoundRect, circle, line, arrow, shadow, scaleImage,
  textWidth, lineHeight, drawString, fitText,
} from './raster.js';

export const RED = [220, 38, 38];
export const GREEN = [0, 200, 70];

// ---------------------------------------------------------------------------------------------
// Labels (French by default: the review is read by the project manager)
export const LABELS = {
  fr: {
    before: 'Avant', after: 'Après', detail: 'détail', pagesWord: 'pages', spreadsWord: 'planches', sameSpreads: 'planches identiques', legend: { modified: 'Modifié', moved: 'Déplacé', added: 'Ajouté', removed: 'Supprimé' }, page: 'Page', document: 'Document', noPage: 'Nouvelle page', removedPage: 'Page supprimée',
    cols: ['#', 'Page', 'Élément', 'Propriété', 'Avant', 'Après', 'Type'],
    kinds: { modified: 'Modifié', added: 'Ajouté', removed: 'Supprimé', visual: 'Visuel', moved: 'Déplacé' },
    visualDetail: 'Zone modifiée à l’image (sans changement d’objet identifié)',
    visualRenamed: (a, b) => `Zone modifiée à l’image – probablement le folio (page ${a} renumérotée ${b})`,
    pasteboard: 'table de montage',
    props: {
      bounds: 'Position / taille', page: 'Page', rotation: 'Rotation', fill: 'Fond', stroke: 'Contour', strokeWeight: 'Épaisseur contour',
      opacity: 'Opacité', visible: 'Visible', layer: 'Calque', name: 'Nom', text: 'Texte', paragraphStyles: 'Styles de paragraphe',
      fonts: 'Polices', pointSize: 'Corps', overflows: 'Texte en excès', link: 'Image liée', linkStatus: 'État du lien',
      objectStyle: 'Style d’objet', tableText: 'Contenu du tableau', object: 'Objet', pageCount: 'Nombre de pages',
      pstyle: 'Style de paragraphe', cstyle: 'Style de caractère', swatch: 'Nuancier',
    },
    types: { TextFrame: 'Bloc texte', Rectangle: 'Rectangle', Oval: 'Ellipse', Polygon: 'Polygone', GraphicLine: 'Ligne', Group: 'Groupe', Image: 'Image', Button: 'Bouton' },
    image: 'Image', table: 'tableau', yes: 'oui', no: 'non', none: '(aucun)', empty: '(vide)',
  },
  en: {
    before: 'Before', after: 'After', detail: 'detail', pagesWord: 'pages', spreadsWord: 'spreads', sameSpreads: 'identical spreads', legend: { modified: 'Modified', moved: 'Moved', added: 'Added', removed: 'Removed' }, page: 'Page', document: 'Document', noPage: 'New page', removedPage: 'Removed page',
    cols: ['#', 'Page', 'Element', 'Property', 'Before', 'After', 'Change'],
    kinds: { modified: 'Modified', added: 'Added', removed: 'Removed', visual: 'Visual', moved: 'Moved' },
    visualDetail: 'Area changed in the image (no object change identified)',
    visualRenamed: (a, b) => `Area changed in the image – probably the folio (page ${a} renumbered ${b})`,
    pasteboard: 'pasteboard',
    props: {
      bounds: 'Position / size', page: 'Page', rotation: 'Rotation', fill: 'Fill', stroke: 'Stroke', strokeWeight: 'Stroke weight',
      opacity: 'Opacity', visible: 'Visible', layer: 'Layer', name: 'Name', text: 'Text', paragraphStyles: 'Paragraph styles',
      fonts: 'Fonts', pointSize: 'Point size', overflows: 'Overset text', link: 'Linked image', linkStatus: 'Link status',
      objectStyle: 'Object style', tableText: 'Table content', object: 'Object', pageCount: 'Page count',
      pstyle: 'Paragraph style', cstyle: 'Character style', swatch: 'Swatch',
    },
    types: { TextFrame: 'Text frame', Rectangle: 'Rectangle', Oval: 'Ellipse', Polygon: 'Polygon', GraphicLine: 'Line', Group: 'Group', Image: 'Image', Button: 'Button' },
    image: 'Image', table: 'table', yes: 'yes', no: 'no', none: '(none)', empty: '(empty)',
  },
};
export const labelsFor = (lang) => LABELS[lang] || LABELS.fr;

// ---------------------------------------------------------------------------------------------
// Inventory diff
const ITEM_PROPS = ['page', 'bounds', 'rotation', 'fill', 'stroke', 'strokeWeight', 'opacity', 'visible', 'layer', 'name', 'objectStyle',
  'text', 'tableText', 'paragraphStyles', 'fonts', 'pointSize', 'overflows', 'link', 'linkStatus'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Page order diff by page id: stable pages keep their relative order (longest common
// subsequence); pages present on both sides but out of that order are moved.
export function pageStructureDiff(beforeIds, afterIds) {
  const n = beforeIds.length, m = afterIds.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = beforeIds[i] === afterIds[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const stable = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (beforeIds[i] === afterIds[j]) { stable.add(beforeIds[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const inB = new Set(afterIds), inA = new Set(beforeIds);
  return {
    stable,
    moved: beforeIds.filter((id) => inB.has(id) && !stable.has(id)),
    removed: beforeIds.filter((id) => !inB.has(id)),
    added: afterIds.filter((id) => !inA.has(id)),
  };
}

// Change list between two inventories. Objects are matched by their stable id, so an object
// that moved to another page is "modified (page)", not removed + added.
export function diffInventories(before, after) {
  const index = (inv) => {
    const map = new Map();
    for (const page of inv.pages || []) for (const it of page.items || []) map.set(it.id, { ...it, pageId: page.id, pageNumber: page.number, pageName: page.name ?? String(page.number) });
    return map;
  };
  const a = index(before), b = index(after);
  const changes = [];
  for (const [id, old] of a) {
    const cur = b.get(id);
    if (!cur) {
      changes.push({ kind: 'removed', id, before: old, after: null, props: [] });
      continue;
    }
    const props = [];
    for (const p of ITEM_PROPS) {
      // An object changes page when its page is another page, not when its page was reordered
      if (p === 'page') {
        if (old.pageId !== cur.pageId) props.push({ prop: p, before: old.pageName ?? null, after: cur.pageName ?? null });
        continue;
      }
      if (!same(old[p], cur[p])) props.push({ prop: p, before: old[p] ?? null, after: cur[p] ?? null });
    }
    if (props.length) changes.push({ kind: 'modified', id, before: old, after: cur, props });
  }
  for (const [id, cur] of b) if (!a.has(id)) changes.push({ kind: 'added', id, before: null, after: cur, props: [] });

  // Document level: page count, style and swatch definitions
  const docChanges = [];
  const da = before.document || {}, db = after.document || {};
  // Pages added, removed or moved (by page identity, so a page keeps its id when it moves)
  if (da.allPageIds && db.allPageIds) {
    const namesA = new Map((da.allPages || []).map((p) => [p.id, p.name]));
    const namesB = new Map((db.allPages || []).map((p) => [p.id, p.name]));
    const st = pageStructureDiff(da.allPageIds, db.allPageIds);
    const posA = new Map(da.allPageIds.map((id, i) => [id, i + 1]));
    const posB = new Map(db.allPageIds.map((id, i) => [id, i + 1]));
    // Page names follow the numbering, so a moved page is shown with its old and new name
    const nameMove = (id) => {
      const a = namesA.get(id) ?? '?', b = namesB.get(id) ?? '?';
      return a === b ? a : `${a} → ${b}`;
    };
    for (const id of st.removed) docChanges.push({ kind: 'removed', scope: 'page', name: namesA.get(id) ?? '?', before: `position ${posA.get(id)}`, after: null });
    for (const id of st.added) docChanges.push({ kind: 'added', scope: 'page', name: namesB.get(id) ?? '?', before: null, after: `position ${posB.get(id)}` });
    for (const id of st.moved) docChanges.push({ kind: 'moved', scope: 'page', name: nameMove(id), before: `position ${posA.get(id)}`, after: `position ${posB.get(id)}` });
  } else if (!same(da.pageCount, db.pageCount)) {
    docChanges.push({ kind: 'modified', scope: 'pageCount', name: '', before: da.pageCount, after: db.pageCount });
  }
  for (const [scope, key] of [['pstyle', 'paragraphStyles'], ['cstyle', 'characterStyles'], ['swatch', 'swatches']]) {
    const ma = new Map((da[key] || []).map((s) => [s.name, s.value]));
    const mb = new Map((db[key] || []).map((s) => [s.name, s.value]));
    for (const [name, v] of ma) {
      if (!mb.has(name)) docChanges.push({ kind: 'removed', scope, name, before: v, after: null });
      else if (!same(v, mb.get(name))) docChanges.push({ kind: 'modified', scope, name, before: v, after: mb.get(name) });
    }
    for (const [name, v] of mb) if (!ma.has(name)) docChanges.push({ kind: 'added', scope, name, before: null, after: v });
  }

  // Stable, readable order: by page, then top to bottom, then left to right
  const pos = (c) => {
    const it = c.after || c.before;
    const pg = it.pageNumber ?? 9999;
    const bd = it.bounds || [0, 0, 0, 0];
    return [pg, Math.round(bd[0]), Math.round(bd[1])];
  };
  changes.sort((x, y) => {
    const px = pos(x), py = pos(y);
    return px[0] - py[0] || px[1] - py[1] || px[2] - py[2];
  });
  changes.forEach((c, i) => { c.zone = i + 1; });
  return { changes, docChanges };
}

// ---------------------------------------------------------------------------------------------
// Word-level text diff for the table: removed words ~~struck~~ in "before", added words **bold**
// in "after", long unchanged runs shortened to "…".
const tokenize = (s) => String(s ?? '').replace(/\r\n?/g, '\n').split(/(\s+)/).filter((t) => t !== '');

export function wordDiff(a, b) {
  const x = tokenize(a), y = tokenize(b);
  // Trim the common prefix and suffix so the LCS works on the changed middle only
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length, endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) { endX--; endY--; }
  const mx = x.slice(start, endX), my = y.slice(start, endY);
  const ops = x.slice(0, start).map((t) => ({ op: '=', t }));
  if (mx.length * my.length > 4_000_000) {
    mx.forEach((t) => ops.push({ op: '-', t }));
    my.forEach((t) => ops.push({ op: '+', t }));
  } else {
    const n = mx.length, m = my.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = mx[i] === my[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (mx[i] === my[j]) { ops.push({ op: '=', t: mx[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', t: mx[i] }); i++; }
      else { ops.push({ op: '+', t: my[j] }); j++; }
    }
    while (i < n) ops.push({ op: '-', t: mx[i++] });
    while (j < m) ops.push({ op: '+', t: my[j++] });
  }
  x.slice(endX).forEach((t) => ops.push({ op: '=', t }));
  return ops;
}

const CONTEXT_WORDS = 6;
const cell = (s) => String(s).replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\uFFFC/g, '▣').replace(/(^|[^\\])\|/g, '$1\\|').replace(/(^|[^\\])\|/g, '$1\\|').replace(/\n/g, ' ¶ ').replace(/\s{2,}/g, ' ').trim();

// Markdown for one side of a text diff ('-' = before, '+' = after). Runs of unchanged words are
// cut down to CONTEXT_WORDS around each change, so the reader sees what changed, not the story.
function textSide(ops, side) {
  const runs = [];
  for (const o of ops) {
    const changed = o.op !== '=';
    const last = runs[runs.length - 1];
    if (last && last.changed === changed) last.ops.push(o);
    else runs.push({ changed, ops: [o] });
  }
  // A lone space kept between two changes belongs to the change: "~~Taux de~~", not "~~Taux~~ ~~de~~"
  for (let i = 1; i < runs.length - 1; i++) {
    if (!runs[i].changed && runs[i - 1].changed && runs[i + 1].changed && runs[i].ops.every((o) => !/\S/.test(o.t))) {
      const ws = runs[i].ops.map((o) => ({ op: '±', t: o.t }));
      runs.splice(i - 1, 3, { changed: true, ops: [...runs[i - 1].ops, ...ws, ...runs[i + 1].ops] });
      i--;
    }
  }
  const mark = side === '-' ? '~~' : '**';
  const words = (list) => list.map((o) => o.t).join('').split(/\s+/).filter(Boolean);
  let out = '';
  runs.forEach((run, i) => {
    if (run.changed) {
      const text = run.ops.filter((o) => o.op === side || o.op === '±').map((o) => o.t).join('').replace(/\s+/g, ' ').trim();
      if (text) out += ` ${mark}${text}${mark} `;
      return;
    }
    const w = words(run.ops);
    const first = i === 0, lastRun = i === runs.length - 1;
    if (first && lastRun) out += w.join(' ');
    else if (first) out += (w.length > CONTEXT_WORDS ? '… ' : '') + w.slice(-CONTEXT_WORDS).join(' ');
    else if (lastRun) out += w.slice(0, CONTEXT_WORDS).join(' ') + (w.length > CONTEXT_WORDS ? ' …' : '');
    else if (w.length > CONTEXT_WORDS * 2) out += `${w.slice(0, CONTEXT_WORDS).join(' ')} … ${w.slice(-CONTEXT_WORDS).join(' ')}`;
    else out += w.join(' ');
  });
  return out.replace(/\s+/g, ' ').trim();
}

export function textDiffCells(a, b, maxLen = 400) {
  const ops = wordDiff(a, b);
  const clip = (s) => (s.length > maxLen ? s.slice(0, maxLen) + ' …' : s);
  return { before: clip(cell(textSide(ops, '-'))), after: clip(cell(textSide(ops, '+'))) };
}

// ---------------------------------------------------------------------------------------------
// Review table template
const fmtNum = (n) => (Math.round(n * 10) / 10).toString();

function formatValue(prop, v, L) {
  if (v === null || v === undefined) return L.none;
  if (prop === 'bounds' && Array.isArray(v)) {
    const [top, left, bottom, right] = v;
    return `x ${fmtNum(left)} · y ${fmtNum(top)} · ${fmtNum(right - left)} × ${fmtNum(bottom - top)} mm`;
  }
  if (typeof v === 'boolean') return v ? L.yes : L.no;
  if (prop === 'opacity') return `${fmtNum(v)} %`;
  if (prop === 'rotation') return `${fmtNum(v)}°`;
  if (prop === 'strokeWeight' || prop === 'pointSize') return Array.isArray(v) ? (v.length ? v.map((n) => `${fmtNum(n)} pt`).join(', ') : L.none) : `${fmtNum(v)} pt`;
  if (Array.isArray(v)) return v.length ? v.join(', ') : L.none;
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join('/') : x}`).join(', ');
  if (v === '') return L.empty;
  return String(v);
}

export function describeItem(it, L) {
  if (!it) return '';
  let type = L.types[it.type] || it.type;
  if (it.link && it.type !== 'TextFrame') type = L.image;
  let hint = it.name || '';
  const plainText = String(it.text || '').replace(/[\u0000-\u001F\uFFFC]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!hint && plainText) hint = plainText.slice(0, 30) + (plainText.length > 30 ? '…' : '');
  if (!hint && it.tableText) hint = L.table;
  if (!hint && it.link) hint = it.link;
  return `${type} #${it.id}${hint ? ` «${hint}»` : ''}`;
}

// Rows of the review table, one per changed property
export function changeRows(diff, visualZones, L) {
  const rows = [];
  const pageOf = (c) => {
    const pa = c.before?.pageNumber, pb = c.after?.pageNumber;
    if (pa && pb && pa !== pb) return `${pa} → ${pb}`;
    return String(pb || pa || L.pasteboard);
  };
  for (const c of diff.changes) {
    const it = c.after || c.before;
    const base = { zone: String(c.zone), page: pageOf(c), element: describeItem(it, L), kind: L.kinds[c.kind] };
    if (c.kind === 'added') {
      const what = it.type === 'TextFrame' ? textDiffCells('', it.text || '').after : formatValue('bounds', it.bounds, L);
      rows.push({ ...base, property: L.props.object, before: '—', after: cell(what) });
    } else if (c.kind === 'removed') {
      const what = it.type === 'TextFrame' ? textDiffCells(it.text || '', '').before : formatValue('bounds', it.bounds, L);
      rows.push({ ...base, property: L.props.object, before: cell(what), after: '—' });
    } else {
      for (const p of c.props) {
        if (p.prop === 'text' || p.prop === 'tableText') {
          const t = textDiffCells(p.before, p.after);
          rows.push({ ...base, property: L.props[p.prop], before: t.before || L.empty, after: t.after || L.empty });
        } else {
          rows.push({ ...base, ...(p.prop === 'page' ? { kind: L.kinds.moved } : {}), property: L.props[p.prop] || p.prop, before: cell(formatValue(p.prop, p.before, L)), after: cell(formatValue(p.prop, p.after, L)) });
        }
      }
    }
  }
  for (const z of visualZones) {
    rows.push({ zone: String(z.zone), page: String(z.pageNumber), element: '—', kind: L.kinds.visual, property: z.renamedFrom ? L.visualRenamed(z.renamedFrom, z.pageNumber) : L.visualDetail, before: '', after: '' });
  }
  for (const d of diff.docChanges) {
    let { before: vb, after: va } = d;
    if (d.kind === 'modified' && vb && va && typeof vb === 'object' && typeof va === 'object') {
      const keys = [...new Set([...Object.keys(vb), ...Object.keys(va)])].filter((k) => !same(vb[k], va[k]));
      vb = Object.fromEntries(keys.map((k) => [k, vb[k] ?? '—']));
      va = Object.fromEntries(keys.map((k) => [k, va[k] ?? '—']));
    }
    d.before = vb; d.after = va;
    rows.push({
      zone: '—', page: L.document, element: d.name ? `${L.props[d.scope]} «${d.name}»` : L.props[d.scope],
      property: L.props[d.scope], kind: L.kinds[d.kind],
      before: d.before === null ? '—' : cell(formatValue(d.scope, d.before, L)),
      after: d.after === null ? '—' : cell(formatValue(d.scope, d.after, L)),
    });
  }
  return rows;
}

// Same change on many objects (a style edit, a global replace) -> one row:
// "1–21 | 5, 10, … | 21 × Bloc texte | Corps | 11 pt | 8 pt"
const compressNums = (nums) => {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i + 1 ? `${nums[i]}–${nums[j]}` : j === i + 1 ? `${nums[i]}, ${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(', ');
};
export function groupRows(rows, minGroup = 3) {
  const key = (r) => [r.property, r.before, r.after, r.kind].join('\u0001');
  const groups = new Map();
  for (const r of rows) {
    if (r.zone === '—' || !r.zone) { groups.set(Symbol('doc'), [r]); continue; }
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < minGroup) { out.push(...list); continue; }
    const zones = [...new Set(list.map((r) => Number(r.zone)))].sort((a, b) => a - b);
    const pages = [...new Set(list.map((r) => r.page))];
    const kinds = [...new Set(list.map((r) => r.element.replace(/ #.*$/, '')))];
    out.push({ ...list[0], zone: compressNums(zones), page: pages.length > 10 ? `${pages.slice(0, 8).join(', ')} … (${pages.length})` : pages.join(', '), element: `${list.length} × ${kinds.join(' / ')}` });
  }
  return out.sort((a, b) => (parseInt(a.zone, 10) || 1e9) - (parseInt(b.zone, 10) || 1e9));
}

export function changesTable(rows, L) {
  const head = `| ${L.cols.join(' | ')} |\n|${L.cols.map((c) => (c === '#' ? '---:' : '---')).join('|')}|`;
  const body = rows.map((r) => `| ${[r.zone, r.page, r.element, r.property, r.before, r.after, r.kind].map((v) => cell(v ?? '')).join(' | ')} |`);
  return [head, ...body].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Pixel diff: changed areas of two page images, as pixel rectangles
export function pixelDiffRegions(a, b, { cell: cs = 8, threshold = 40, minPixels = 3, gap = 2 } = {}) {
  const w = Math.max(a.width, b.width), h = Math.max(a.height, b.height);
  const cols = Math.ceil(w / cs), rows = Math.ceil(h / cs);
  const changed = new Uint8Array(cols * rows);
  if (a.width === b.width && a.height === b.height) {
    markChangedCells(a, b, cs, threshold, minPixels, cols, rows, changed);
  } else {
    markChangedCellsAnySize(a, b, w, h, cs, threshold, minPixels, cols, rows, changed);
  }
  return groupCells(changed, cols, rows, cs, w, h, gap);
}

// Same-size images (the usual case): whole pixels compared as 32-bit words first, so unchanged
// areas cost one comparison per pixel; same result as the general loop below
function markChangedCells(a, b, cs, threshold, minPixels, cols, rows, changed) {
  const w = a.width, h = a.height, da = a.data, db = b.data;
  const aligned = da.byteOffset % 4 === 0 && db.byteOffset % 4 === 0;
  const wa = aligned ? new Uint32Array(da.buffer, da.byteOffset, w * h) : null;
  const wb = aligned ? new Uint32Array(db.buffer, db.byteOffset, w * h) : null;
  for (let cy = 0; cy < rows; cy++) {
    const y1 = Math.min(h, (cy + 1) * cs);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * cs, x1 = Math.min(w, (cx + 1) * cs);
      let count = 0;
      for (let y = cy * cs; y < y1 && count < minPixels; y++) {
        for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
          if (wa && wa[i] === wb[i]) continue;
          const o = i * 4;
          const d0 = da[o] - db[o], d1 = da[o + 1] - db[o + 1], d2 = da[o + 2] - db[o + 2];
          const d = Math.max(d0 < 0 ? -d0 : d0, d1 < 0 ? -d1 : d1, d2 < 0 ? -d2 : d2);
          if (d > threshold && ++count >= minPixels) break;
        }
      }
      if (count >= minPixels) changed[cy * cols + cx] = 1;
    }
  }
}

function markChangedCellsAnySize(a, b, w, h, cs, threshold, minPixels, cols, rows, changed) {
  const px = (img, x, y, c) => (x < img.width && y < img.height ? img.data[(y * img.width + x) * 4 + c] : 255);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let count = 0;
      for (let y = cy * cs; y < Math.min(h, (cy + 1) * cs) && count < minPixels; y++) {
        for (let x = cx * cs; x < Math.min(w, (cx + 1) * cs); x++) {
          const d = Math.max(Math.abs(px(a, x, y, 0) - px(b, x, y, 0)), Math.abs(px(a, x, y, 1) - px(b, x, y, 1)), Math.abs(px(a, x, y, 2) - px(b, x, y, 2)));
          if (d > threshold && ++count >= minPixels) break;
        }
      }
      if (count >= minPixels) changed[cy * cols + cx] = 1;
    }
  }
}

// Group changed cells that are at most `gap` cells apart
function groupCells(changed, cols, rows, cs, w, h, gap) {
  const seen = new Uint8Array(cols * rows);
  const rects = [];
  for (let i = 0; i < changed.length; i++) {
    if (!changed[i] || seen[i]) continue;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop();
      const kx = k % cols, ky = (k - kx) / cols;
      minX = Math.min(minX, kx); maxX = Math.max(maxX, kx); minY = Math.min(minY, ky); maxY = Math.max(maxY, ky);
      for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) {
        const nx = kx + dx, ny = ky + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (changed[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    rects.push({ x: minX * cs, y: minY * cs, w: Math.min(w, (maxX + 1) * cs) - minX * cs, h: Math.min(h, (maxY + 1) * cs) - minY * cs });
  }
  return mergeRects(rects);
}

export const intersects = (r, s, pad = 0) => r.x - pad < s.x + s.w && s.x - pad < r.x + r.w && r.y - pad < s.y + s.h && s.y - pad < r.y + r.h;

function mergeRects(rects) {
  let merged = true;
  const out = rects.slice();
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (intersects(out[i], out[j])) {
          const r = out[i], s = out[j];
          const x = Math.min(r.x, s.x), y = Math.min(r.y, s.y);
          out[i] = { x, y, w: Math.max(r.x + r.w, s.x + s.w) - x, h: Math.max(r.y + r.h, s.y + s.h) - y };
          out.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return out;
}

// Page-relative bounds in mm [top, left, bottom, right] -> pixel rect on an image of the page,
// clipped to the image; null when the object is entirely off the page
export function boundsToRect(bounds, pageWidthMm, img) {
  if (!Array.isArray(bounds) || !pageWidthMm) return null;
  const s = img.width / pageWidthMm;
  const x0 = Math.max(0, Math.floor(bounds[1] * s)), y0 = Math.max(0, Math.floor(bounds[0] * s));
  const x1 = Math.min(img.width, Math.ceil(bounds[3] * s)), y1 = Math.min(img.height, Math.ceil(bounds[2] * s));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------------------------------------
// Drawing (anti-aliased shapes and Inter text: lib/raster.js)

export { fillRect, strokeRect, scaleImage, textWidth };

// Colour of a zone by kind of change: modified = orange, added = green, removed = red
export const ORANGE = [245, 150, 0];
const WHITE = [255, 255, 255];
const INK = [31, 41, 55];          // header bars
const MUTED = [156, 163, 175];     // secondary text on the header bars
const EDGE = [209, 213, 219];      // light grey edge around pages
const LINK = [203, 208, 216];      // grey links of the page map
const PLACEHOLDER = [243, 244, 246];
export const KIND_RGB = { modified: ORANGE, visual: ORANGE, moved: ORANGE, added: GREEN, removed: RED };

// Dotted frame just outside r: round dots with a thin white halo, visible on any colour
export function dottedRect(img, r, rgb, t) {
  const rad = Math.max(0.9, t * 0.8);
  const step = Math.max(4, Math.round(rad * 4));
  const x0 = r.x - rad, y0 = r.y - rad, x1 = r.x + r.w + rad, y1 = r.y + r.h + rad;
  const dots = [];
  const along = (a, b, put) => {
    const n = Math.max(1, Math.round((b - a) / step));
    for (let k = 0; k <= n; k++) put(a + ((b - a) * k) / n);
  };
  along(x0, x1, (x) => { dots.push([x, y0]); dots.push([x, y1]); });
  along(y0, y1, (y) => { if (y > y0 && y < y1) { dots.push([x0, y]); dots.push([x1, y]); } });
  for (const [x, y] of dots) circle(img, x, y, rad + 0.9, WHITE, 0.75);
  for (const [x, y] of dots) circle(img, x, y, rad, rgb);
}

// Page image on paper white (fallback when the export has transparent areas)
function onPaper(img) {
  const out = createImage(img.width, img.height, [255, 255, 255, 255]);
  blit(img, out, 0, 0);
  return out;
}

// Small rounded label (zone numbers, page names): text on a coloured pill with a white rim
function pill(img, text, x, y, size, rgb) {
  const tw = textWidth(text, size), lh = lineHeight(size);
  const h = lh + 2, w = Math.max(h, tw + Math.round(size * 0.9));
  roundRect(img, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2, WHITE);
  roundRect(img, x, y, w, h, h / 2, rgb);
  drawString(img, text, x + (w - tw) / 2, y + (h - lh) / 2, size, WHITE);
  return { w, h };
}
const pillSize = (text, size) => {
  const h = lineHeight(size) + 2;
  return { w: Math.max(h, textWidth(text, size) + Math.round(size * 0.9)), h };
};

// Zones: [{ rect, zone, kind }]. Draws dotted frames and small zone numbers on a copy of img.
// No tint inside the frames: a tint would hide or fake a colour change.
export function markZones(img, zones, fallbackRgb = ORANGE) {
  const out = onPaper(img);
  const size = Math.max(img.width, img.height);
  const t = Math.max(1, size / 700);
  const fs = size > 1600 ? 13 : 11;
  const colour = (z) => KIND_RGB[z.kind] || fallbackRgb;
  for (const z of zones) dottedRect(out, z.rect, colour(z), t);
  for (const z of zones) {
    if (z.noLabel) continue;
    const label = String(z.zone);
    const { w, h } = pillSize(label, fs);
    let lx = z.rect.x - 2, ly = z.rect.y - h - 4;
    if (ly < 1) ly = z.rect.y + 3;
    lx = Math.max(1, Math.min(lx, out.width - w - 1));
    pill(out, label, lx, ly, fs, colour(z));
  }
  return out;
}

// Gutter minimap (like the diff gutter of an editor): one bar per zone, as tall as the zone,
// at the same height as the zone on the page. Overlapping zones are put side by side in lanes,
// so a small change is not hidden behind a large one.
export function drawGutter(out, x, y, w, h, zones, maxLanes = 3) {
  roundRect(out, x, y, w, h, 3, WHITE);
  const sorted = zones.slice().sort((a, b) => a.rect.y - b.rect.y || b.rect.h - a.rect.h);
  const laneEnd = [];
  const placed = sorted.map((z) => {
    let lane = laneEnd.findIndex((end) => end <= z.rect.y);
    if (lane < 0) lane = laneEnd.length < maxLanes ? laneEnd.length : maxLanes - 1;
    laneEnd[lane] = Math.max(laneEnd[lane] || 0, z.rect.y + z.rect.h + 2);
    return { z, lane };
  });
  const lanes = Math.max(1, laneEnd.length);
  const inset = 3, gap = 2;
  const laneW = Math.max(2, (w - 2 * inset - (lanes - 1) * gap) / lanes);
  for (const { z, lane } of placed) {
    const top = Math.max(0, z.rect.y), bottom = Math.min(h, z.rect.y + z.rect.h);
    const bh = Math.max(4, bottom - top);
    roundRect(out, x + inset + lane * (laneW + gap), y + Math.min(top, h - bh), laneW, bh, Math.min(laneW / 2, 2.5), KIND_RGB[z.kind] || ORANGE);
  }
}

// Dark rounded header bar: title on the left (bold part + muted part), legend chips on the right
function headerBar(out, x, y, w, h, title, subtitle, legend) {
  roundRect(out, x, y, w, h, 6, INK);
  const fs = 13, ls = 11, padX = 10;
  let right = x + w - padX;
  for (const k of legend.slice().reverse()) {
    const word = legend.labels[k];
    const tw = textWidth(word, ls);
    drawString(out, word, right - tw, y + (h - lineHeight(ls)) / 2, ls, [229, 231, 235]);
    circle(out, right - tw - 8, y + h / 2, 3.5, KIND_RGB[k]);
    right -= tw + 22;
  }
  const room = right - (x + padX) - 6;
  const main = fitText(title, fs, room);
  const ty = y + (h - lineHeight(fs)) / 2;
  const mw = drawString(out, main, x + padX, ty, fs, WHITE);
  if (subtitle && main === title && textWidth(subtitle, fs) + mw + 6 <= room) drawString(out, subtitle, x + padX + mw + 6, ty, fs, MUTED);
}

// Page with its soft shadow and light grey edge
function paper(out, img, x, y) {
  shadow(out, { x, y, w: img.width, h: img.height }, { blur: 7, alpha: 0.14, dy: 1.5 });
  blit(img, out, x, y);
  strokeRect(out, { x, y, w: img.width, h: img.height }, EDGE, 1);
}

// "Before | After" side by side for one page. before/after may be null (page added/removed).
// Layout: [gutter][page BEFORE]   [page AFTER][gutter], on a transparent canvas; dark rounded
// headers with a small legend of the colours used on that side.
export function buildPageComposite({ before, after, beforeZones, afterZones, pageNumber, L, cropped = false, beforeName = pageNumber, afterName = pageNumber }) {
  const pad = 10;                                 // room for the shadows
  const headerH = 28, headerGap = 8;
  const gapW = 24;
  const w = Math.max(before?.width || 0, after?.width || 0, 240);
  const h = Math.max(before?.height || 0, after?.height || 0);
  const gw = Math.max(22, Math.round(w / 26));   // gutter width
  const gm = 5;                                  // margin between page and gutter
  const panelW = w + gm + gw;
  const top = pad + headerH + headerGap;
  const out = createImage(pad + panelW * 2 + gapW + pad, top + h + pad, [0, 0, 0, 0]);

  const panel = (img, zones, x, title, name, missing, legendKinds, gutterLeft) => {
    const pageX = gutterLeft ? x + gw + gm : x;
    const gutterX = gutterLeft ? x : x + (img ? img.width : w) + gm;   // the gutter hugs the page
    const legend = legendKinds.filter((k) => zones.some((z) => (z.kind === 'visual' ? 'modified' : z.kind) === k));
    legend.labels = L.legend;
    headerBar(out, x, pad, panelW, headerH, `${title} · ${L.page.toLowerCase()} ${name}`, cropped ? `(${L.detail})` : '', legend);
    if (img) {
      paper(out, markZones(img, zones), pageX, top);
      shadow(out, { x: gutterX, y: top, w: gw, h: img.height }, { blur: 5, alpha: 0.08, dy: 1, radius: 3 });
      drawGutter(out, gutterX, top, gw, img.height, zones);
    } else {
      roundRect(out, pageX, top, w, h, 4, PLACEHOLDER);
      strokeRoundRect(out, pageX, top, w, h, 4, 1, EDGE);
      const fs = 16, tw = textWidth(missing, fs);
      drawString(out, missing, pageX + (w - tw) / 2, top + h / 2 - lineHeight(fs) / 2, fs, [107, 114, 128]);
    }
  };
  panel(before, beforeZones, pad, L.before, beforeName, L.noPage, ['modified', 'moved', 'removed'], true);
  panel(after, afterZones, pad + panelW + gapW, L.after, afterName, L.removedPage, ['modified', 'moved', 'added'], false);
  out.layout = { beforeX: pad + gw + gm, afterX: pad + panelW + gapW, top };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lines and arrows

export function drawLine(img, x0, y0, x1, y1, rgb, t = 2, alpha = 1) {
  line(img, x0, y0, x1, y1, t, rgb, alpha);
}

// Arrow from (x0,y0) to (x1,y1) with a filled head; halo = white outline for busy backgrounds
export function drawArrow(img, x0, y0, x1, y1, rgb, t = 2, halo = false) {
  circle(img, x0, y0, t * 1.6 + (halo ? 1.2 : 0), WHITE, halo ? 0.9 : 0);
  circle(img, x0, y0, t * 1.6, rgb);
  arrow(img, x0, y0, x1, y1, t, rgb, { halo });
}

// ---------------------------------------------------------------------------------------------
// Page map: the document seen from above, as spreads (like the Pages panel of InDesign).
// BEFORE spreads on the left, AFTER spreads on the right. Identical spreads share a row and
// long runs of them are folded; changed spreads are listed side by side. Every page present on
// both sides is linked: a thin grey line when it only shifted (reflow after an insertion or
// a deletion), an orange arrow when it was moved. Removed pages are framed red, added green.
// before / after: [{ id, name, spread, side, thumb }] in document order (thumb may be null)

export function groupSpreads(pages) {
  const out = [];
  for (const p of pages) {
    const last = out[out.length - 1];
    if (last && p.spread != null && last.spread === p.spread) last.pages.push(p);
    else out.push({ spread: p.spread ?? `page-${p.id}`, pages: [p] });
  }
  for (const sp of out) sp.key = sp.pages.map((p) => p.id).join(',');
  return out;
}

export function spreadMapRows(before, after, context = 1) {
  const A = groupSpreads(before), B = groupSpreads(after);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = A[i].key === B[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const rows = [];
  let hunkL = [], hunkR = [];
  const flush = () => {
    for (let k = 0; k < Math.max(hunkL.length, hunkR.length); k++) rows.push({ left: hunkL[k] || null, right: hunkR[k] || null, same: false });
    hunkL = []; hunkR = [];
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i].key === B[j].key) { flush(); rows.push({ left: A[i], right: B[j], same: true }); i++; j++; }
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) { hunkL.push(A[i]); i++; }
    else { hunkR.push(B[j]); j++; }
  }
  flush();
  const keep = rows.map((_, k) => rows.slice(Math.max(0, k - context), k + context + 1).some((r) => !r.same));
  const out = [];
  for (let k = 0; k < rows.length;) {
    if (keep[k]) { out.push(rows[k]); k++; continue; }
    let e = k;
    while (e < rows.length && !keep[e]) e++;
    if (e - k <= 2) out.push(...rows.slice(k, e));
    else out.push({ fold: e - k });
    k = e;
  }
  return out;
}

export function buildPageMap({ before, after, st, L }) {
  const rows = spreadMapRows(before, after);
  const thumbs = [...before, ...after].map((p) => p.thumb).filter(Boolean);
  const TH = thumbs.length ? thumbs[0].height : 160;
  const TW = thumbs.length ? Math.max(...thumbs.map((t) => t.width)) : Math.round(TH * 0.71);
  // Binding: left-hand pages sit left of the spine, right-hand pages right of it (single-sided
  // documents have no left-hand pages, so their pages start at the spine)
  const leftCount = (sp) => sp.pages.filter((p) => /LEFT/.test(p.side || '')).length;
  const spreads = [...groupSpreads(before), ...groupSpreads(after)];
  const maxLeft = Math.max(1, ...spreads.map(leftCount));
  const maxRight = Math.max(1, ...spreads.map((sp) => sp.pages.length - leftCount(sp)));
  const CW = (maxLeft + maxRight) * TW;      // column width
  const spineOff = maxLeft * TW;             // spine x inside a column
  const nameFs = 13, nameH = lineHeight(nameFs) + 10;
  const pad = 16, headerH = 32, headerGap = 14, AW = Math.max(150, Math.round(TW * 1.2));
  const rowH = TH + nameH + 14, foldH = 30;
  const colL = pad, colR = colL + CW + AW;
  const width = colR + CW + pad;
  const top = pad + headerH + headerGap;
  const height = top + rows.reduce((h, r) => h + (r.fold ? foldH : rowH), 0) + pad - 6;
  const out = createImage(width, height, [255, 255, 255, 255]);
  const bar = (x, label) => {
    roundRect(out, x - 6, pad, CW + 12, headerH, 7, INK);
    drawString(out, label, x - 6 + (CW + 12 - textWidth(label, 16)) / 2, pad + (headerH - lineHeight(16)) / 2, 16, WHITE);
  };
  bar(colL, L.before);
  bar(colR, L.after);

  const rem = new Set(st.removed), mov = new Set(st.moved), add = new Set(st.added);
  // page boxes: each spread placed on the column's spine, as in the Pages panel of InDesign
  const layout = (sp, x0, y) => {
    const start = x0 + spineOff - leftCount(sp) * TW;
    return sp.pages.map((p, k) => {
      const w = p.thumb ? p.thumb.width : TW, h = p.thumb ? p.thumb.height : TH;
      const slot = start + k * TW;
      // a page narrower than the slot hugs the spine side
      const x = k < leftCount(sp) ? slot + (TW - w) : slot;
      return { p, x, y, w, h };
    });
  };
  const boxes = { left: new Map(), right: new Map() };
  const placed = [];
  const folds = [];
  let y = top;
  for (const r of rows) {
    if (r.fold) { folds.push({ y, n: r.fold }); y += foldH; continue; }
    if (r.left) for (const bx of layout(r.left, colL, y)) { boxes.left.set(bx.p.id, bx); placed.push({ ...bx, kind: rem.has(bx.p.id) ? 'removed' : mov.has(bx.p.id) ? 'moved' : null }); }
    if (r.right) for (const bx of layout(r.right, colR, y)) { boxes.right.set(bx.p.id, bx); placed.push({ ...bx, kind: add.has(bx.p.id) ? 'added' : mov.has(bx.p.id) ? 'moved' : null }); }
    y += rowH;
  }
  // spine of each column, grey links under the pages, arrows for moved pages last
  for (const x of [colL + spineOff, colR + spineOff]) fillRect(out, x, top - 6, 1, height - top - pad + 6, [229, 231, 235]);
  for (const f of folds) {
    const label = `··· ${f.n} ${L.sameSpreads || L.spreadsWord} ···`;
    const tw = textWidth(label, 11), cy = f.y + foldH / 2 - 3;
    const lx = Math.round((width - tw) / 2);
    fillRect(out, lx - 14, cy - lineHeight(11) / 2 - 3, tw + 28, lineHeight(11) + 6, WHITE);
    roundRect(out, lx - 10, cy - lineHeight(11) / 2 - 3, tw + 20, lineHeight(11) + 6, (lineHeight(11) + 6) / 2, PLACEHOLDER);
    drawString(out, label, lx, cy - lineHeight(11) / 2, 11, [107, 114, 128]);
  }
  for (const [id, a] of boxes.left) {
    const b = boxes.right.get(id);
    if (!b || mov.has(id)) continue;
    line(out, a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, 1.2, LINK);
  }
  for (const bx of placed) {
    shadow(out, bx, { blur: 6, alpha: 0.12, dy: 1.5, radius: 1 });
    if (bx.p.thumb) blit(bx.p.thumb, out, bx.x, bx.y);
    else fillRect(out, bx.x, bx.y, bx.w, bx.h, PLACEHOLDER);
    strokeRect(out, bx, EDGE, 1);
    if (bx.kind) strokeRoundRect(out, bx.x - 3, bx.y - 3, bx.w + 6, bx.h + 6, 3, 2.5, KIND_RGB[bx.kind]);
    const name = String(bx.p.name);
    const nx = bx.x + bx.w / 2, ny = bx.y + bx.h + 7;
    if (bx.kind) {
      const { w } = pillSize(name, nameFs - 2);
      pill(out, name, Math.round(nx - w / 2), ny, nameFs - 2, KIND_RGB[bx.kind]);
    } else {
      drawString(out, name, Math.round(nx - textWidth(name, nameFs) / 2), ny, nameFs, [107, 114, 128]);
    }
  }
  for (const id of st.moved) {
    const a = boxes.left.get(id), b = boxes.right.get(id);
    if (a && b) drawArrow(out, a.x + a.w + 6, a.y + a.h / 2, b.x - 6, b.y + b.h / 2, ORANGE, 3, true);
  }
  return out;
}

// Objects that changed page: source page BEFORE | destination page AFTER, an arrow from each
// object's old place to its new place. links: [{ zone, from: rect on src, to: rect on dst }]
export function buildMoveComposite({ src, dst, links, L }) {
  const zonesL = links.map((l) => ({ rect: l.from, zone: l.zone, kind: 'moved' }));
  const zonesR = links.map((l) => ({ rect: l.to, zone: l.zone, kind: 'moved' }));
  const out = buildPageComposite({ before: src.img, after: dst.img, beforeZones: zonesL, afterZones: zonesR, L, beforeName: src.name, afterName: dst.name });
  const { beforeX, afterX, top } = out.layout;
  for (const l of links) {
    drawArrow(out, beforeX + l.from.x + l.from.w, top + l.from.y + l.from.h / 2, afterX + l.to.x - 5, top + l.to.y + l.to.h / 2, ORANGE, 2.5, true);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cropping: show the changed area of the page, not the whole page, when the changes are local.
// Returns null when the crop would not save much (the page is shown whole).
export function cropRectFor(rects, width, height, { margin = 0.06, minFraction = 0.4, maxArea = 0.65 } = {}) {
  if (!rects.length) return null;
  let x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  let x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  const m = Math.round(Math.max(width, height) * margin);
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  const grow = (a, b, min) => {
    if (b - a >= min) return [a, b];
    const c = (a + b) / 2;
    return [c - min / 2, c + min / 2];
  };
  [x0, x1] = grow(x0, x1, width * minFraction);
  [y0, y1] = grow(y0, y1, height * minFraction * 0.6);
  const shift = (a, b, max) => (a < 0 ? [0, Math.min(max, b - a)] : b > max ? [Math.max(0, a - (b - max)), max] : [a, b]);
  [x0, x1] = shift(x0, x1, width);
  [y0, y1] = shift(y0, y1, height);
  const r = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  if (r.w * r.h > width * height * maxArea) return null;
  return r;
}

export function cropImage(img, r) {
  const out = createImage(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const sy = y + r.y;
    if (sy < 0 || sy >= img.height) continue;
    const start = (sy * img.width + r.x) * 4;
    out.data.set(img.data.subarray(start, start + Math.min(r.w, img.width - r.x) * 4), y * r.w * 4);
  }
  return out;
}
