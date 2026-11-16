// Word (.docx) reader: the text as Markdown (headings, lists, tables, links, images), the
// reviewers' comments with the text they point at, and the tracked changes as before/after rows.
//
// Markers in the Markdown: [+inserted+] and [-deleted-] for tracked changes, [C3] after the text
// a comment points at, [image: name] for pictures, [encadré: …] for text boxes.

import { readZip, parseXml, kids, kid, findAll } from './xml-lite.js';

const attr = (el, name) => el?.a?.[name] ?? el?.a?.[name.replace(/^w:/, '')];
const val = (el) => attr(el, 'w:val');
const onOff = (el) => !!el && !/^(0|false|off)$/i.test(val(el) ?? '1');

function relMap(xml) {
  const out = {};
  if (!xml) return out;
  for (const r of findAll(parseXml(xml), 'Relationship')) out[r.a.Id] = r.a.Target;
  return out;
}

function styleMap(xml) {
  const out = {};
  if (!xml) return out;
  for (const s of findAll(parseXml(xml), 'w:style')) {
    const id = attr(s, 'w:styleId');
    const name = val(kid(s, 'w:name')) || id;
    const lvl = val(kid(kid(s, 'w:pPr'), 'w:outlineLvl'));
    out[id] = { name, outline: lvl != null ? Number(lvl) : null, basedOn: val(kid(s, 'w:basedOn')) };
  }
  return out;
}

function numberingMap(xml) {
  const abstract = {}, nums = {};
  if (!xml) return { fmt: () => null };
  const root = parseXml(xml);
  for (const a of findAll(root, 'w:abstractNum')) {
    abstract[attr(a, 'w:abstractNumId')] = Object.fromEntries(kids(a, 'w:lvl').map((l) => [attr(l, 'w:ilvl'), val(kid(l, 'w:numFmt')) || 'bullet']));
  }
  for (const n of findAll(root, 'w:num')) nums[attr(n, 'w:numId')] = val(kid(n, 'w:abstractNumId'));
  return { fmt: (numId, ilvl) => abstract[nums[numId]]?.[ilvl] ?? 'bullet' };
}

export function headingLevel(style, styles) {
  for (let s = style, guard = 0; s && guard < 10; s = styles[s]?.basedOn, guard++) {
    const st = styles[s];
    if (!st) break;
    if (st.outline != null && st.outline < 9) return st.outline + 1;
    const m = /^(?:heading|titre|überschrift|titolo|encabezado)\s*(\d)$/i.exec(st.name);
    if (m) return Number(m[1]);
    if (/^(title|titre)$/i.test(st.name)) return 1;
  }
  return 0;
}

const escMd = (s) => s.replace(/\|/g, '\\|');

// Render segments [{ t, b, i, ins, del, link, mark }] as Markdown-ish text
export function renderSegs(segs, { changes = true } = {}) {
  const merged = [];
  let prev = null;
  segs = segs.map((s) => {
    if (s.mark || !prev || s.t.trim()) { if (!s.mark) prev = s; return s; }
    return { ...s, b: prev.b, i: prev.i, link: prev.link };   // spaces join the formatting around them
  });
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && !s.mark && !last.mark && last.b === s.b && last.i === s.i && last.ins === s.ins && last.del === s.del && last.link === s.link) last.t += s.t;
    else merged.push({ ...s });
  }
  let out = '';
  for (const s of merged) {
    if (s.mark) { out += s.mark; continue; }
    if (!changes && s.del) continue;
    let t = s.t;
    if (!t) continue;
    if (t.trim()) {
      const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
      let core = t.trim();
      if (s.b) core = `**${core}**`;
      if (s.i) core = `_${core}_`;
      if (s.link && s.link !== core.replace(/^[*_]+|[*_]+$/g, '')) core = `[${core}](${s.link})`;
      t = lead + core + trail;
    }
    if (changes && s.ins) t = `[+${t}+]`;
    if (changes && s.del) t = `[-${t}-]`;
    out += t;
  }
  return out;
}

const plainOf = (segs, side) => segs.filter((s) => !s.mark && !(side === 'before' ? s.ins : s.del)).map((s) => s.t).join('');

