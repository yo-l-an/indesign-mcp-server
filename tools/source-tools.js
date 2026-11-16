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
import { openPdf, readPdfText } from '../lib/pdf-source.js';
import { readFeedback, feedbackTable, locateFeedback, pagesFrom } from '../lib/feedback.js';

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

const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s);

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

export function createSourceTools(ctx) {
  const { run } = ctx;

  // GREP search in the active document: [{ key, grep, cs }] -> Map key -> "p.12 #4512, …"
  const search = async (list) => {
    const found = new Map();
    const res = String(await run(LOCATE_SCRIPT(list))).replace(/^[\s\S]*?LOCATE\n?/, '');
    for (const line of res.split('\n')) {
      const [key, hits] = line.split('\t');
      if (key && hits) found.set(key, hits);
    }
    return found;
  };

  const definitions = [
    {
      name: 'read_source_document',
      modifies: false,
      paths: ['path'],
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
      modifies: false,
      paths: ['path'],
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
    const name = path.basename(file);
    if (src.kind === 'text') return { content: [{ type: 'text', text: `${name}: un fichier texte n’a pas de commentaires ; read_source_document le lit.` }] };
    const fb = await readFeedback(src, { pages: args.pages, author: args.author });
    const by = args.author ? ` de « ${args.author} »` : '';
    if (!fb.items.length) {
      const none = fb.kind === 'pdf'
        ? `aucune annotation de relecture${by} (liens et champs de formulaire ignorés).`
        : `ni commentaire ni modification suivie${by}.${src.converted ? ' (fichier converti : enregistrez-le en .docx pour garder les commentaires)' : ''}`;
      return { content: [{ type: 'text', text: `${name}: ${none}` }] };
    }
    const count = (key) => {
      const m = new Map();
      for (const it of fb.items) m.set(key(it), (m.get(key(it)) || 0) + 1);
      return [...m];
    };
    const lines = [`${name} – ${fb.items.length} retours (${count((it) => it.type).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')}) par ${count((it) => it.author || '?').map(([k, n]) => `${k} (${n})`).join(', ')}.`];
    if (fb.kind === 'docx') lines.push('Section = titre au-dessus dans le Word ; Suivi : ~~supprimé~~, **ajouté**.');
    if (fb.items.some((it) => it.side)) lines.push('PDF en planches : « Page » = folio imprimé sur la page quand il est trouvé, sinon page du PDF + côté.');
    let locations = null;
    if (args.locate) {
      locations = await locateFeedback(fb.items, search);
      const pages = pagesFrom(locations);
      lines.push(`Dans InDesign : ${pages.length ? `pages ${pages.join(', ')}` : 'aucun texte retrouvé'}. « p.12 #4512 » = page et id du bloc texte où le texte visé se trouve ; « déjà fait ? » = seul le texte corrigé existe ; « introuvable » = texte réécrit depuis, ou retour visuel : placez-le avec la colonne ${fb.placeHeader}.`);
    }
    lines.push('', feedbackTable(fb, locations));
    const drawn = fb.items.filter((it) => it.visual);
    if (drawn.length) lines.push('', `Retours visuels (${drawn.map((it) => `#${it.key}`).join(', ')}) : leur sens tient au dessin ; demandez une capture au chef de projet s’il n’est pas clair.`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };

  return { definitions, handlers };
}
