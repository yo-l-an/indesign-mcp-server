// Masters (parent pages): find the objects repeated from page to page, turn them into a master,
// apply masters, override master objects on a page and give them back, rename, base one master on
// another, delete.
//
// A master object shows on every page that uses the master, behind that page's own objects of the
// same layer. On a page it is locked until overridden; the overridden copy gets its own id and keeps
// a link to the master object (removing the override brings the master version back).

import { PAGES_SCRIPT, parsePageLines, resolvePageRefs } from './review-tools.js';
import { LAYOUT_JS } from './layout-tools.js';
import { has } from '../lib/tool-context.js';

// ES3: a signature that is the same for two objects repeated on several pages: kind, place (rounded
// to the tolerance), colours, image, paragraph style and text. A text made only of digits (a typed
// folio) counts as the same text.
const SIGNATURE_JS = `
  function __txt(it) {
    try { if (it.constructor.name === "TextFrame") return it.parentStory.contents; } catch (e) {}
    return "";
  }
  function __sig(it, tol) {
    var b = it.geometricBounds, q = function (v) { return Math.round(v / tol) * tol; };
    var s = it.constructor.name + "|" + q(b[0]) + "," + q(b[1]) + "," + q(b[2]) + "," + q(b[3]);
    try { s += "|r" + Math.round(it.rotationAngle); } catch (e) {}
    try { s += "|f" + (it.fillColor ? it.fillColor.name : "") + "|s" + (it.strokeColor ? it.strokeColor.name : "") + "/" + Math.round(it.strokeWeight * 10); } catch (e) {}
    try { if (it.allGraphics.length) { var lk = it.allGraphics[0].itemLink; s += "|img" + (lk && lk.isValid ? lk.name : "embedded"); } } catch (e) {}
    var t = __txt(it);
    if (it.constructor.name === "TextFrame") {
      try { s += "|p" + it.parentStory.paragraphs[0].appliedParagraphStyle.name; } catch (e) {}
      var clean = t.replace(/[\\s\\u0018]+/g, " ").replace(/^ | $/g, "");
      s += "|t" + (/^\\d{1,4}$/.test(clean) || t.indexOf("\\u0018") >= 0 && clean.replace(/\\D/g, "") === clean ? "#folio" : clean.substr(0, 160));
    }
    return s;
  }
  function __short(it) {
    // page-number / section-marker characters read as \\u0018 / \\u0019 in contents
    var t = __txt(it).replace(/\\u0018/g, "<page #>").replace(/\\u0019/g, "<section>").replace(/[\\r\\n]+/g, " ¶ ").replace(/\\s+/g, " ");
    var b = it.geometricBounds;
    return it.constructor.name + " x" + Math.round(b[1]) + " y" + Math.round(b[0]) + " " + Math.round(b[3] - b[1]) + "×" + Math.round(b[2] - b[0]) +
      (t ? " «" + (t.length > 40 ? t.substr(0, 40) + "…" : t) + "»" : "") + (it.name ? " name=" + it.name : "");
  }
`;

