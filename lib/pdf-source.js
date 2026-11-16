// PDF reader for client files: the text page by page, and the review annotations (sticky notes,
// highlights, strike-outs, insertions, drawings…) with the text each one points at.
// Uses pdf.js (pdfjs-dist, legacy build for Node).
//
// Spreads ("planches": a sheet twice as wide as tall) are read as a left and a right page.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SKIP = new Set(['Link', 'Widget', 'Popup']);

export async function openPdf(buf) {
  return getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false }).promise;
}

export function pdfDate(s) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s || '');
  if (!m) return '';
  return `${m[1]}-${m[2] || '01'}-${m[3] || '01'}${m[4] ? ` ${m[4]}:${m[5] || '00'}` : ''}`;
}

const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();

// Page text as one stream string with a box per character (null for inserted spaces / breaks)
export function pageStream(items, view) {
  const [vx0, vy0, vx1, vy1] = view;
  const width = vx1 - vx0, height = vy1 - vy0;
  const spread = width > height * 1.15;
  const mid = vx0 + width / 2;
  const halves = spread ? [{ side: 'left', s: '', boxes: [] }, { side: 'right', s: '', boxes: [] }] : [{ side: null, s: '', boxes: [] }];
  const state = halves.map(() => ({ lastY: null, lastX: null, lastH: 0 }));
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const t = it.transform;
    const h = it.height || Math.hypot(t[2], t[3]) || 1;
    const x = t[4], y = t[5];
    const k = spread ? (x + it.width / 2 < mid ? 0 : 1) : 0;
    const H = halves[k], st = state[k];
    if (it.str.length) {
      if (st.lastY !== null) {
        const newLine = Math.abs(y - st.lastY) > Math.max(st.lastH, h) * 0.5;
        if (newLine) { H.s += '\n'; H.boxes.push(null); }
        else if (x - st.lastX > h * 0.12 && !/\s$/.test(H.s) && !/^\s/.test(it.str)) { H.s += ' '; H.boxes.push(null); }
      }
      const cw = it.width / it.str.length;
      for (let i = 0; i < it.str.length; i++) {
        H.s += it.str[i];
        H.boxes.push({ x0: x + i * cw, x1: x + (i + 1) * cw, y0: y - h * 0.2, y1: y + h * 0.8 });
      }
      st.lastY = y; st.lastX = x + it.width; st.lastH = h;
    }
    if (it.hasEOL && st.lastY !== null) st.lastY = -1e9;   // force a break before the next item
  }
  return { spread, mid, height, vy0, halves };
}

// Folio guess: a lone number near the top or bottom edge of each half
export function folioOf(items, view, side, mid) {
  const h = view[3] - view[1];
  const cands = items.filter((it) => /^\s*([0-9]{1,4}|[ivxlcdm]{1,6})\s*$/i.test(it.str || '') && (it.transform[5] - view[1] < h * 0.08 || view[3] - it.transform[5] < h * 0.08));
  const inHalf = cands.filter((it) => !side || (side === 'left' ? it.transform[4] < mid : it.transform[4] >= mid));
  return inHalf.length ? inHalf[0].str.trim() : null;
}

// Words of the stream covered by the selected char indexes (a word counts when half of it is hit)
function snapWords(s, hit) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s))) {
    let n = 0;
    for (let i = m.index; i < m.index + m[0].length; i++) if (hit.has(i)) n++;
    if (n) words.push({ a: m.index, b: m.index + m[0].length, f: n / m[0].length });
  }
  const strong = words.filter((w) => w.f >= 0.5);
  const use = strong.length ? strong : words;
  if (!use.length) return null;
  return { a: use[0].a, b: use[use.length - 1].b };
}

const oneLine = (t) => t.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ');

function context(s, a, b, n = 60, mark = ['«', '»']) {
  const pre = oneLine(s.slice(Math.max(0, a - n), a)), post = oneLine(s.slice(b, b + n));
  const lead = a - n > 0 ? '…' + pre.replace(/^\S*\s/, '') : pre;
  const tail = b + n < s.length ? post.replace(/\s\S*$/, '') + '…' : post;
  return `${lead}${mark[0]}${oneLine(s.slice(a, b))}${mark[1]}${tail}`.trim();
}

