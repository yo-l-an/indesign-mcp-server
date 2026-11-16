// Client feedback: PDF annotations and Word comments / tracked changes as one list of items, one
// table, one way to find them in the InDesign document.
//
//   const fb = await readFeedback(source, { pages, author });   // source: { kind: 'pdf', pdf } | { kind: 'docx', docx }
//   fb -> { kind, placeHeader, items: [{ key, place, type, target, feedback, author, authors, needles, visual, side }] }
//   feedbackTable(fb, locations)              Markdown table, one row per item
//   await locateFeedback(fb.items, search)    Map key -> "p.12 #4512" | "déjà fait ? p.12 #4512" | "introuvable"
//
// search(list) is the adapter to the document: list = [{ key, grep, cs }] (GREP, cs = case
// sensitive), returns Map key -> "p.12 #4512, p.13 #4600". read_feedback backs it with InDesign;
// tests with a map.

import { readAnnotations } from './pdf-source.js';

const SIDE_FR = { left: 'gauche', right: 'droite' };
const TYPE_FR = {
  replace: 'Remplacer', delete: 'Supprimer', insert: 'Insérer', highlight: 'Surligné', note: 'Note', drawing: 'Dessin',
  shape: 'Forme', stamp: 'Tampon', attachment: 'Pièce jointe', other: 'Autre', comment: 'Commentaire', change: 'Suivi',
};
const STATE_FR = { Accepted: 'accepté', Rejected: 'refusé', Cancelled: 'annulé', Completed: 'terminé' };
const VISUAL = new Set(['drawing', 'shape', 'stamp', 'attachment']);

const cell = (s) => String(s ?? '').replace(/\r?\n+/g, ' / ').replace(/\|/g, '\\|').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s);

// ---- PDF annotations ------------------------------------------------------------------------------

// Where an annotation sits: the printed page number when found, else the PDF page (+ half)
export function pdfPlace(a) {
  if (a.label) return a.label;
  if (a.folio) return a.folio;
  return `PDF ${a.pdfPage}${a.side ? ` ${SIDE_FR[a.side]}` : ''}`;
}

// What the annotation points at, as short as it stays unambiguous
export function pdfTarget(a) {
  if (a.kind === 'insert') return a.context ? `«${cut(a.context, 110)}»` : a.near ? `près de «${cut(a.near, 80)}»` : '';
  if (a.target) {
    const t = `«${cut(a.target, 120)}»`;
    return a.target.length < 25 && a.context ? `${t} dans «${cut(a.context, 110)}»` : t;
  }
  if (a.context) return `«${cut(a.context, 110)}»`;
  if (a.near) return `près de «${cut(a.near, 80)}»`;
  return '';
}

function pdfFeedback(a) {
  const parts = [];
  if (a.kind === 'replace') parts.push(`→ «${a.insert}»`);
  if (a.kind === 'insert') parts.push(`insérer «${a.insert}»`);
  if (a.kind === 'delete' && !a.comment) parts.push('supprimer');
  if (a.comment) parts.push(a.comment);
  for (const r of a.replies || []) parts.push(`↳ ${r.author} : ${r.comment}`);
  if (a.status) parts.push(`[${STATE_FR[a.status.state] || a.status.state} par ${a.status.by}]`);
  if (a.checked) parts.push('[coché]');
  return parts.join(' / ');
}