// Excerpt of a paragraph around its changes: before (~~deleted~~) and after (**inserted**)
export function changeExcerpt(segs, ctx = 60, maxChanged = 220) {
  const real = segs.filter((s) => !s.mark);
  const side = (which) => {
    // runs of [changed?, text], spaces between two changed runs stay inside the change
    const runs = [];
    for (const s of real) {
      if (which === 'before' ? s.ins : s.del) continue;
      const changed = !!(which === 'before' ? s.del : s.ins);
      const last = runs[runs.length - 1];
      if (last && last.changed === changed) last.t += s.t;
      else runs.push({ changed, t: s.t });
    }
    for (let k = 1; k < runs.length - 1; k++) {
      if (!runs[k].changed && !runs[k].t.trim() && runs[k - 1].changed && runs[k + 1].changed) {
        runs[k - 1].t += runs[k].t + runs[k + 1].t;
        runs.splice(k, 2);
        k--;
      }
    }
    let txt = '', first = -1, last = -1;
    for (const r of runs) {
      if (r.changed && r.t.trim()) {
        let core = r.t.trim().replace(/\s+/g, ' ');
        if (core.length > maxChanged) core = core.slice(0, maxChanged) + '…';
        const lead = r.t.match(/^\s*/)[0], trail = r.t.match(/\s*$/)[0];
        txt += lead;
        if (first < 0) first = txt.length;
        txt += which === 'before' ? `~~${core}~~` : `**${core}**`;
        last = txt.length;
        txt += trail;
      } else txt += r.t;
    }
    txt = txt.replace(/\s+/g, ' ');
    if (first < 0) return txt.length > 2 * ctx ? txt.slice(0, 2 * ctx).trim() + '…' : txt.trim();
    const a = Math.max(0, first - ctx), b = Math.min(txt.length, last + ctx);
    let out = txt.slice(a, b);
    if (a > 0) out = '…' + out.replace(/^\S*\s/, '');
    if (b < txt.length) out = out.replace(/\s\S*$/, '') + '…';
    return out.trim();
  };
  return { before: side('before'), after: side('after') };
}

