// Client files: read the brief (Word, PDF, text) and the feedback (commented PDF, Word comments
// and tracked changes) before touching the InDesign document.
//
//   read_source_document  the text as Markdown, by slices or as an outline (token-efficient)
//   read_feedback         every comment / mark / tracked change as one numbered row, with the
//                         text it points at; locate: true finds each one in the active document

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { jsJson } from '../lib/script-runtime.js';
import { readDocx } from '../lib/docx.js';
import { openPdf, readAnnotations, readPdfText } from '../lib/pdf-source.js';

const CONVERTIBLE = new Set(['.doc', '.rtf', '.odt', '.wordml', '.webarchive', '.html', '.htm']);
const TEXT = new Set(['.txt', '.md', '.markdown', '.csv']);

export function resolveSourcePath(p) {
  if (!p || typeof p !== 'string') throw new Error('path is required (absolute path of the .docx / .pdf file)');
  let file = p.trim().replace(/^file:\/\//, '');
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  file = path.resolve(file);
  if (!fs.existsSync(file)) {
    const alt = [file.normalize('NFC'), file.normalize('NFD')].find((f) => fs.existsSync(f));
    if (!alt) throw new Error(`File not found: ${file}`);
    file = alt;
  }
  return file;
}

// .doc / .rtf / .odt → .docx with macOS textutil (comments and tracked changes may be lost)
function convertToDocx(file) {
  if (process.platform !== 'darwin') throw new Error(`${path.extname(file)} files: save them as .docx (or PDF) first`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indesign-mcp-source-'));
  const out = path.join(dir, `${path.basename(file, path.extname(file))}.docx`);
  execFileSync('/usr/bin/textutil', ['-convert', 'docx', '-output', out, file], { timeout: 60000 });
  return out;
}

async function loadSource(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx' || ext === '.docm' || ext === '.dotx') return { kind: 'docx', docx: readDocx(fs.readFileSync(file)) };
  if (CONVERTIBLE.has(ext)) return { kind: 'docx', docx: readDocx(fs.readFileSync(convertToDocx(file))), converted: true };
  if (ext === '.pdf') return { kind: 'pdf', pdf: await openPdf(fs.readFileSync(file)) };
  if (TEXT.has(ext)) return { kind: 'text', text: fs.readFileSync(file, 'utf8') };
  throw new Error(`Unsupported file type ${ext}: .docx, .pdf, .doc/.rtf/.odt (macOS), .txt/.md`);
}

const sideFr = { left: 'gauche', right: 'droite' };

// Where an annotation sits: the printed page number when found, else the PDF page (+ half)
export function pdfPlace(a) {
  if (a.label) return a.label;
  if (a.folio) return a.folio;
  return `PDF ${a.pdfPage}${a.side ? ` ${sideFr[a.side]}` : ''}`;
}

const cell = (s) => String(s ?? '').replace(/\r?\n+/g, ' / ').replace(/\|/g, '\\|').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s);

const TYPE_FR = {
  replace: 'Remplacer', delete: 'Supprimer', insert: 'Insérer', highlight: 'Surligné', note: 'Note', drawing: 'Dessin',
  shape: 'Forme', stamp: 'Tampon', attachment: 'Pièce jointe', other: 'Autre',
};
const STATE_FR = { Accepted: 'accepté', Rejected: 'refusé', Cancelled: 'annulé', Completed: 'terminé' };

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

export function pdfFeedback(a) {
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

export function pdfFeedbackTable(items, locations) {
  const head = locations
    ? '| # | Page | Type | Texte visé | Retour | Auteur | Dans InDesign |\n|---:|---|---|---|---|---|---|'
    : '| # | Page | Type | Texte visé | Retour | Auteur |\n|---:|---|---|---|---|---|';
  const rows = items.map((a) => {
    const base = [a.n, pdfPlace(a), TYPE_FR[a.kind] || a.type, pdfTarget(a), pdfFeedback(a), a.author];
    if (locations) base.push(locations.get(a.n) || '—');
    return `| ${base.map(cell).join(' | ')} |`;
  });
  return `${head}\n${rows.join('\n')}`;
}

export function docxFeedbackTables(docx, locations) {
  const out = [];
  const top = docx.comments.filter((c) => !c.parent);
  if (top.length) {
    out.push(`**Commentaires (${top.length})**\n`);
    out.push(`| # | Section | Texte visé | Commentaire | Auteur |${locations ? ' Dans InDesign |' : ''}\n|---:|---|---|---|---|${locations ? '---|' : ''}`);
    for (const c of top) {
      const replies = docx.comments.filter((r) => r.parent === c.id).map((r) => `↳ ${r.author} : ${r.text}`);
      const fb = [c.text, ...replies, c.done ? '[résolu]' : ''].filter(Boolean).join(' / ');
      const row = [`C${c.n}`, c.section || '—', c.anchor ? `«${cut(c.anchor, 120)}»` : '—', fb, c.author];
      if (locations) row.push(locations.get(`C${c.n}`) || '—');
      out.push(`| ${row.map(cell).join(' | ')} |`);
    }
  }
  if (docx.changes.length) {
    out.push(`\n**Modifications suivies (${docx.changes.length})** – ~~supprimé~~, **ajouté**\n`);
    out.push(`| # | Section | Avant | Après | Auteur |${locations ? ' Dans InDesign |' : ''}\n|---:|---|---|---|---|${locations ? '---|' : ''}`);
    docx.changes.forEach((c, k) => {
      const row = [`M${k + 1}`, c.section || '—', c.before || '(vide)', c.after || '(vide)', c.authors.join(', ')];
      if (locations) row.push(locations.get(`M${k + 1}`) || '—');
      out.push(`| ${row.map(cell).join(' | ')} |`);
    });
  }
  return out.join('\n');
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

const LOCATE_SCRIPT = (needles) => `
  var doc = __requireDoc();
  var list = ${jsJson(needles)};
  var out = [];
  app.findGrepPreferences = NothingEnum.nothing;
  try {
    for (var i = 0; i < list.length; i++) {
      var hits = [];
      try {
        app.findGrepPreferences.findWhat = (list[i].cs ? "" : "(?i)") + list[i].grep;
        var found = doc.findGrep();
        for (var k = 0; k < found.length && hits.length < 4; k++) {
          var where = "overset";
          try {
            var tf = found[k].parentTextFrames;
            if (tf.length) where = (tf[0].parentPage ? "p." + tf[0].parentPage.name : "table de montage") + " #" + tf[0].id;
          } catch (e) {}
          hits.push(where);
        }
        if (found.length > 4) hits.push("+" + (found.length - 4));
      } catch (e) {}
      if (hits.length) out.push(list[i].key + "\\t" + hits.join(", "));
    }
  } finally { app.findGrepPreferences = NothingEnum.nothing; }
  "LOCATE\\n" + out.join("\\n");
`;

export function createSourceTools(server) {
  const run = (script) => server.executeInDesignScript(script);

  // needles: [{ key, grep, after? }] -> Map key -> "p.12 #4512" | "déjà fait ? p.12 #4512" | "introuvable"
  const locate = async (needles) => {
    const map = new Map();
    const search = async (list) => {
      const found = new Map();
      if (!list.length) return found;
      const res = String(await run(LOCATE_SCRIPT(list))).replace(/^[\s\S]*?LOCATE\n?/, '');
      for (const line of res.split('\n')) {
        const [key, hits] = line.split('\t');
        if (key && hits) found.set(key, hits);
      }
      return found;
    };
    // a correction that only changes letter case needs a case-sensitive search
    const cs = (n) => !!(n.grep && n.after && n.grep.toLowerCase() === n.after.toLowerCase());
    const first = await search(needles.filter((n) => n.grep).map((n) => ({ key: String(n.key), grep: n.grep, cs: cs(n) })));
    const retry = needles.filter((n) => n.after && !first.has(String(n.key)));
    const second = await search(retry.map((n) => ({ key: String(n.key), grep: n.after, cs: cs(n) })));
    for (const n of needles) {
      const k = String(n.key);
      if (first.has(k)) map.set(n.key, first.get(k));
      else if (second.has(k)) map.set(n.key, `déjà fait ? ${second.get(k)}`);
      else if (n.grep || n.after) map.set(n.key, 'introuvable');
    }
    return map;
  };

  const pagesFrom = (locations) => {
    const pages = new Set();
    for (const v of locations.values()) for (const m of String(v).matchAll(/p\.([^\s,#]+)/g)) pages.add(m[1]);
    return [...pages].sort((a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b)));
  };

  const definitions = [
    {
      name: 'read_source_document',
      description: 'Read a client file (Word .docx, PDF, .doc/.rtf/.odt on macOS, .txt/.md) as Markdown: headings, lists, tables, links, images, comment markers [C1] and tracked changes [+added+] [-removed-]. Long files come in slices: start with outline: true, then read the part you need with offset.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the file' },
          outline: { type: 'boolean', description: 'Only the outline (headings with their offsets; PDF: pages with their first line)', default: false },
          offset: { type: 'number', description: 'Start of the slice (characters, from the outline or the previous slice)', default: 0 },
          maxChars: { type: 'number', description: 'Slice length (1000-60000)', default: 15000 },
          pages: { type: 'array', items: { type: 'number' }, description: 'PDF: page numbers of the PDF file (1-based) to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'read_feedback',
      description: 'Client feedback as one numbered table: PDF annotations (notes, highlights, strike-outs, insertions, replacements, drawings, replies and review states) with the text each one points at, or Word comments and tracked changes (before/after). locate: true also finds each item in the active InDesign document (page name + text frame id). Read it before prepare_edit, and ask the project manager about unclear items.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the commented PDF or the Word file' },
          locate: { type: 'boolean', description: 'Find each item in the active InDesign document', default: false },
          pages: { type: 'array', items: { type: 'number' }, description: 'PDF: only these PDF pages (1-based)' },
          author: { type: 'string', description: 'Only the items of this reviewer (part of the name)' },
        },
        required: ['path'],
      },
    },
  ];

  const handlers = {};

  handlers.read_source_document = async (args) => {
    const file = resolveSourcePath(args.path);
    const src = await loadSource(file);
    const maxChars = Math.max(1000, Math.min(60000, Number(args.maxChars) || 15000));
    let md, outline = [], header = [];
    if (src.kind === 'docx') {
      const d = src.docx;
      md = d.markdown;
      if (d.comments.length) md += `\n---\nCommentaires :\n${d.comments.map((c) => `[C${c.n}] ${c.author}${c.parent ? ' (réponse)' : ''} : ${c.text.replace(/\n/g, ' / ')}`).join('\n')}\n`;
      outline = d.outline;
      header.push(`${path.basename(file)} – Word${src.converted ? ' (converti avec textutil : commentaires et suivi peuvent manquer)' : ''}: ${md.length} caractères, ${outline.length} titres, ${d.tables} tableaux, ${d.images} images, ${d.comments.length} commentaires, ${d.changes.length} paragraphes avec suivi des modifications.`);
      if (outline.some((o) => o.inferred)) header.push('Titres déduits de la mise en forme (gras / capitales) : le document n’utilise pas de styles de titre.');
      if (d.changes.length || d.comments.length) header.push('Commentaires et modifications suivies en tableau : read_feedback.');
    } else if (src.kind === 'pdf') {
      const { numPages, pages } = await readPdfText(src.pdf, { pages: args.pages });
      const parts = [];
      for (const p of pages) {
        const title = `PDF p.${p.pdfPage}${p.side ? ` ${sideFr[p.side]}` : ''}${p.label ? ` (page ${p.label})` : p.folio ? ` (folio ${p.folio})` : ''}`;
        outline.push({ level: 1, text: `${title} – ${cut((p.text.split('\n').find((l) => l.trim().length > 3) || '').trim(), 70)}`, offset: parts.join('').length });
        parts.push(`## ${title}\n\n${p.text || '(pas de texte : page image ou vide)'}\n\n`);
      }
      md = parts.join('');
      const spreads = pages.some((p) => p.side);
      header.push(`${path.basename(file)} – PDF de ${numPages} pages${spreads ? ' en planches (chaque planche lue en page gauche / droite)' : ''}: ${md.length} caractères. Le texte suit l’ordre du PDF ; les retours à la ligne sont ceux de la mise en page.`);
      if (!md.replace(/## .*\n|\(pas de texte[^)]*\)/g, '').trim()) header.push('Aucun texte extractible : PDF scanné ou vectorisé. Demandez la source au chef de projet.');
    } else {
      md = src.text;
      header.push(`${path.basename(file)} – texte : ${md.length} caractères.`);
    }

    if (args.outline) {
      const lines = outline.map((o) => `${'  '.repeat(Math.max(0, o.level - 1))}- ${o.text}  (offset ${o.offset})`);
      return { content: [{ type: 'text', text: `${header.join('\n')}\n\n${lines.join('\n') || '(aucun titre)'}` }] };
    }
    let start = Math.max(0, Math.min(md.length, Number(args.offset) || 0));
    if (start > 0 && md[start - 1] !== '\n') {   // an offset inside a line starts at that line
      const nl = md.lastIndexOf('\n', start);
      start = nl >= 0 && start - nl < 400 ? nl + 1 : start;
    }
    let end = Math.min(md.length, start + maxChars);
    if (end < md.length) {
      const para = md.lastIndexOf('\n\n', end);
      if (para > start + maxChars * 0.5) end = para + 2;
    }
    const slice = md.slice(start, end);
    const more = end < md.length ? `\n\n[… ${md.length - end} caractères de plus : offset ${end}${outline.length ? ', ou outline: true pour le plan' : ''}]` : '';
    const intro = start === 0 ? `${header.join('\n')}\n\n` : `[${path.basename(file)}, caractères ${start}–${end} sur ${md.length}]\n\n`;
    return { content: [{ type: 'text', text: intro + slice + more }] };
  };

  handlers.read_feedback = async (args) => {
    const file = resolveSourcePath(args.path);
    const src = await loadSource(file);
    const who = args.author ? String(args.author).toLowerCase() : null;
    const lines = [];
    let locations = null;

    if (src.kind === 'pdf') {
      let items = await readAnnotations(src.pdf, { pages: args.pages });
      if (who) items = items.filter((a) => a.author.toLowerCase().includes(who) || (a.replies || []).some((r) => r.author.toLowerCase().includes(who)));
      if (!items.length) return { content: [{ type: 'text', text: `${path.basename(file)}: aucune annotation de relecture${who ? ` de « ${args.author} »` : ''} (liens et champs de formulaire ignorés).` }] };
      const authors = {};
      for (const a of items) authors[a.author || '?'] = (authors[a.author || '?'] || 0) + 1;
      const kinds = {};
      for (const a of items) kinds[TYPE_FR[a.kind] || a.type] = (kinds[TYPE_FR[a.kind] || a.type] || 0) + 1;
      lines.push(`${path.basename(file)} – ${items.length} retours (${Object.entries(kinds).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')}) par ${Object.entries(authors).map(([k, n]) => `${k} (${n})`).join(', ')}.`);
      if (items.some((a) => a.side)) lines.push('PDF en planches : « Page » = folio imprimé sur la page quand il est trouvé, sinon page du PDF + côté.');
      if (args.locate) {
        locations = await locate(items.map((a) => { const nd = pdfNeedles(a); return { key: a.n, grep: nd.before, after: nd.after }; }));
        const pages = pagesFrom(locations);
        lines.push(`Dans InDesign : ${pages.length ? `pages ${pages.join(', ')}` : 'aucun texte retrouvé'}. « p.12 #4512 » = page et id du bloc texte où le texte visé se trouve ; « déjà fait ? » = seul le texte corrigé existe ; « introuvable » = texte réécrit depuis, ou retour visuel : placez-le avec la colonne Page.`);
      }
      lines.push('', pdfFeedbackTable(items, locations));
      const drawn = items.filter((a) => ['drawing', 'shape', 'stamp', 'attachment'].includes(a.kind));
      if (drawn.length) lines.push('', `Retours visuels (${drawn.map((a) => `#${a.n}`).join(', ')}) : leur sens tient au dessin ; demandez une capture au chef de projet s’il n’est pas clair.`);
    } else if (src.kind === 'docx') {
      const d = src.docx;
      if (who) {
        d.comments = d.comments.filter((c) => c.author.toLowerCase().includes(who));
        d.changes = d.changes.filter((c) => c.authors.some((a) => a.toLowerCase().includes(who)));
      }
      if (!d.comments.length && !d.changes.length) return { content: [{ type: 'text', text: `${path.basename(file)}: ni commentaire ni modification suivie${who ? ` de « ${args.author} »` : ''}.${src.converted ? ' (fichier converti : enregistrez-le en .docx pour garder les commentaires)' : ''}` }] };
      lines.push(`${path.basename(file)} – ${d.comments.filter((c) => !c.parent).length} commentaires, ${d.changes.length} paragraphes modifiés en suivi. Section = titre au-dessus dans le Word.`);
      if (args.locate) {
        const needles = [
          ...d.comments.filter((c) => !c.parent).map((c) => ({ key: `C${c.n}`, grep: grepNeedle(c.anchor) })),
          ...d.changes.map((c, k) => ({ key: `M${k + 1}`, grep: grepNeedle(c.probe.before), after: grepNeedle(c.probe.after) })),
        ];
        locations = await locate(needles);
        const pages = pagesFrom(locations);
        lines.push(`Dans InDesign : ${pages.length ? `pages ${pages.join(', ')}` : 'aucun texte retrouvé'}.`);
      }
      lines.push('', docxFeedbackTables(d, locations));
    } else {
      return { content: [{ type: 'text', text: `${path.basename(file)}: un fichier texte n’a pas de commentaires ; read_source_document le lit.` }] };
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };

  return { definitions, handlers };
}