// GREP needle for InDesign from plain text: escaped, any run of spaces matches any white space
export function grepNeedle(text, max = 70) {
  // bullets are automatic in InDesign (not text) and mark paragraph ends: keep the longest piece
  const pieces = String(text || '').replace(/[‸«»]/g, ' ').split(/[•▪◦■●]/).map((t) => t.replace(/\s+/g, ' ').trim());
  let t = pieces.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (t.length > max) t = t.slice(0, max).replace(/\s\S*$/, '');
  if (t.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return null;
  return t.replace(/[\\^$.|?*+()[\]{}~]/g, (c) => `\\${c}`).replace(/ /g, '\\s+');
}

// Text to look for in InDesign for one annotation: the text as the reviewer saw it (before) and,
// for text corrections, the text once corrected (after: found = probably already done)
export function pdfNeedles(a) {
  // words next to the mark, on its own line (a line break may be a new paragraph or frame)
  const side = (raw, n, before) => {
    const line = before ? (raw || '').split('\n').pop() : (raw || '').split('\n')[0];
    const w = line.trim().split(/\s+/).filter(Boolean);
    return (before ? w.slice(-n) : w.slice(0, n)).join(' ');
  };
  const b = a.pre !== undefined ? side(a.pre, 3, true) : '', f = a.post !== undefined ? side(a.post, 3, false) : '';
  if (a.kind === 'insert' && (a.pre !== undefined || a.context)) {
    let bb = b, ff = f;
    if (a.pre === undefined) { const [pre, post] = a.context.split('‸'); bb = (pre || '').replace(/…/g, '').trim().split(/\s+/).slice(-3).join(' '); ff = (post || '').replace(/…/g, '').trim().split(/\s+/).slice(0, 3).join(' '); }
    return { before: grepNeedle(`${bb} ${ff}`), after: a.insert ? grepNeedle(`${bb} ${a.insert} ${ff}`) : null };
  }
  if ((a.kind === 'delete' || a.kind === 'replace') && a.target) {
    const long = a.target.replace(/[^\p{L}\p{N}]/gu, '').length >= 6;
    const before = long ? grepNeedle(a.target) : grepNeedle(`${b} ${a.target} ${f}`);
    const after = (b || f) ? grepNeedle(`${b} ${a.kind === 'replace' ? a.insert || '' : ''} ${f}`) : null;
    return { before, after };
  }
  if (a.target && a.target.replace(/[^\p{L}\p{N}]/gu, '').length >= 6) return { before: grepNeedle(a.target) };
  if (a.target && (b || f)) return { before: grepNeedle(`${b} ${a.target} ${f}`) };
  if (a.context) return { before: grepNeedle(a.context.replace(/…/g, '').replace(/«|»/g, '')) };
  if (a.near) return { before: grepNeedle(a.near) };
  return { before: null };
}

const pdfItem = (a) => ({
  key: String(a.n),
  place: pdfPlace(a),
  type: TYPE_FR[a.kind] || a.type,
  target: pdfTarget(a),
  feedback: pdfFeedback(a),
  author: a.author,
  authors: [a.author, ...(a.replies || []).map((r) => r.author)],
  needles: pdfNeedles(a),
  visual: VISUAL.has(a.kind),
  side: a.side || null,
});

// ---- Word comments and tracked changes ---------------------------------------------------------------

function docxItems(docx) {
  const comments = docx.comments.filter((c) => !c.parent).map((c) => {
    const replies = docx.comments.filter((r) => r.parent === c.id);
    return {
      key: `C${c.n}`,
      place: c.section || '—',
      type: TYPE_FR.comment,
      target: c.anchor ? `«${cut(c.anchor, 120)}»` : '—',
      feedback: [c.text, ...replies.map((r) => `↳ ${r.author} : ${r.text}`), c.done ? '[résolu]' : ''].filter(Boolean).join(' / '),
      author: c.author,
      authors: [c.author],
      needles: { before: grepNeedle(c.anchor) },
      visual: false,
    };
  });
  const changes = docx.changes.map((c, k) => ({
    key: `M${k + 1}`,
    place: c.section || '—',
    type: TYPE_FR.change,
    target: c.before || '(vide)',
    feedback: `→ ${c.after || '(vide)'}`,
    author: c.authors.join(', '),
    authors: c.authors,
    needles: { before: grepNeedle(c.probe.before), after: grepNeedle(c.probe.after) },
    visual: false,
  }));
  return [...comments, ...changes];
}

// ---- one interface --------------------------------------------------------------------------------

export async function readFeedback(source, { pages, author } = {}) {
  let items;
  if (source.kind === 'pdf') items = (await readAnnotations(source.pdf, { pages })).map(pdfItem);
  else if (source.kind === 'docx') items = docxItems(source.docx);
  else throw new Error('Feedback is read from a PDF or a Word file');
  const who = author ? String(author).toLowerCase() : null;
  if (who) items = items.filter((it) => it.authors.some((a) => String(a || '').toLowerCase().includes(who)));
  return { kind: source.kind, placeHeader: source.kind === 'pdf' ? 'Page' : 'Section', items };
}

export function feedbackTable({ items, placeHeader }, locations = null) {
  const cols = ['#', placeHeader, 'Type', 'Texte visé', 'Retour', 'Auteur', ...(locations ? ['Dans InDesign'] : [])];
  const head = `| ${cols.join(' | ')} |\n|---:|${cols.slice(1).map(() => '---').join('|')}|`;
  const rows = items.map((it) => {
    const row = [it.key, it.place, it.type, it.target, it.feedback, it.author];
    if (locations) row.push(locations.get(it.key) || '—');
    return `| ${row.map(cell).join(' | ')} |`;
  });
  return `${head}\n${rows.join('\n')}`;
}

// Two passes: the text as the reviewer saw it, then (for corrections not found) the corrected text
export async function locateFeedback(items, search) {
  // a correction that only changes letter case needs a case-sensitive search
  const cs = (n) => !!(n.before && n.after && n.before.toLowerCase() === n.after.toLowerCase());
  const first = items.filter((it) => it.needles.before).map((it) => ({ key: it.key, grep: it.needles.before, cs: cs(it.needles) }));
  const found = first.length ? await search(first) : new Map();
  const retry = items.filter((it) => it.needles.after && !found.has(it.key)).map((it) => ({ key: it.key, grep: it.needles.after, cs: cs(it.needles) }));
  const done = retry.length ? await search(retry) : new Map();
  const map = new Map();
  for (const it of items) {
    if (found.has(it.key)) map.set(it.key, found.get(it.key));
    else if (done.has(it.key)) map.set(it.key, `déjà fait ? ${done.get(it.key)}`);
    else if (it.needles.before || it.needles.after) map.set(it.key, 'introuvable');
  }
  return map;
}

// Page names that appear in the locations, in page order
export function pagesFrom(locations) {
  const pages = new Set();
  for (const v of locations.values()) for (const m of String(v).matchAll(/p\.([^\s,#]+)/g)) pages.add(m[1]);
  return [...pages].sort((a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b)));
}