export function readDocx(buf) {
  const zip = readZip(buf);
  const get = (n) => (zip.has(n) ? zip.get(n)().toString('utf8') : null);
  const docXml = get('word/document.xml');
  if (!docXml) throw new Error('no word/document.xml: not a Word document');
  const styles = styleMap(get('word/styles.xml'));
  const numbering = numberingMap(get('word/numbering.xml'));
  const rels = relMap(get('word/_rels/document.xml.rels'));

  // comments (+ replies and "done" from commentsExtended)
  const comments = [];
  const commentById = {};
  const cx = get('word/comments.xml');
  const paraToComment = {};
  if (cx) {
    for (const c of findAll(parseXml(cx), 'w:comment')) {
      const ps = findAll(c, 'w:p');
      const text = ps.map((p) => findAll(p, 'w:t').map((t) => t.c.join('')).join('')).join('\n').trim();
      const item = { id: attr(c, 'w:id'), author: attr(c, 'w:author') || '', initials: attr(c, 'w:initials') || '', date: attr(c, 'w:date') || '', text, anchor: '', section: '', done: false, parent: null };
      const lastPara = ps[ps.length - 1];
      if (lastPara?.a['w14:paraId']) paraToComment[lastPara.a['w14:paraId']] = item;
      comments.push(item);
      commentById[item.id] = item;
    }
    const ext = get('word/commentsExtended.xml');
    if (ext) {
      for (const e of findAll(parseXml(ext), 'w15:commentEx')) {
        const item = paraToComment[e.a['w15:paraId']];
        if (!item) continue;
        item.done = e.a['w15:done'] === '1';
        const parent = paraToComment[e.a['w15:paraIdParent']];
        if (parent) item.parent = parent.id;
      }
    }
  }

  // footnotes
  const footnotes = {};
  const fx = get('word/footnotes.xml');
  if (fx) {
    for (const f of findAll(parseXml(fx), 'w:footnote')) {
      const id = attr(f, 'w:id');
      if (Number(id) <= 0) continue;
      footnotes[id] = findAll(f, 'w:t').map((t) => t.c.join('')).join('').trim();
    }
  }

  const openComments = new Set();
  const listCounters = {};
  const blocks = [];
  const changes = [];
  const headings = [];   // { level, text, inferred }; section = index of the current heading
  let section = -1;
  let images = 0;

  // Inline walk of a paragraph (or any run container) -> segments
  const walkInline = (el, ctx, segs) => {
    for (const c of el.c) {
      if (typeof c === 'string') continue;
      switch (c.n) {
        case 'w:r': {
          const rPr = kid(c, 'w:rPr');
          const fmt = { b: onOff(kid(rPr, 'w:b')), i: onOff(kid(rPr, 'w:i')) };
          for (const r of c.c) {
            if (typeof r === 'string') continue;
            const push = (t) => {
              segs.push({ t, ...fmt, ...ctx });
              for (const id of openComments) if (commentById[id] && !ctx.del) commentById[id].anchor += t;
            };
            if (r.n === 'w:t' || r.n === 'w:delText') push(r.c.join(''));
            else if (r.n === 'w:tab' || r.n === 'w:ptab') push('\t');
            else if (r.n === 'w:br' || r.n === 'w:cr') push(attr(r, 'w:type') === 'page' ? '\n' : '\n');
            else if (r.n === 'w:noBreakHyphen') push('-');
            else if (r.n === 'w:softHyphen') { /* invisible */ }
            else if (r.n === 'w:sym') push(String.fromCharCode(parseInt(attr(r, 'w:char') || '3F', 16) & 0xff));
            else if (r.n === 'w:footnoteReference') segs.push({ mark: `[^${attr(r, 'w:id')}]` });
            else if (r.n === 'w:drawing' || r.n === 'w:pict' || r.n === 'mc:AlternateContent') inlineObject(r, segs);
          }
          break;
        }
        case 'w:ins': case 'w:moveTo':
          walkInline(c, { ...ctx, ins: true, author: attr(c, 'w:author'), date: attr(c, 'w:date') }, segs); break;
        case 'w:del': case 'w:moveFrom':
          walkInline(c, { ...ctx, del: true, author: attr(c, 'w:author'), date: attr(c, 'w:date') }, segs); break;
        case 'w:hyperlink': {
          const target = rels[attr(c, 'r:id')] || (attr(c, 'w:anchor') ? `#${attr(c, 'w:anchor')}` : undefined);
          walkInline(c, { ...ctx, link: target }, segs);
          break;
        }
        case 'w:commentRangeStart': openComments.add(attr(c, 'w:id')); break;
        case 'w:commentRangeEnd': {
          const id = attr(c, 'w:id');
          openComments.delete(id);
          const cm = commentById[id];
          if (cm) { cm.section = section; segs.push({ mark: `[C${comments.indexOf(cm) + 1}]` }); }
          break;
        }
        case 'w:pPr': case 'w:rPr': case 'w:proofErr': case 'w:bookmarkStart': case 'w:bookmarkEnd': break;
        case 'mc:AlternateContent': inlineObject(c, segs); break;
        default:
          // smartTag, sdt, fldSimple, customXml, sdtContent...: their runs are part of the text
          walkInline(c, ctx, segs);
      }
    }
  };

  // Pictures and text boxes inside a run
  const inlineObject = (el, segs) => {
    const choice = el.n === 'mc:AlternateContent' ? kid(el, 'mc:Choice') || kid(el, 'mc:Fallback') : el;
    if (!choice) return;
    const boxes = findAll(choice, 'w:txbxContent');
    if (boxes.length) {
      for (const box of boxes) {
        const text = kids(box, 'w:p').map((p) => { const s = []; walkInline(p, {}, s); return renderSegs(s); }).filter(Boolean).join(' / ');
        if (text.trim()) segs.push({ mark: ` [encadré: ${text.trim()}] ` });
      }
      return;
    }
    const pr = findAll(choice, 'wp:docPr')[0];
    if (pr || findAll(choice, 'v:imagedata').length || findAll(choice, 'pic:pic').length) {
      images++;
      const name = (pr && (pr.a.descr || pr.a.title || pr.a.name)) || 'image';
      segs.push({ mark: `[image: ${name.replace(/\s+/g, ' ').trim()}]` });
    }
  };

  const paragraph = (p, inTable = false) => {
    const pPr = kid(p, 'w:pPr');
    const style = val(kid(pPr, 'w:pStyle'));
    const direct = val(kid(pPr, 'w:outlineLvl'));
    let level = direct != null && Number(direct) < 9 ? Number(direct) + 1 : headingLevel(style, styles);
    const segs = [];
    walkInline(p, {}, segs);
    // Many briefs mark titles by hand (bold or capitals, short, no final full stop): inferred titles
    let inferred = false;
    if (!level && !inTable && !kid(pPr, 'w:numPr')) {
      const txt = plainOf(segs, 'after').trim();
      const words = segs.filter((s) => !s.mark && !s.del && s.t.trim());
      const short = txt.length > 1 && txt.length <= 110 && !/[.:;,]$/.test(txt) && !/^[•\-–*]/.test(txt);
      if (short && /\p{L}/u.test(txt) && txt === txt.toUpperCase() && txt.length >= 4) { level = 1; inferred = true; }
      else if (short && words.length && words.every((s) => s.b)) { level = 2; inferred = true; }
    }
    const text = renderSegs(segs);
    if (level && !inTable && plainOf(segs, 'after').trim()) {
      headings.push({ level, text: plainOf(segs, 'after').trim(), inferred });
      section = headings.length - 1;
    }
    if (segs.some((s) => s.ins || s.del) && (plainOf(segs, 'before').trim() || plainOf(segs, 'after').trim())) {
      const authors = [...new Set(segs.filter((s) => s.ins || s.del).map((s) => s.author).filter(Boolean))];
      const dates = segs.filter((s) => s.ins || s.del).map((s) => s.date).filter(Boolean).sort();
      const firstChange = segs.findIndex((x) => x.ins || x.del);
      // first changed region with a few unchanged words around it: what to look for in InDesign
      const real = segs.filter((x) => !x.mark);
      const i0 = real.findIndex((x) => x.ins || x.del);
      let i1 = i0;
      // the region runs on over short unchanged gaps ("C|c entre H|h ospitalier" is one change)
      while (i1 + 1 < real.length && (real[i1 + 1].ins || real[i1 + 1].del || (real[i1 + 1].t.length <= 12 && real[i1 + 2] && (real[i1 + 2].ins || real[i1 + 2].del)))) i1++;
      const words = (t) => t.replace(/\s+/g, ' ').trim();
      const preRaw = real.slice(0, i0).map((x) => x.t).join('');
      const preWords = preRaw.match(/(?:\S+\s+){0,4}\S*$/)[0];   // last words, glued to the change as in the text
      let post = '';
      for (let k = i1 + 1; k < real.length && !(real[k].ins || real[k].del); k++) post += real[k].t;
      const postWords = post.match(/^\S*(?:\s+\S+){0,4}/)[0];
      const region = real.slice(i0, i1 + 1);
      const probe = {
        before: words(preWords + region.filter((x) => !x.ins).map((x) => x.t).join('') + postWords),
        after: words(preWords + region.filter((x) => !x.del).map((x) => x.t).join('') + postWords),
      };
      const lead = segs.slice(0, firstChange).filter((x) => !x.mark).map((x) => x.t).join('').replace(/\s+/g, ' ').trim().split(' ').slice(-5).join(' ');
      changes.push({ section, inTable, lead, probe, ...changeExcerpt(segs), authors, date: dates[dates.length - 1] || '', fullBefore: plainOf(segs, 'before'), fullAfter: plainOf(segs, 'after') });
    }
    const numPr = kid(pPr, 'w:numPr');
    let list = null;
    if (numPr && !level) {
      const numId = val(kid(numPr, 'w:numId')), ilvl = Number(val(kid(numPr, 'w:ilvl')) || 0);
      if (numId && numId !== '0') {
        const fmt = numbering.fmt(numId, String(ilvl));
        const key = `${numId}:${ilvl}`;
        listCounters[key] = (listCounters[key] || 0) + 1;
        for (const k of Object.keys(listCounters)) if (k.startsWith(`${numId}:`) && Number(k.split(':')[1]) > ilvl) delete listCounters[k];
        list = { ilvl, ordered: !/bullet|none/.test(fmt), n: listCounters[key] };
      }
    }
    return { type: 'p', level, inferred, style: styles[style]?.name || style || '', list, segs, text };
  };

  const table = (tbl) => {
    const rows = [];
    for (const tr of kids(tbl, 'w:tr')) {
      const row = [];
      for (const tc of kids(tr, 'w:tc')) {
        const vMerge = kid(kid(tc, 'w:tcPr'), 'w:vMerge');
        const cont = vMerge && val(vMerge) !== 'restart';
        const parts = [];
        for (const el of kids(tc)) {
          if (el.n === 'w:p') parts.push(paragraph(el, true).text);
          else if (el.n === 'w:tbl') parts.push(table(el).rows.map((r) => r.join(' ; ')).join(' / '));
          else if (el.n === 'w:sdt') for (const p of findAll(el, 'w:p')) parts.push(paragraph(p, true).text);
        }
        row.push(cont ? '' : parts.filter((t) => t.trim()).join(' <br> ').replace(/\n/g, ' <br> '));
        const span = Number(val(kid(kid(tc, 'w:tcPr'), 'w:gridSpan')) || 1);
        for (let k = 1; k < span; k++) row.push('');
      }
      rows.push(row);
    }
    return { type: 'table', rows };
  };

  const body = kid(kid(parseXml(docXml), 'w:document'), 'w:body');
  const walkBlocks = (el) => {
    for (const c of kids(el)) {
      if (c.n === 'w:p') blocks.push(paragraph(c));
      else if (c.n === 'w:tbl') blocks.push(table(c));
      else if (c.n === 'w:sdt' || c.n === 'w:sdtContent' || c.n === 'w:customXml' || c.n === 'w:ins' || c.n === 'w:del') walkBlocks(c);
    }
  };
  walkBlocks(body);

  // Markdown + outline (heading offsets in the Markdown)
  let md = '';
  const outline = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      if (!b.rows.length) continue;
      const cols = Math.max(...b.rows.map((r) => r.length));
      const line = (r) => `| ${Array.from({ length: cols }, (_, k) => escMd((r[k] || '').trim())).join(' | ')} |`;
      md += `${line(b.rows[0])}\n|${' --- |'.repeat(cols)}\n${b.rows.slice(1).map(line).join('\n')}\n\n`;
      continue;
    }
    const text = b.text.replace(/\n/g, '  \n').trim();
    if (!text) continue;
    if (b.level) {
      outline.push({ level: b.level, text: plainOf(b.segs, 'after').trim(), offset: md.length, inferred: b.inferred });
      md += b.inferred ? `${text}\n\n` : `${'#'.repeat(Math.min(6, b.level))} ${text}\n\n`;
    } else if (b.list) {
      md += `${'  '.repeat(b.list.ilvl)}${b.list.ordered ? `${b.list.n}.` : '-'} ${text}\n`;
    } else md += `${text}\n\n`;
  }
  md = md.replace(/(\n[ ]*(?:-|\d+\.) [^\n]*)\n(?=[^\n -])/g, '$1\n\n');
  const fnIds = Object.keys(footnotes);
  if (fnIds.length) md += `\n${fnIds.map((id) => `[^${id}]: ${footnotes[id]}`).join('\n')}\n`;

  // Inferred titles that recur (Constat, Objectifs…) are sub-sections of the others
  const count = {};
  for (const h of headings) if (h.inferred) count[h.text.toLowerCase()] = (count[h.text.toLowerCase()] || 0) + 1;
  for (const h of headings) if (h.inferred && count[h.text.toLowerCase()] >= 3) h.level = 3;
  const pathOf = (k) => {
    if (k < 0) return '';
    const parts = [headings[k].text];
    let lvl = headings[k].level;
    for (let j = k - 1; j >= 0 && lvl > 1; j--) if (headings[j].level < lvl) { parts.unshift(headings[j].text); lvl = headings[j].level; }
    return parts.slice(-2).map((t) => (t.length > 70 ? t.slice(0, 68) + '…' : t)).join(' › ');
  };
  for (const c of changes) c.section = pathOf(c.section) + (c.inTable ? ' (tableau)' : '');
  for (const o of outline) { const h = headings.find((x) => x.text === o.text && x.inferred === o.inferred); if (h) o.level = h.level; }
  comments.forEach((c, k) => { c.n = k + 1; c.anchor = c.anchor.replace(/\s+/g, ' ').trim(); c.section = typeof c.section === 'number' ? pathOf(c.section) : ''; });
  return { markdown: md.trim() + '\n', outline, comments, changes, images, tables: blocks.filter((b) => b.type === 'table').length };
}
