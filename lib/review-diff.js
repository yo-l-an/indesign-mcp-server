// Before/after review: pure functions (no InDesign, no file system) that compare two snapshots
// of a document and draw the result for a project manager.
//
//  * diffInventories   compares the object inventories (text, position, colours, images, styles)
//  * pixelDiffRegions  finds the areas of a page image that changed
//  * buildPageComposite draws "before | after" side by side with numbered red / green zones
//  * changesTable      renders the changes as a Markdown table (the review table template)
//
// Images are { width, height, data: RGBA Uint8Array } (see lib/png.js).

import { createImage } from './png.js';

export const RED = [220, 38, 38];
export const GREEN = [0, 200, 70];
const GREY = [107, 114, 128];

// ---------------------------------------------------------------------------------------------
// Labels (French by default: the review is read by the project manager)
export const LABELS = {
  fr: {
    before: 'AVANT', after: 'APRES', detail: 'DETAIL', pagesWord: 'pages', legend: { modified: 'MODIFIE', moved: 'DEPLACE', added: 'AJOUTE', removed: 'SUPPRIME' }, page: 'PAGE', document: 'Document', noPage: 'nouvelle page', removedPage: 'page supprimee',
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
    before: 'BEFORE', after: 'AFTER', detail: 'DETAIL', pagesWord: 'pages', legend: { modified: 'MODIFIED', moved: 'MOVED', added: 'ADDED', removed: 'REMOVED' }, page: 'PAGE', document: 'Document', noPage: 'new page', removedPage: 'removed page',
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
  // Group changed cells that are at most `gap` cells apart
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
// Drawing
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'], T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], 1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'], 3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'], 5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'], 7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'], 9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'], ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'], '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'], ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function fillRect(img, x, y, w, h, rgb, alpha = 1) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  const d = img.data;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * img.width + xx) * 4;
      d[o] = Math.round(d[o] * (1 - alpha) + rgb[0] * alpha);
      d[o + 1] = Math.round(d[o + 1] * (1 - alpha) + rgb[1] * alpha);
      d[o + 2] = Math.round(d[o + 2] * (1 - alpha) + rgb[2] * alpha);
      d[o + 3] = 255;
    }
  }
}

export function strokeRect(img, r, rgb, t) {
  fillRect(img, r.x - t, r.y - t, r.w + 2 * t, t, rgb);
  fillRect(img, r.x - t, r.y + r.h, r.w + 2 * t, t, rgb);
  fillRect(img, r.x - t, r.y, t, r.h, rgb);
  fillRect(img, r.x + r.w, r.y, t, r.h, rgb);
}

export const textWidth = (text, scale) => plain(text).length * 6 * scale - scale;

export function drawText(img, text, x, y, scale, rgb) {
  let cx = x;
  for (const ch of plain(text)) {
    const g = FONT[ch] || FONT[' '];
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      if (g[row][col] === '#') fillRect(img, cx + col * scale, y + row * scale, scale, scale, rgb);
    }
    cx += 6 * scale;
  }
  return cx - x - scale;
}

function blit(src, dst, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4;
      const a = src.data[s + 3] / 255;
      dst.data[d] = Math.round(src.data[s] * a + dst.data[d] * (1 - a));
      dst.data[d + 1] = Math.round(src.data[s + 1] * a + dst.data[d + 1] * (1 - a));
      dst.data[d + 2] = Math.round(src.data[s + 2] * a + dst.data[d + 2] * (1 - a));
      dst.data[d + 3] = 255;
    }
  }
}