const quadsOf = (q) => {
  const out = [];
  if (!q) return out;
  const f = Array.from(q);
  for (let i = 0; i + 7 < f.length; i += 8) {
    const xs = [f[i], f[i + 2], f[i + 4], f[i + 6]], ys = [f[i + 1], f[i + 3], f[i + 5], f[i + 7]];
    out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return out;
};

const halfOf = (ps, x) => (ps.spread ? (x < ps.mid ? 0 : 1) : 0);

// Text under rectangles (highlight quads, or a drawn frame)
function textUnder(ps, rects, { snap = true } = {}) {
  const cx = (rects[0].x0 + rects[0].x1) / 2;
  const H = ps.halves[halfOf(ps, cx)];
  const hit = new Set();
  H.boxes.forEach((b, i) => {
    if (!b) return;
    const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
    if (rects.some((r) => mx >= r.x0 - 0.5 && mx <= r.x1 + 0.5 && my >= r.y0 - 1 && my <= r.y1 + 1)) hit.add(i);
  });
  if (!hit.size) return null;
  const span = snap ? snapWords(H.s, hit) : { a: Math.min(...hit), b: Math.max(...hit) + 1 };
  if (!span) return null;
  return { text: oneLine(H.s.slice(span.a, span.b)), context: context(H.s, span.a, span.b), pre: H.s.slice(Math.max(0, span.a - 80), span.a), post: H.s.slice(span.b, span.b + 80) };
}

// Insertion point of a caret: the caret's tip (top edge of its box) sits on the baseline of the
// line; char positions are estimated, so the point snaps to a word boundary unless the inserted
// text is a single character (a missing letter)
function insertionPoint(ps, rect, insert = '') {
  const cx = (rect[0] + rect[2]) / 2, tip = rect[3];
  const H = ps.halves[halfOf(ps, cx)];
  let best = null;
  H.boxes.forEach((b, i) => {
    if (!b) return;
    const base = b.y0 + (b.y1 - b.y0) * 0.2;
    const dy = Math.abs(base - tip);
    for (const [edge, idx] of [[b.x0, i], [b.x1, i + 1]]) {
      const d = Math.hypot(edge - cx, dy * 4);
      if (!best || d < best.d) best = { d, idx };
    }
  });
  if (!best || best.d > 60) return null;
  let idx = best.idx;
  const w = /[\p{L}\p{N}’'-]/u;
  if (insert.trim().length > 1 && w.test(H.s[idx - 1] || '') && w.test(H.s[idx] || '')) {
    let l = idx, r = idx;
    while (l > 0 && w.test(H.s[l - 1])) l--;
    while (r < H.s.length && w.test(H.s[r])) r++;
    idx = idx - l <= r - idx ? l : r;
  }
  return { context: context(H.s, idx, idx, 50, ['‸', '']), pre: H.s.slice(Math.max(0, idx - 80), idx), post: H.s.slice(idx, idx + 80) };
}

// Line of text nearest a point (sticky notes, free text, stamps)
function nearestLine(ps, rect) {
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  const H = ps.halves[halfOf(ps, cx)];
  let best = null;
  H.boxes.forEach((b, i) => {
    if (!b) return;
    const dx = cx < b.x0 ? b.x0 - cx : cx > b.x1 ? cx - b.x1 : 0;
    const dy = cy < b.y0 ? b.y0 - cy : cy > b.y1 ? cy - b.y1 : 0;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { d, i };
  });
  if (!best) return null;
  const a = H.s.lastIndexOf('\n', best.i) + 1;
  let b = H.s.indexOf('\n', best.i);
  if (b < 0) b = H.s.length;
  let line = H.s.slice(a, b).trim();
  if (line.length > 140) line = line.slice(0, 140).replace(/\s\S*$/, '') + '…';
  return { near: line, distance: Math.round(best.d) };
}

export const KIND = {
  StrikeOut: 'delete', Caret: 'insert', Highlight: 'highlight', Underline: 'highlight', Squiggly: 'highlight',
  Text: 'note', FreeText: 'note', Ink: 'drawing', Square: 'shape', Circle: 'shape', Polygon: 'shape', PolyLine: 'shape', Line: 'shape',
  Stamp: 'stamp', FileAttachment: 'attachment', Sound: 'attachment', Redact: 'delete',
};

// All review annotations of the document, threaded, with what they point at
export async function readAnnotations(doc, { pages } = {}) {
  const labels = await doc.getPageLabels().catch(() => null);
  const list = pages?.length ? pages : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const all = [];
  for (const n of list) {
    if (n < 1 || n > doc.numPages) continue;
    const page = await doc.getPage(n);
    const anns = (await page.getAnnotations()).filter((a) => !SKIP.has(a.subtype));
    if (!anns.length) continue;
    const tc = await page.getTextContent();
    const ps = pageStream(tc.items, page.view);
    for (const a of anns) {
      const rect = a.rect;
      const cx = (rect[0] + rect[2]) / 2;
      const side = ps.spread ? (cx < ps.mid ? 'left' : 'right') : null;
      const item = {
        id: a.id, pdfPage: n, label: labels?.[n - 1] || null, side, folio: folioOf(tc.items, page.view, side, ps.mid),
        type: a.subtype, kind: KIND[a.subtype] || 'other', author: clean(a.titleObj?.str), date: pdfDate(a.modificationDate || a.creationDate),
        comment: clean(a.contentsObj?.str || a.richText?.str), inReplyTo: a.inReplyTo || null, replyType: a.replyType || null,
        state: a.state || null, stateModel: a.stateModel || null, y: rect[3],
      };
      if (['StrikeOut', 'Highlight', 'Underline', 'Squiggly', 'Redact'].includes(a.subtype)) {
        const quads = quadsOf(a.quadPoints);
        const t = textUnder(ps, quads.length ? quads : [{ x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] }]);
        const target = t ? t.text.replace(/^[\s•·▪–-]+|[\s•·▪]+$/g, '') : '';
        if (t) { item.pre = t.pre; item.post = t.post; }
        if (target.length > 1) { item.target = target; item.context = t.context; }
        else if (t) item.context = t.context;
        else { const l = nearestLine(ps, rect); if (l) item.near = l.near; }
      } else if (a.subtype === 'Caret') {
        const p = insertionPoint(ps, rect, item.comment);
        if (p) { item.context = p.context; item.pre = p.pre; item.post = p.post; }
      } else if (['Square', 'Circle', 'Polygon', 'Ink'].includes(a.subtype)) {
        const t = textUnder(ps, [{ x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] }], { snap: false });
        if (t) item.target = t.text.length > 160 ? t.text.slice(0, 160).replace(/\s\S*$/, '') + '…' : t.text;
        const l = nearestLine(ps, rect);
        if (!t && l) item.near = l.near;
      } else {
        const l = nearestLine(ps, rect);
        if (l) item.near = l.near;
      }
      if (a.subtype === 'Stamp' && !item.comment) item.comment = clean(a.name);
      if (a.subtype === 'FileAttachment') item.comment = [item.comment, a.file?.filename && `fichier joint : ${a.file.filename}`].filter(Boolean).join(' – ');
      all.push(item);
    }
  }
  return threadAnnotations(all);
}