export function createMasterTools(ctx) {
  const { run, respond, jsStr, jsNum, jsJson } = ctx;
  const masterParam = { type: 'string', description: 'Master by name ("B-Chapitre"), prefix ("B") or base name' };
  const pagesParam = { type: 'array', items: {}, description: 'Pages as named in InDesign ("12", "+3", "Tablette:2")' };

  const definitions = [
    {
      name: 'find_repeated_items',
      modifies: false,
      description: 'Find objects repeated at the same place on several pages (backgrounds, headers, footers, folios, logos, frames of a recurring layout): candidates for a master. Each pattern lists its pages and the object ids on one page, with the create_master call that turns it into a master. Typed folios (digits only) count as the same object.',
      inputSchema: {
        type: 'object',
        properties: {
          pages: { ...pagesParam, description: 'Pages to scan (default: all)' },
          minPages: { type: 'number', description: 'Report objects found on at least this many pages', default: 3 },
          tolerance: { type: 'number', description: 'Position tolerance (mm)', default: 0.5 },
        },
      },
    },
    {
      name: 'create_master',
      modifies: true,
      description: 'Create a master (parent page). Optionally copy objects into it (fromIds: objects of one page, or of a left and a right page for facing masters; they land on the master page of the same side at the same place), turn typed folios into automatic page numbers (pageNumberIds), apply it to pages, and delete from those pages the objects the master now provides (removeMatching). Without fromIds the master is empty (or a copy of basedOn\'s items through inheritance).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Base name, e.g. "Chapitre"' },
          prefix: { type: 'string', description: 'Prefix shown on pages (1-4 characters); default: next free letter' },
          pageCount: { type: 'number', description: 'Pages in the master: 2 for facing pages (default), 1 otherwise' },
          basedOn: { type: 'string', description: 'Parent master: this master inherits its objects and changes with it' },
          fromIds: { type: 'array', items: { type: 'number' }, description: 'Objects to copy into the master (they stay where they are)' },
          pageNumberIds: { type: 'array', items: { type: 'number' }, description: 'Among fromIds: text frames whose digits become the automatic page number' },
          applyTo: { ...pagesParam, description: 'Pages to apply the master to' },
          removeMatching: { type: 'boolean', description: 'On those pages, delete the objects that match fromIds (same kind, place, colours, text; folios match any number)', default: false },
          tolerance: { type: 'number', description: 'Matching tolerance (mm)', default: 0.5 },
        },
        required: ['name'],
      },
    },
    {
      name: 'copy_to_master',
      modifies: true,
      description: 'Copy objects (by id) into an existing master, at the same place on the master page of the same side. Same options as create_master: pageNumberIds, removeOriginals (delete the copied objects from their page), applyTo + removeMatching.',
      inputSchema: {
        type: 'object',
        properties: {
          master: masterParam,
          ids: { type: 'array', items: { type: 'number' }, description: 'Objects to copy into the master' },
          pageNumberIds: { type: 'array', items: { type: 'number' }, description: 'Among ids: text frames whose digits become the automatic page number' },
          removeOriginals: { type: 'boolean', description: 'Delete the copied objects from their page', default: false },
          applyTo: { ...pagesParam, description: 'Pages to apply the master to' },
          removeMatching: { type: 'boolean', description: 'On those pages, delete the objects that match ids', default: false },
          tolerance: { type: 'number', description: 'Matching tolerance (mm)', default: 0.5 },
        },
        required: ['master', 'ids'],
      },
    },
    {
      name: 'apply_master',
      modifies: true,
      description: 'Apply a master to pages ("none" removes it), and/or show or hide master objects on their spreads.',
      inputSchema: {
        type: 'object',
        properties: {
          pages: pagesParam,
          master: { type: 'string', description: 'Master name / prefix, or "none"' },
          showMasterItems: { type: 'boolean', description: 'false hides the master objects on the spreads of these pages' },
        },
        required: ['pages'],
      },
    },
    {
      name: 'list_master_items',
      modifies: false,
      description: 'Objects of a master, page by page, with their ids: edit them with the usual tools (set_object_geometry, edit_text_frame, find_replace_text…) to change every page that uses the master. With page: the master objects shown on that page, and the ones already overridden there.',
      inputSchema: { type: 'object', properties: { master: masterParam, page: { type: 'string', description: 'A document page instead: its master objects and overrides' } } },
    },
    {
      name: 'override_master_items',
      modifies: true,
      description: 'Override master objects on a page (Ctrl/Cmd+Shift+click): the page gets an editable copy linked to the master object, with a new id (returned). all: true overrides every master object of the page. detach: true cuts the link (the copy no longer follows the master).',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page as named in InDesign' },
          ids: { type: 'array', items: { type: 'number' }, description: 'Master object ids (list_master_items)' },
          all: { type: 'boolean', description: 'Override every master object of the page', default: false },
          detach: { type: 'boolean', description: 'Cut the link to the master', default: false },
        },
        required: ['page'],
      },
    },
    {
      name: 'remove_master_overrides',
      modifies: true,
      destructive: true,
      description: 'Give overridden objects back to their master: the page copy (and its edits) is deleted and the master version shows again. ids: overridden copies on the page; all: true every override of the page.',
      inputSchema: {
        type: 'object',
        properties: { page: { type: 'string', description: 'Page as named in InDesign' }, ids: { type: 'array', items: { type: 'number' }, description: 'Overridden copies on the page' }, all: { type: 'boolean', description: 'Every override of the page', default: false } },
        required: ['page'],
      },
    },
    {
      name: 'set_master',
      modifies: true,
      description: 'Rename a master (name and/or prefix), or base it on another master ("none" to stop inheriting).',
      inputSchema: {
        type: 'object',
        properties: { master: masterParam, newName: { type: 'string', description: 'New base name' }, prefix: { type: 'string', description: 'New prefix (1-4 characters)' }, basedOn: { type: 'string', description: 'Parent master, or "none"' } },
        required: ['master'],
      },
    },
    {
      name: 'delete_master',
      modifies: true,
      destructive: true,
      description: 'Delete a master. Its pages get replaceWith (a master name or "none"; default "none"). Overridden copies stay on their pages as plain objects.',
      inputSchema: { type: 'object', properties: { master: masterParam, replaceWith: { type: 'string', description: 'Master for the pages that used it, or "none"', default: 'none' } }, required: ['master'] },
    },
  ];

  const readPages = async () => parsePageLines(await run(PAGES_SCRIPT));
  const ids = (list, label) => (list || []).map((v) => jsNum(v, label));
  const tol = (v) => {
    const t = has(v) ? jsNum(v, 'tolerance') : 0.5;
    if (t <= 0 || t > 20) throw new Error(`Invalid tolerance: ${v} (0 to 20 mm)`);
    return t;
  };

  // ES3 statements: copy items (idList) into master m, folio frames get the page-number character,
  // then apply to pages (applyIdx) and delete matching objects there. Uses __sig, __master.
  const copyJs = ({ idList, folioList, applyIdx, removeMatching, removeOriginals, t }) => `
    var ids = ${jsJson(idList)}, folios = ${jsJson(folioList)}, applyIdx = ${jsJson(applyIdx)};
    var isFolio = {};
    for (var f = 0; f < folios.length; f++) isFolio[folios[f]] = 1;
    var lines = [], sigs = {}, copies = 0, originals = [];
    for (var i = 0; i < ids.length; i++) {
      var it = __findById(doc, ids[i]);
      if (!it) throw new Error("No object with id " + ids[i]);
      var pg = it.parentPage;
      if (!pg) throw new Error("Object " + ids[i] + " is on the pasteboard: put it on a page first");
      // the master page of the same side (single-page masters: their only page)
      var target = m.pages[m.pages.length - 1];
      for (var q = 0; q < m.pages.length; q++) if (String(m.pages[q].side) === String(pg.side)) target = m.pages[q];
      sigs[__sig(it, ${t})] = 1;
      var b = it.geometricBounds;
      var dup = it.duplicate(target);
      // keep the same place on the page (the master page may sit elsewhere in its spread)
      var nb = dup.geometricBounds;
      if (Math.abs(nb[0] - b[0]) > 0.01 || Math.abs(nb[1] - b[1]) > 0.01) dup.move(undefined, [b[1] - nb[1], b[0] - nb[0]]);
      if (isFolio[ids[i]]) {
        if (dup.constructor.name !== "TextFrame") throw new Error("pageNumberIds: object " + ids[i] + " is not a text frame");
        // the typed number (first run of digits) becomes the page-number character, its formatting kept
        var st = dup.parentStory, txt = st.contents, mm0 = /\\d+/.exec(txt);
        if (mm0) st.characters.itemByRange(mm0.index, mm0.index + mm0[0].length - 1).contents = SpecialCharacters.AUTO_PAGE_NUMBER;
        else st.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
      }
      copies++;
      originals.push(it);
      lines.push("  " + __short(dup) + " → master id " + dup.id + (isFolio[ids[i]] ? " (page number)" : ""));
    }
    ${removeOriginals ? 'for (var o = 0; o < originals.length; o++) originals[o].remove();' : ''}
    var applied = [], removed = 0;
    for (var a = 0; a < applyIdx.length; a++) {
      var page = doc.pages[applyIdx[a]];
      page.appliedMaster = m;
      applied.push(page.name);
      ${removeMatching ? `
        var own = page.pageItems.everyItem().getElements();
        for (var k = own.length - 1; k >= 0; k--) {
          var keep = false;
          for (var z = 0; z < ids.length; z++) if (own[k].id === ids[z]) keep = true;
          if (keep) continue;
          if (sigs[__sig(own[k], ${t})]) { own[k].remove(); removed++; }
        }
      ` : ''}
    }
    var __copyResult = (copies ? copies + " object(s) copied into master " + m.name + ":\\n" + lines.join("\\n") : "") +
      (applied.length ? "\\nApplied to pages " + applied.join(", ") : "") + (${removeMatching ? 'true' : 'false'} ? "; " + removed + " matching object(s) removed from those pages (the master now shows them)" : "") +
      (${removeOriginals ? 'true' : 'false'} ? "; originals removed from their pages" : "");
  `;

  const handlers = {};

  handlers.find_repeated_items = async (args) => {
    const pages = await readPages();
    const idx = Array.isArray(args.pages) && args.pages.length ? resolvePageRefs(args.pages, pages).map((p) => p.index) : pages.map((p) => p.index);
    const min = Math.max(2, Math.round(jsNum(args.minPages ?? 3, 'minPages')));
    const t = tol(args.tolerance);
    const out = String(await run(`
      var doc = __requireDoc();
      ${SIGNATURE_JS}
      var idx = ${jsJson(idx)}, rows = [];
      for (var i = 0; i < idx.length; i++) {
        var pg = doc.pages[idx[i]], its = pg.pageItems.everyItem().getElements();
        for (var k = 0; k < its.length; k++) {
          try { rows.push(idx[i] + "\\t" + pg.name + "\\t" + String(pg.side) + "\\t" + its[k].id + "\\t" + __sig(its[k], ${t}) + "\\t" + __short(its[k])); } catch (e) {}
        }
      }
      rows.join("\\n");
    `));
    const bySig = new Map();
    for (const line of out.split('\n').filter(Boolean)) {
      const [pi, name, side, id, sig, desc] = line.split('\t');
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push({ index: Number(pi), name, side, id: Number(id), desc });
    }
    // Objects repeated on the same set of pages form one pattern (one master candidate)
    const patterns = new Map();
    for (const [sig, hits] of bySig) {
      const pagesOf = [...new Set(hits.map((h) => h.index))];
      if (pagesOf.length < min) continue;
      const key = pagesOf.join(',');
      if (!patterns.has(key)) patterns.set(key, { pages: pagesOf, items: [] });
      patterns.get(key).items.push({ sig, hits });
    }
    if (!patterns.size) return respond(`No object repeated on ${min}+ of the ${idx.length} pages scanned (tolerance ${t} mm).`, 'Repeated Items');
    const name = (i) => pages.find((p) => p.index === i)?.name ?? `+${i + 1}`;
    const ranges = (list) => list.map(name).join(', ');
    const lines = [];
    [...patterns.values()].sort((a, b) => b.pages.length - a.pages.length).forEach((p, n) => {
      // one example page per side, so facing masters get both sides
      const sides = [...new Set(p.items.flatMap((it) => it.hits.map((h) => h.side)))];
      const ex = sides.map((s) => p.items.flatMap((it) => it.hits).find((h) => h.side === s)?.index).filter((v) => v !== undefined);
      const exampleIds = p.items.flatMap((it) => it.hits.filter((h) => ex.includes(h.index)).slice(0, 2).filter((h, k, arr) => arr.findIndex((x) => x.index === h.index) === k).map((h) => h.id));
      const folioIds = p.items.filter((it) => it.sig.endsWith('|t#folio')).flatMap((it) => it.hits.filter((h) => exampleIds.includes(h.id)).map((h) => h.id));
      lines.push(`Pattern ${n + 1} – ${p.items.length} object(s) on ${p.pages.length} pages: ${ranges(p.pages)}`);
      for (const it of p.items) {
        const h = it.hits.find((x) => ex.includes(x.index)) || it.hits[0];
        lines.push(`  ${h.desc}${it.sig.endsWith('|t#folio') ? ' — typed folio' : ''} (id ${h.id} on page ${h.name}${it.hits.length > p.pages.length ? `, ${it.hits.length} copies` : ''})`);
      }
      lines.push(`  → create_master({ name: "…", fromIds: ${JSON.stringify(exampleIds)}${folioIds.length ? `, pageNumberIds: ${JSON.stringify(folioIds)}` : ''}, applyTo: ${JSON.stringify(p.pages.map(name))}, removeMatching: true })`);
    });
    return respond(`${patterns.size} repeated pattern(s) on ${idx.length} pages (tolerance ${t} mm, at least ${min} pages):\n${lines.join('\n')}`, 'Repeated Items');
  };

  const applyIndexes = async (refs) => (Array.isArray(refs) && refs.length ? resolvePageRefs(refs, await readPages()).map((p) => p.index) : []);


  handlers.create_master = async (args) => {
    const idList = ids(args.fromIds, 'fromIds');
    const folioList = ids(args.pageNumberIds, 'pageNumberIds');
    if (folioList.some((f) => !idList.includes(f))) throw new Error('pageNumberIds must be among fromIds');
    if (args.removeMatching && !idList.length) throw new Error('removeMatching needs fromIds (the objects to match)');
    if (has(args.prefix) && !/^.{1,4}$/.test(String(args.prefix))) throw new Error('prefix: 1 to 4 characters');
    const applyIdx = await applyIndexes(args.applyTo);
    const pc = has(args.pageCount) ? Math.round(jsNum(args.pageCount, 'pageCount')) : null;
    if (pc !== null && (pc < 1 || pc > 10)) throw new Error('pageCount: 1 to 10');
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${SIGNATURE_JS}
      for (var e0 = 0; e0 < doc.masterSpreads.length; e0++) if (doc.masterSpreads[e0].baseName === ${jsStr(args.name)}) throw new Error("A master is already called " + doc.masterSpreads[e0].name);
      var count = ${pc === null ? '(doc.documentPreferences.facingPages ? 2 : 1)' : pc};
      var props = { baseName: ${jsStr(args.name)} };
      var used = {};
      for (var u0 = 0; u0 < doc.masterSpreads.length; u0++) used[doc.masterSpreads[u0].namePrefix] = 1;
      ${has(args.prefix) ? `props.namePrefix = ${jsStr(args.prefix)}; if (used[props.namePrefix]) throw new Error("Prefix " + props.namePrefix + " is already used by another master");` : `
      // InDesign would give the new master the prefix "A" again: take the next free letter
      var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (var l0 = 0; l0 < letters.length; l0++) if (!used[letters.charAt(l0)]) { props.namePrefix = letters.charAt(l0); break; }`}
      var m = doc.masterSpreads.add(count, props);
      // a new master starts with the application's default margins: take those of the first master
      try {
        var src = doc.masterSpreads[0];
        for (var mp = 0; mp < m.pages.length; mp++) {
          var from = src.pages[Math.min(mp, src.pages.length - 1)].marginPreferences, to = m.pages[mp].marginPreferences;
          to.top = from.top; to.bottom = from.bottom; to.left = from.left; to.right = from.right; to.columnCount = from.columnCount; to.columnGutter = from.columnGutter;
        }
      } catch (e) {}
      ${has(args.basedOn) ? `m.appliedMaster = __master(doc, ${jsStr(args.basedOn)});` : ''}
      var __copyResult = "";
      ${idList.length || applyIdx.length ? copyJs({ idList, folioList, applyIdx, removeMatching: !!args.removeMatching, removeOriginals: false, t: tol(args.tolerance) }) : ''}
      "Master " + m.name + " created (" + m.pages.length + " page" + (m.pages.length > 1 ? "s" : "") + (m.appliedMaster && m.appliedMaster.isValid ? ", based on " + m.appliedMaster.name : "") + ")." + (__copyResult ? "\\n" + __copyResult : "");
    `);
    return respond(out, 'Create Master');
  };

  handlers.copy_to_master = async (args) => {
    const idList = ids(args.ids, 'ids');
    if (!idList.length) throw new Error('ids: the objects to copy');
    const folioList = ids(args.pageNumberIds, 'pageNumberIds');
    if (folioList.some((f) => !idList.includes(f))) throw new Error('pageNumberIds must be among ids');
    const applyIdx = await applyIndexes(args.applyTo);
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${SIGNATURE_JS}
      var m = __master(doc, ${jsStr(args.master)});
      ${copyJs({ idList, folioList, applyIdx, removeMatching: !!args.removeMatching, removeOriginals: !!args.removeOriginals, t: tol(args.tolerance) })}
      __copyResult;
    `);
    return respond(out, 'Copy To Master');
  };

  handlers.apply_master = async (args) => {
    const idx = await applyIndexes(args.pages);
    if (!idx.length) throw new Error('pages: which pages');
    if (!has(args.master) && !has(args.showMasterItems)) throw new Error('Pass master and/or showMasterItems');
    const none = has(args.master) && String(args.master).toLowerCase() === 'none';
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var idx = ${jsJson(idx)}, names = [];
      ${has(args.master) ? `var m = ${none ? 'NothingEnum.NOTHING' : `__master(doc, ${jsStr(args.master)})`};` : ''}
      for (var i = 0; i < idx.length; i++) {
        var pg = doc.pages[idx[i]];
        ${has(args.master) ? 'pg.appliedMaster = m;' : ''}
        ${has(args.showMasterItems) ? `pg.parent.showMasterItems = ${args.showMasterItems ? 'true' : 'false'};` : ''}
        names.push(pg.name);
      }
      ${has(args.master) ? `"Master " + ${none ? '"[None]"' : 'm.name'} + " applied to pages " + names.join(", ")` : '"Pages " + names.join(", ")'} + ${has(args.showMasterItems) ? `"; master objects ${args.showMasterItems ? 'shown' : 'hidden'} on their spreads"` : '""'};
    `);
    return respond(out, 'Apply Master');
  };

  handlers.list_master_items = async (args) => {
    if (has(args.page)) {
      const [page] = resolvePageRefs([args.page], await readPages());
      const out = await run(`
        var doc = __requireDoc();
        ${SIGNATURE_JS}
        var pg = doc.pages[${page.index}], L = [];
        var m = pg.appliedMaster;
        L.push("Page " + pg.name + " – master " + (m && m.isValid ? m.name : "[None]"));
        var mi = pg.masterPageItems;
        L.push("Master objects shown (override_master_items takes these ids): " + mi.length);
        for (var i = 0; i < mi.length; i++) L.push("  id=" + mi[i].id + " " + __short(mi[i]) + (mi[i].allowOverrides === false ? " (overrides not allowed)" : ""));
        var ov = [], own = pg.allPageItems;
        for (var k = 0; k < own.length; k++) { try { if (own[k].overridden) ov.push("  id=" + own[k].id + " " + __short(own[k]) + " ← master id " + own[k].overriddenMasterPageItem.id); } catch (e) {} }
        L.push("Overridden on this page: " + ov.length);
        L.join("\\n") + (ov.length ? "\\n" + ov.join("\\n") : "");
      `);
      return respond(out, 'Master Items');
    }
    if (!has(args.master)) throw new Error('Pass master (its objects) or page (master objects shown on a page)');
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      ${SIGNATURE_JS}
      var m = __master(doc, ${jsStr(args.master)}), L = [];
      L.push("Master " + m.name + (m.appliedMaster && m.appliedMaster.isValid ? " (based on " + m.appliedMaster.name + ")" : ""));
      for (var p = 0; p < m.pages.length; p++) {
        var pg = m.pages[p], its = pg.pageItems.everyItem().getElements();
        L.push((m.pages.length > 1 ? (String(pg.side).indexOf("LEFT") === 0 ? "Left page" : "Right page") : "Page") + " – " + its.length + " object(s), " + pg.guides.length + " guide(s), " + __describeMargins(pg));
        for (var i = 0; i < its.length; i++) L.push("  id=" + its[i].id + " " + __short(its[i]) + " layer=" + its[i].itemLayer.name);
      }
      L.join("\\n");
    `);
    return respond(out, 'Master Items');
  };

  handlers.override_master_items = async (args) => {
    const [page] = resolvePageRefs([args.page], await readPages());
    const idList = ids(args.ids, 'ids');
    if (!idList.length && !args.all) throw new Error('Pass ids (master objects, list_master_items) or all: true');
    const out = await run(`
      var doc = __requireDoc();
      ${SIGNATURE_JS}
      var pg = doc.pages[${page.index}], want = ${jsJson(idList)}, all = ${args.all ? 'true' : 'false'};
      var shown = pg.masterPageItems, L = [], n = 0, byId = {}, known = [];
      for (var i = 0; i < shown.length; i++) { byId[shown[i].id] = shown[i]; known.push(shown[i].id); }
      var list = [];
      if (all) list = shown;
      else for (var w = 0; w < want.length; w++) {
        if (!byId[want[w]]) throw new Error("Master object " + want[w] + " is not shown on page " + pg.name + " (already overridden, on the other side of the master, or not in its master). Shown: " + (known.length ? known.join(", ") : "none"));
        list.push(byId[want[w]]);
      }
      for (var j = 0; j < list.length; j++) {
        var copy = list[j].override(pg);
        ${args.detach ? 'copy.detach();' : ''}
        L.push("  master id " + list[j].id + " → id " + copy.id + " " + __short(copy));
        n++;
      }
      n + " master object(s) ${args.detach ? 'overridden and detached' : 'overridden'} on page " + pg.name + ":\\n" + L.join("\\n");
    `);
    return respond(out, 'Override Master Items');
  };

  handlers.remove_master_overrides = async (args) => {
    const [page] = resolvePageRefs([args.page], await readPages());
    const idList = ids(args.ids, 'ids');
    if (!idList.length && !args.all) throw new Error('Pass ids (overridden copies) or all: true');
    const out = await run(`
      var doc = __requireDoc();
      var pg = doc.pages[${page.index}], want = ${jsJson(idList)}, n = 0, skipped = [];
      var own = pg.allPageItems;
      for (var k = own.length - 1; k >= 0; k--) {
        var it = own[k], ov = false, asked = ${args.all ? 'true' : 'false'};
        try { ov = it.overridden; } catch (e) {}
        for (var w = 0; w < want.length; w++) if (it.id === want[w]) asked = true;
        if (!asked) continue;
        if (!ov) { if (!${args.all ? 'true' : 'false'}) skipped.push(it.id); continue; }
        it.removeOverride(); n++;
      }
      n + " override(s) removed on page " + pg.name + " (the master versions show again)" + (skipped.length ? "; not overridden, left as they are: " + skipped.join(", ") : "");
    `);
    return respond(out, 'Remove Overrides');
  };

  handlers.set_master = async (args) => {
    if (!has(args.newName) && !has(args.prefix) && !has(args.basedOn)) throw new Error('Pass newName, prefix and/or basedOn');
    if (has(args.prefix) && !/^.{1,4}$/.test(String(args.prefix))) throw new Error('prefix: 1 to 4 characters');
    const none = has(args.basedOn) && String(args.basedOn).toLowerCase() === 'none';
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var m = __master(doc, ${jsStr(args.master)}), before = m.name;
      ${has(args.newName) ? `m.baseName = ${jsStr(args.newName)};` : ''}
      ${has(args.prefix) ? `m.namePrefix = ${jsStr(args.prefix)};` : ''}
      ${has(args.basedOn) ? (none ? 'm.appliedMaster = NothingEnum.NOTHING;' : `var parent = __master(doc, ${jsStr(args.basedOn)}); if (parent.id === m.id) throw new Error("A master cannot be based on itself"); m.appliedMaster = parent;`) : ''}
      "Master " + before + " → " + m.name + (m.appliedMaster && m.appliedMaster.isValid ? " (based on " + m.appliedMaster.name + ")" : " (not based on another master)");
    `);
    return respond(out, 'Set Master');
  };

  handlers.delete_master = async (args) => {
    const repl = args.replaceWith ?? 'none';
    const none = String(repl).toLowerCase() === 'none';
    const out = await run(`
      var doc = __requireDoc();
      ${LAYOUT_JS}
      var m = __master(doc, ${jsStr(args.master)}), name = m.name;
      ${none ? 'var r = NothingEnum.NOTHING;' : `var r = __master(doc, ${jsStr(repl)}); if (r.id === m.id) throw new Error("replaceWith is the master being deleted");`}
      var moved = [];
      for (var i = 0; i < doc.pages.length; i++) { var am = doc.pages[i].appliedMaster; if (am && am.isValid && am.id === m.id) { doc.pages[i].appliedMaster = r; moved.push(doc.pages[i].name); } }
      for (var k = 0; k < doc.masterSpreads.length; k++) { var ms = doc.masterSpreads[k]; if (ms.id !== m.id && ms.appliedMaster && ms.appliedMaster.isValid && ms.appliedMaster.id === m.id) ms.appliedMaster = NothingEnum.NOTHING; }
      m.remove();
      "Master " + name + " deleted" + (moved.length ? "; pages " + moved.join(", ") + " now use " + ${none ? '"[None]"' : 'r.name'} : "");
    `);
    return respond(out, 'Delete Master');
  };

  return { definitions, handlers };
}