function copyImage(img) {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

// Colour of a zone by kind of change: modified = orange, added = green, removed = red
export const ORANGE = [245, 150, 0];
const WHITE = [255, 255, 255];
const HEADER = [55, 65, 81];
export const KIND_RGB = { modified: ORANGE, visual: ORANGE, moved: ORANGE, added: GREEN, removed: RED };

// Dotted frame drawn just outside r, with a thin white halo around each dot so it stays visible
// on any colour
export function dottedRect(img, r, rgb, t) {
  const step = 3 * t + 1;
  const dots = [];
  const x0 = r.x - t, y0 = r.y - t, x1 = r.x + r.w, y1 = r.y + r.h;
  for (let x = x0; x <= x1; x += step) { dots.push([x, y0]); dots.push([x, y1]); }
  for (let y = y0 + step; y < y1; y += step) { dots.push([x0, y]); dots.push([x1, y]); }
  // Thin halo: 1 px above/below/left/right of each dot (no corners), half transparent
  for (const [x, y] of dots) {
    fillRect(img, x, y - 1, t, 1, WHITE, 0.6);
    fillRect(img, x, y + t, t, 1, WHITE, 0.6);
    fillRect(img, x - 1, y, 1, t, WHITE, 0.6);
    fillRect(img, x + t, y, 1, t, WHITE, 0.6);
  }
  for (const [x, y] of dots) fillRect(img, x, y, t, t, rgb);
}

// Page image on paper white (fallback when the export has transparent areas)
function onPaper(img) {
  const out = createImage(img.width, img.height, [255, 255, 255, 255]);
  blit(img, out, 0, 0);
  return out;
}

// Zones: [{ rect, zone, kind }]. Draws dotted frames and small zone numbers on a copy of img.
// No tint inside the frames: a tint would hide or fake a colour change.
export function markZones(img, zones, fallbackRgb = ORANGE) {
  const out = onPaper(img);
  const size = Math.max(img.width, img.height);
  const t = Math.max(1, Math.round(size / 600));
  const scale = Math.max(1, Math.round(size / 900));
  const colour = (z) => KIND_RGB[z.kind] || fallbackRgb;
  for (const z of zones) dottedRect(out, z.rect, colour(z), t);
  for (const z of zones) {
    if (z.noLabel) continue;
    const label = String(z.zone);
    const lw = textWidth(label, scale) + 2 * scale + 1, lh = 7 * scale + 2 * scale;
    let lx = z.rect.x - t, ly = z.rect.y - t - lh - 1;
    if (ly < 0) ly = z.rect.y + 1;
    if (lx < 0) lx = 0;
    if (lx + lw > out.width) lx = out.width - lw;
    fillRect(out, lx - 1, ly - 1, lw + 2, lh + 2, WHITE);
    fillRect(out, lx, ly, lw, lh, colour(z));
    drawText(out, label, lx + scale + 1, ly + scale, scale, WHITE);
  }
  return out;
}

// Gutter minimap (like the diff gutter of an editor): one bar per zone, as tall as the zone,
// at the same height as the zone on the page. Overlapping zones are put side by side in lanes,
// so a small change is not hidden behind a large one.
export function drawGutter(out, x, y, w, h, zones, maxLanes = 3) {
  fillRect(out, x, y, w, h, WHITE);
  const sorted = zones.slice().sort((a, b) => a.rect.y - b.rect.y || b.rect.h - a.rect.h);
  const laneEnd = [];
  const placed = sorted.map((z) => {
    let lane = laneEnd.findIndex((end) => end <= z.rect.y);
    if (lane < 0) lane = laneEnd.length < maxLanes ? laneEnd.length : maxLanes - 1;
    laneEnd[lane] = Math.max(laneEnd[lane] || 0, z.rect.y + z.rect.h + 2);
    return { z, lane };
  });
  const lanes = Math.max(1, laneEnd.length);
  const inset = 2;
  const laneW = Math.max(1, Math.floor((w - 2 * inset - (lanes - 1)) / lanes));
  for (const { z, lane } of placed) {
    const top = Math.max(0, z.rect.y), bottom = Math.min(h, z.rect.y + z.rect.h);
    const bh = Math.max(2, bottom - top);
    fillRect(out, x + inset + lane * (laneW + 1), y + Math.min(top, h - bh), laneW, bh, KIND_RGB[z.kind] || ORANGE);
  }
}

// "BEFORE | AFTER" side by side for one page. before/after may be null (page added/removed).
// Layout: [gutter][page BEFORE]   [page AFTER][gutter], on a transparent canvas; neutral
// headers with a small legend of the colours used on that side.
export function buildPageComposite({ before, after, beforeZones, afterZones, pageNumber, L, cropped = false, beforeName = pageNumber, afterName = pageNumber }) {
  const scale = 2;
  const pad = 6;
  const header = 7 * scale + 2 * pad;
  const gapW = 16;
  const w = Math.max(before?.width || 0, after?.width || 0, 240);
  const h = Math.max(before?.height || 0, after?.height || 0);
  const gw = Math.max(20, Math.round(w / 28));   // gutter width
  const gm = 3;                                  // margin between page and gutter
  const panelW = w + gm + gw;
  const out = createImage(panelW * 2 + gapW, h + header, [0, 0, 0, 0]);

  const panel = (img, zones, x, title, missing, legend, gutterLeft) => {
    const pageX = gutterLeft ? x + gw + gm : x;
    const gutterX = gutterLeft ? x : x + w + gm;
    fillRect(out, x, 0, panelW, header - 2, HEADER);
    let lxEnd = x + panelW - pad;
    const legendItems = legend.filter((k) => zones.some((z) => (z.kind === 'visual' ? 'modified' : z.kind) === k));
    for (const k of legendItems.slice().reverse()) {
      const word = L.legend[k];
      const tw = textWidth(word, 1);
      drawText(out, word, lxEnd - tw, (header - 7) / 2, 1, WHITE);
      fillRect(out, lxEnd - tw - 10, (header - 8) / 2, 7, 7, KIND_RGB[k]);
      lxEnd -= tw + 18;
    }
    const label = `${title} - ${L.page} ${gutterLeft ? beforeName : afterName}${cropped ? ` (${L.detail})` : ''}`;
    let ts = scale;
    while (ts > 1 && textWidth(label, ts) > lxEnd - x - 2 * pad) ts--;
    drawText(out, label, x + pad, (header - 7 * ts) / 2 - 1, ts, WHITE);
    if (img) {
      blit(markZones(img, zones), out, pageX, header);
      drawGutter(out, gutterX, header, gw, img.height, zones);
    } else {
      fillRect(out, pageX, header, w, h, [229, 231, 235]);
      const tw = textWidth(missing, scale);
      drawText(out, missing, pageX + (w - tw) / 2, header + h / 2, scale, GREY);
      drawGutter(out, gutterX, header, gw, h, []);
    }
  };
  panel(before, beforeZones, 0, L.before, L.noPage, ['modified', 'moved', 'removed'], true);
  panel(after, afterZones, panelW + gapW, L.after, L.removedPage, ['modified', 'moved', 'added'], false);
  out.layout = { beforeX: gw + gm, afterX: panelW + gapW, top: header };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lines and arrows

export function drawLine(img, x0, y0, x1, y1, rgb, t = 2, alpha = 1) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
    fillRect(img, Math.round(x - t / 2), Math.round(y - t / 2), t, t, rgb, alpha);
  }
}

