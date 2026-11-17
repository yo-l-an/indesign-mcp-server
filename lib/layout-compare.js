// Comparing two alternate layouts (or any two pages): which object of page A is which object of
// page B, and what differs. Pages of two layouts have different sizes, so places are compared
// relative to the page (percent of width / height) and reported in mm on each side.
//
// Items are inventory items (tools/review-tools.js inventoryScript): { id, type, bounds, text,
// link, name, fill, stroke, paragraphStyles, pointSize, fonts, ... }.

import { describeItem, textDiffCells } from './review-diff.js';

const norm = (s) => String(s || '').replace(/[\u0000-\u001F￼]/g, ' ').replace(/\s+/g, ' ').trim();
const rel = (it, page) => {
  const [t, l, b, r] = it.bounds || [0, 0, 0, 0];
  return { x: l / page.widthMm, y: t / page.heightMm, w: (r - l) / page.widthMm, h: (b - t) / page.heightMm };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);

// Pairs, strongest evidence first: same name, same image, same text, same text start, then the same
// kind of object nearest in relative place (and close enough)
export function matchItems(pageA, pageB) {
  const A = [...pageA.items], B = [...pageB.items];
  const usedA = new Set(), usedB = new Set(), pairs = [];
  const pass = (key, ok = () => true) => {
    for (const a of A) {
      if (usedA.has(a.id)) continue;
      const ka = key(a);
      if (!ka) continue;
      const cands = B.filter((b) => !usedB.has(b.id) && b.type === a.type && key(b) === ka && ok(a, b));
      if (!cands.length) continue;
      const best = cands.sort((x, y) => dist(rel(a, pageA), rel(x, pageB)) - dist(rel(a, pageA), rel(y, pageB)))[0];
      usedA.add(a.id); usedB.add(best.id); pairs.push([a, best]);
    }
  };
  pass((it) => it.name || null);
  pass((it) => (it.link && it.link !== '(embedded)' ? it.link : null));
  pass((it) => (norm(it.text).length > 2 ? norm(it.text) : null));
  pass((it) => (norm(it.text).length > 12 ? norm(it.text).slice(0, 40) : null));
  pass((it) => `${it.type}|${it.fill || ''}|${it.stroke || ''}`, (a, b) => dist(rel(a, pageA), rel(b, pageB)) < 0.35);
  // rewritten text: the frame sharing most words (at least 40 %)
  const words = (it) => new Set(norm(it.text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
  for (const a of A) {
    if (usedA.has(a.id) || a.type !== 'TextFrame') continue;
    const wa = words(a);
    if (!wa.size) continue;
    let best = null, score = 0.4;
    for (const b of B) {
      if (usedB.has(b.id) || b.type !== 'TextFrame') continue;
      const wb = words(b);
      const shared = [...wa].filter((w) => wb.has(w)).length / Math.max(wa.size, wb.size);
      if (shared >= score) { best = b; score = shared; }
    }
    if (best) { usedA.add(a.id); usedB.add(best.id); pairs.push([a, best]); }
  }
  // the last shape or image of its kind on each side is the same object, wherever it went
  // (text frames are matched by their words above)
  for (const type of new Set(A.map((a) => a.type).filter((t) => t !== 'TextFrame'))) {
    const la = A.filter((a) => !usedA.has(a.id) && a.type === type), lb = B.filter((b) => !usedB.has(b.id) && b.type === type);
    if (la.length === 1 && lb.length === 1) { usedA.add(la[0].id); usedB.add(lb[0].id); pairs.push([la[0], lb[0]]); }
  }
  return { pairs, onlyA: A.filter((a) => !usedA.has(a.id)), onlyB: B.filter((b) => !usedB.has(b.id)) };
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();
const place = (it, page) => {
  const [t, l, b, r] = it.bounds || [0, 0, 0, 0];
  const p = rel(it, page);
  return `x ${fmt(l)} · y ${fmt(t)} · ${fmt(r - l)} × ${fmt(b - t)} mm (${Math.round(p.x * 100)} %, ${Math.round(p.y * 100)} % · ${Math.round(p.w * 100)} × ${Math.round(p.h * 100)} %)`;
};

// Rows: { zone, kind: 'modified' | 'removed' (only in A) | 'added' (only in B), a, b, prop, va, vb }
export function compareLayoutPages(pageA, pageB, L, { tolerance = 0.03 } = {}) {
  const { pairs, onlyA, onlyB } = matchItems(pageA, pageB);
  const rows = [];
  let zone = 0;
  for (const [a, b] of pairs) {
    const ra = rel(a, pageA), rb = rel(b, pageB);
    const props = [];
    if (Math.abs(ra.x - rb.x) > tolerance || Math.abs(ra.y - rb.y) > tolerance || Math.abs(ra.w - rb.w) > tolerance || Math.abs(ra.h - rb.h) > tolerance) {
      props.push(['bounds', place(a, pageA), place(b, pageB)]);
    }
    if (norm(a.text) !== norm(b.text)) {
      const { before, after } = textDiffCells(norm(a.text), norm(b.text));
      props.push(['text', before, after]);
    }
    for (const p of ['pointSize', 'fonts', 'paragraphStyles', 'fill', 'stroke', 'link', 'rotation', 'opacity', 'visible', 'layer']) {
      if (JSON.stringify(a[p] ?? null) !== JSON.stringify(b[p] ?? null)) props.push([p, a[p], b[p]]);
    }
    if (a.overflows !== b.overflows && (a.overflows || b.overflows)) props.push(['overflows', a.overflows, b.overflows]);
    if (!props.length) continue;
    zone++;
    for (const [prop, va, vb] of props) rows.push({ zone, kind: 'modified', a, b, prop, va, vb });
  }
  for (const a of onlyA) rows.push({ zone: ++zone, kind: 'removed', a, b: null, prop: 'object', va: describeItem(a, L), vb: L.none });
  for (const b of onlyB) rows.push({ zone: ++zone, kind: 'added', a: null, b, prop: 'object', va: L.none, vb: describeItem(b, L) });
  return { rows, pairs: pairs.length, same: pairs.length - new Set(rows.filter((r) => r.kind === 'modified').map((r) => r.zone)).size };
}

const cell = (v, L) => {
  if (v === null || v === undefined) return L.none;
  if (typeof v === 'boolean') return v ? L.yes : L.no;
  if (Array.isArray(v)) return v.length ? v.join(', ') : L.none;
  return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
};

// Markdown table: # | Page A | Page B | Element | Property | A | B
export function layoutTable(sections, nameA, nameB, L) {
  const head = `| # | ${nameA} | ${nameB} | ${L.cols[2]} | ${L.cols[3]} | ${nameA} | ${nameB} |\n|---:|---|---|---|---|---|---|`;
  const lines = [];
  for (const s of sections) {
    for (const r of s.rows) {
      const el = describeItem(r.b || r.a, L);
      lines.push(`| ${s.prefix}${r.zone} | ${s.pageA?.name ?? '—'} | ${s.pageB?.name ?? '—'} | ${el} | ${L.props[r.prop] || r.prop} | ${cell(r.va, L)} | ${cell(r.vb, L)} |`);
    }
  }
  return lines.length ? `${head}\n${lines.join('\n')}` : '';
}