// Replies under their parent, review states as a status, "replace" = strike-out + caret group
export function threadAnnotations(all) {
  const byId = new Map(all.map((a) => [a.id, a]));
  const top = [];
  for (const a of all) {
    const parent = a.inReplyTo && byId.get(a.inReplyTo);
    if (!parent) { top.push(a); continue; }
    if (a.stateModel) {
      if (a.stateModel === 'Review' && a.state && a.state !== 'None') parent.status = { state: a.state, by: a.author, date: a.date };
      if (a.stateModel === 'Marked' && a.state === 'Marked') parent.checked = true;
      continue;
    }
    if (a.replyType === 'Group') {
      // Acrobat "replace text": a strike-out grouped with a caret holding the new text
      const strike = [a, parent].find((x) => x.type === 'StrikeOut'), caret = [a, parent].find((x) => x.type === 'Caret');
      if (strike && caret) {
        parent.kind = 'replace';
        parent.target = strike.target; parent.context = strike.context;
        parent.insert = caret.comment;
        parent.comment = strike.comment && strike.comment !== caret.comment ? strike.comment : '';
        continue;
      }
      parent.comment = [parent.comment, a.comment].filter(Boolean).join('\n');
      continue;
    }
    (parent.replies ||= []).push({ author: a.author, date: a.date, comment: a.comment });
  }
  for (const a of top) {
    if (a.kind === 'insert' && !a.insert) { a.insert = a.comment; a.comment = ''; }
    (a.replies || []).sort((x, y) => x.date.localeCompare(y.date));
  }
  top.sort((x, y) => x.pdfPage - y.pdfPage || (x.side === y.side ? 0 : x.side === 'left' ? -1 : 1) || y.y - x.y);
  top.forEach((a, k) => { a.n = k + 1; });
  return top;
}

// Text of the document page by page (each half of a spread on its own)
export async function readPdfText(doc, { pages } = {}) {
  const labels = await doc.getPageLabels().catch(() => null);
  const list = pages?.length ? pages : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const out = [];
  for (const n of list) {
    if (n < 1 || n > doc.numPages) continue;
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const ps = pageStream(tc.items, page.view);
    for (const H of ps.halves) out.push({ pdfPage: n, label: labels?.[n - 1] || null, side: H.side, folio: folioOf(tc.items, page.view, H.side, ps.mid), text: H.s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() });
  }
  return { numPages: doc.numPages, pages: out };
}