function fillTriangle(img, pts, rgb) {
  const [a, b, c] = pts;
  const minX = Math.floor(Math.min(a[0], b[0], c[0])), maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1])), maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = [x + 0.5, y + 0.5];
    const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) fillRect(img, x, y, 1, 1, rgb);
  }
}

// Arrow from (x0,y0) to (x1,y1) with a filled head; halo = white outline for busy backgrounds
export function drawArrow(img, x0, y0, x1, y1, rgb, t = 2, halo = false) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = 5 * t + 4;
  const hx = x1 - Math.cos(ang) * head * 0.8, hy = y1 - Math.sin(ang) * head * 0.8;
  const wing = (s) => [x1 - Math.cos(ang + s * 0.45) * head, y1 - Math.sin(ang + s * 0.45) * head];
  if (halo) {
    drawLine(img, x0, y0, hx, hy, WHITE, t + 2);
    const grow = (p) => [p[0] + (p[0] - x1) * 0.25, p[1] + (p[1] - y1) * 0.25];
    fillTriangle(img, [[x1 + Math.cos(ang) * 2, y1 + Math.sin(ang) * 2], grow(wing(1)), grow(wing(-1))], WHITE);
  }
  drawLine(img, x0, y0, hx, hy, rgb, t);
  fillTriangle(img, [[x1, y1], wing(1), wing(-1)], rgb);
}

// Box-filter downscale (thumbnails)
export function scaleImage(img, w, h) {
  const out = createImage(w, h, [255, 255, 255, 255]);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4, a = img.data[o + 3] / 255;
        r += img.data[o] * a + 255 * (1 - a); g += img.data[o + 1] * a + 255 * (1 - a); b += img.data[o + 2] * a + 255 * (1 - a); n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page map: the page order BEFORE (left) and AFTER (right), aligned like a diff. Stable pages
// share a row; removed pages (red) sit only on the left, added pages (green) only on the
// right; a moved page (orange) appears at its old place on the left and its new place on the
// right, joined by an arrow. Long unchanged runs are folded into one "..." row.
// before / after: [{ id, name, thumb }] in document order (thumb may be null)
export function pageMapRows(before, after, st, context = 1) {
  const rows = [];
  let i = 0, j = 0;
  const rem = new Set(st.removed), mov = new Set(st.moved), add = new Set(st.added);
  while (i < before.length || j < after.length) {
    const a = before[i], b = after[j];
    if (a && (rem.has(a.id) || mov.has(a.id))) { rows.push({ left: a, right: null, kindL: rem.has(a.id) ? 'removed' : 'modified' }); i++; }
    else if (b && (add.has(b.id) || mov.has(b.id))) { rows.push({ left: null, right: b, kindR: add.has(b.id) ? 'added' : 'modified' }); j++; }
    else if (a && b) { rows.push({ left: a, right: b }); i++; j++; }
    else if (a) { rows.push({ left: a, right: null }); i++; }
    else { rows.push({ left: null, right: b }); j++; }
  }
  // fold stable runs far from any change
  const changed = rows.map((r) => !!(r.kindL || r.kindR));
  const keep = rows.map((_, k) => changed.slice(Math.max(0, k - context), k + context + 1).some(Boolean));
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
  const rows = pageMapRows(before, after, st);
  const TH = 64, rowH = TH + 10, foldH = 18, header = 26, pad = 6;
  const thumbs = [...before, ...after].map((p) => p.thumb).filter(Boolean);
  const TW = thumbs.length ? Math.max(...thumbs.map((t) => t.width)) : Math.round(TH * 0.71);
  const LW = 34, AW = 150;
  const colL = LW + pad, colR = colL + TW + AW;
  const width = colR + TW + pad + LW;
  const height = header + rows.reduce((n, r) => n + (r.fold ? foldH : rowH), 0) + pad;
  const out = createImage(width, height, [255, 255, 255, 255]);   // the page map sits on white
  fillRect(out, 0, 0, colL + TW + 8, header - 2, HEADER);
  fillRect(out, colR - 8, 0, width - colR + 8, header - 2, HEADER);
  drawText(out, L.before, pad, 6, 2, WHITE);
  drawText(out, L.after, colR, 6, 2, WHITE);
  const centres = { left: new Map(), right: new Map() };
  const thumbAt = (p, x, y, kind) => {
    const t = p.thumb;
    const w = t ? t.width : TW, h = t ? t.height : TH;
    const tx = x + Math.round((TW - w) / 2);
    if (t) blit(t, out, tx, y);
    else {
      fillRect(out, tx, y, w, h, [229, 231, 235]);
    }
    // light grey edge on every page (separates white pages from the white background),
    // plus a coloured frame outside it for added / removed / moved pages
    strokeRect(out, { x: tx, y, w, h }, [209, 213, 219], 1);
    if (kind) strokeRect(out, { x: tx - 1, y: y - 1, w: w + 2, h: h + 2 }, KIND_RGB[kind], 2);
    return { x: tx, y, w, h };
  };
  let y = header;
  for (const r of rows) {
    if (r.fold) {
      const label = `... ${r.fold} ${L.pagesWord}`;
      const tw = textWidth(label, 1);
      drawText(out, label, Math.round((width - tw) / 2), y + 5, 1, GREY);
      y += foldH;
      continue;
    }
    const ty = y + 4;
    if (r.left) {
      const box = thumbAt(r.left, colL, ty, r.kindL);
      const name = String(r.left.name);
      drawText(out, name, colL - 4 - textWidth(name, 1), ty + TH / 2 - 3, 1, r.kindL ? KIND_RGB[r.kindL] : GREY);
      centres.left.set(r.left.id, { x: box.x + box.w + 3, y: box.y + box.h / 2 });
    }
    if (r.right) {
      const box = thumbAt(r.right, colR, ty, r.kindR);
      drawText(out, String(r.right.name), colR + TW + 4, ty + TH / 2 - 3, 1, r.kindR ? KIND_RGB[r.kindR] : GREY);
      centres.right.set(r.right.id, { x: box.x - 3, y: box.y + box.h / 2 });
    }
    if (r.left && r.right) {
      const a = centres.left.get(r.left.id), b = centres.right.get(r.right.id);
      drawLine(out, a.x + 2, a.y, b.x - 2, b.y, [209, 213, 219], 1);
    }
    y += rowH;
  }
  for (const id of st.moved) {
    const a = centres.left.get(id), b = centres.right.get(id);
    if (a && b) drawArrow(out, a.x + 2, a.y, b.x - 2, b.y, ORANGE, 2);
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
    drawArrow(out, beforeX + l.from.x + l.from.w, top + l.from.y + l.from.h / 2, afterX + l.to.x - 4, top + l.to.y + l.to.h / 2, ORANGE, 2, true);
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
