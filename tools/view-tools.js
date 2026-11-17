// Alternate layouts (versions of the same document in other formats or variants) and views of the
// whole document: create / delete a layout, see the document from above (page map, layouts named),
// compare two layouts page by page (images side by side + table of differences).
//
// Images go to $TMPDIR/indesign-mcp-review/ like the review images; the result lists the files to
// show the user.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { decodePng, encodePng } from '../lib/png.js';
import { scaleImage } from '../lib/raster.js';
import { labelsFor, buildOverviewMap, buildPageComposite, boundsToRect } from '../lib/review-diff.js';
import { compareLayoutPages, layoutTable } from '../lib/layout-compare.js';
import { inventoryScript, PAGES_SCRIPT, parsePageLines, resolvePageRefs } from './review-tools.js';
import { has } from '../lib/tool-context.js';

const RULES = { preserve: 'PRESERVE_EXISTING', off: 'OFF', scale: 'SCALE', recenter: 'RECENTER', guides: 'GUIDE_BASED', objects: 'OBJECT_BASED', master: 'USE_MASTER' };
const PRESETS = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };
const MAP_THUMB_H = 160;

export function createViewTools(ctx) {
  const { run, respond, jsStr, jsNum, jsJson } = ctx;

  const definitions = [
    {
      name: 'create_alternate_layout',
      modifies: true,
      description: 'Create an alternate layout (Layout > Create Alternate Layout): a copy of a layout\'s pages in another format or as a variant, in the same document. Text stays linked to the source by default (edits to the source can be pushed to it); pass linkStories: false for an independent version. Its pages are named "Layout:page" in the tools. rule: how objects adapt to the new size (preserve = as laid out on the source, scale, recenter, guides, objects = liquid layout rules, master).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Layout name, e.g. "A5 portrait" or "Version B"' },
          from: { type: 'string', description: 'Source layout (default: the first one)' },
          preset: { type: 'string', enum: Object.keys(PRESETS), description: 'Page size preset' },
          orientation: { type: 'string', enum: ['portrait', 'landscape'] },
          width: { type: 'number', description: 'Page width (mm); default: the source size' },
          height: { type: 'number', description: 'Page height (mm)' },
          linkStories: { type: 'boolean', description: 'Keep text linked to the source layout', default: true },
          copyStyles: { type: 'boolean', description: 'Copy the text styles into a style group of the new layout', default: false },
          rule: { type: 'string', enum: Object.keys(RULES), default: 'preserve' },
        },
        required: ['name'],
      },
    },
    {
      name: 'delete_alternate_layout',
      modifies: true,
      destructive: true,
      description: 'Delete an alternate layout and its pages.',
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Layout to delete' } }, required: ['name'] },
    },
    {
      name: 'view_page_map',
      modifies: false,
      description: 'The document seen from above: every spread as small page images, like the Pages panel, page names under the pages and a band with the name of each alternate layout. Returns the image file to show the user. layout: only that layout.',
      inputSchema: {
        type: 'object',
        properties: { layout: { type: 'string', description: 'Only the pages of this alternate layout' }, language: { type: 'string', enum: ['fr', 'en'], default: 'fr' } },
      },
    },
    {
      name: 'compare_layouts',
      modifies: false,
      description: 'Compare two alternate layouts page by page (the n-th page of one with the n-th of the other), or two given pages (pageA / pageB, e.g. "3" and "Tablette:3"): images side by side, each layout named, with numbered zones (orange = differs, red / green = only on one side), and a table of what differs: place and size (mm and % of the page), text, type size, fonts, styles, colours, images. Use it to explain how one version differs from the other.',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'string', description: 'First layout' },
          b: { type: 'string', description: 'Second layout' },
          pages: { type: 'array', items: {}, description: 'Only these positions in the layouts ("1", "+2"…: page names of layout a)' },
          pageA: { type: 'string', description: 'Or: one page ("Layout:page" or a page name)' },
          pageB: { type: 'string', description: 'Its counterpart' },
          maxImages: { type: 'number', description: 'Images returned inline (all are saved)', default: 3 },
          language: { type: 'string', enum: ['fr', 'en'], default: 'fr' },
        },
      },
    },
  ];

  const outDir = (kind) => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const dir = path.join(os.tmpdir(), 'indesign-mcp-review', `${stamp}_${kind}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  // PNG export of pages, one round trip. jobsExpr: ES3 expression giving [{ i: 0-based page index, f: file }]
  const renderJs = (jobsExpr, resolution) => `
    var jobs = ${jobsExpr};
    var prefs = app.pngExportPreferences;
    prefs.exportResolution = ${resolution};
    try { prefs.transparentBackground = false; } catch (e) {}
    prefs.useDocumentBleeds = false;
    prefs.pngExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
    prefs.exportingSpread = false;
    for (var j = 0; j < jobs.length; j++) {
      prefs.pageString = "+" + (jobs[j].i + 1);
      var out = File(jobs[j].f);
      doc.exportFile(ExportFormat.PNG_FORMAT, out, false);
      if (!out.exists) throw new Error("The page export did not create " + out.fsName);
    }`;
  const decoded = (f) => (fs.existsSync(f) ? decodePng(fs.readFileSync(f)) : null);
  const readPages = async () => parsePageLines(await run(PAGES_SCRIPT));
  const layoutsOf = (pages) => [...new Set(pages.map((p) => p.layout).filter(Boolean))];

  const handlers = {};

  handlers.create_alternate_layout = async (args) => {
    let w = has(args.width) ? jsNum(args.width, 'width') : null, h = has(args.height) ? jsNum(args.height, 'height') : null;
    if (has(args.preset)) [w, h] = PRESETS[args.preset];
    if ((w === null) !== (h === null)) throw new Error('Give both width and height (mm), or a preset');
    if (w !== null && args.orientation) { const [s, l] = [Math.min(w, h), Math.max(w, h)]; [w, h] = args.orientation === 'landscape' ? [l, s] : [s, l]; }
    const rule = RULES[args.rule || 'preserve'];
    const out = await run(`
      var doc = __requireDoc();
      var name = ${jsStr(args.name)};
      var from = ${has(args.from) ? jsStr(args.from) : 'doc.sections[0].alternateLayout'};
      var spreads = [], seen = {}, layouts = {};
      for (var s = 0; s < doc.sections.length; s++) layouts[doc.sections[s].alternateLayout] = 1;
      if (layouts[name]) throw new Error("A layout is already called " + name);
      if (!layouts[from]) { var ls = []; for (var k in layouts) ls.push(k); throw new Error("Layout not found: " + from + ". Layouts: " + ls.join(", ")); }
      var w = ${w === null ? 'null' : w}, h = ${h === null ? 'null' : h};
      for (var i = 0; i < doc.pages.length; i++) {
        var pg = doc.pages[i];
        if (pg.appliedAlternateLayout.alternateLayout !== from) continue;
        if (w === null) { var b = pg.bounds; w = b[3] - b[1]; h = b[2] - b[0]; }
        if (!seen[pg.parent.id]) { seen[pg.parent.id] = 1; spreads.push(pg.parent); }
      }
      var before = doc.pages.length;
      doc.createAlternateLayout(spreads, name, w, h, ${args.copyStyles ? 'true' : 'false'}, ${args.linkStories === false ? 'false' : 'true'}, LayoutRuleOptions.${rule});
      var names = [];
      for (var q = 0; q < doc.pages.length; q++) if (doc.pages[q].appliedAlternateLayout.alternateLayout === name) names.push(doc.pages[q].name);
      "Layout " + name + " created from " + from + ": " + names.length + " pages of " + (Math.round(w * 10) / 10) + " × " + (Math.round(h * 10) / 10) + " mm (pages \\"" + name + ":" + names[0] + "\\" … \\"" + name + ":" + names[names.length - 1] + "\\"), stories ${args.linkStories === false ? 'independent' : 'linked to the source'}, rule ${args.rule || 'preserve'}.";
    `);
    return respond(out, 'Alternate Layout');
  };

  handlers.delete_alternate_layout = async (args) => {
    const out = await run(`
      var doc = __requireDoc();
      var name = ${jsStr(args.name)}, n = 0, layouts = [];
      for (var s = 0; s < doc.sections.length; s++) { if (doc.sections[s].alternateLayout === name) n += doc.sections[s].alternateLayoutLength; layouts.push(doc.sections[s].alternateLayout); }
      if (!n) throw new Error("Layout not found: " + name + ". Layouts: " + layouts.join(", "));
      if (n >= doc.pages.length) throw new Error("This is the only layout of the document");
      doc.deleteAlternateLayout(name);
      "Layout " + name + " deleted (" + n + " pages); the document has " + doc.pages.length + " pages.";
    `);
    return respond(out, 'Delete Alternate Layout');
  };

  handlers.view_page_map = async (args) => {
    const fr = args.language !== 'en';
    const dir = outDir('pages');
    const lines0 = String(await run(`
      var doc = __requireDoc();
      var __rows = [], __jobs = [];
      for (var i = 0; i < doc.pages.length; i++) {
        var pg = doc.pages[i], lay = "";
        try { lay = pg.appliedAlternateLayout.alternateLayout || ""; } catch (e) {}
        var mp = "";
        try { if (pg.appliedMaster && pg.appliedMaster.isValid) mp = pg.appliedMaster.namePrefix; } catch (e) {}
        var pb = pg.bounds;
        __rows.push([pg.id, pg.name, pg.parent.id, String(pg.side), lay, mp, Math.round((pb[3] - pb[1]) * 10) / 10, Math.round((pb[2] - pb[0]) * 10) / 10].join("\\t"));
        ${has(args.layout) ? `if (lay !== ${jsStr(args.layout)}) continue;` : ''}
        __jobs.push({ i: i, f: ${jsStr(dir + path.sep)} + "page-" + pg.id + ".png" });
      }
      if (!__jobs.length) throw new Error("No page in layout " + ${jsStr(args.layout || '')});
      ${renderJs('__jobs', 36)}
      doc.name + "\\n" + __rows.join("\\n");
    `)).split('\n');
    const inv = {
      name: lines0[0],
      pages: lines0.slice(1).filter(Boolean).map((l) => {
        const [id, name, spread, side, layout, master, w, h] = l.split('\t');
        return { id: Number(id), name, spread: Number(spread), side, layout, master, w: Number(w), h: Number(h) };
      }),
    };
    let pages = inv.pages;
    if (has(args.layout)) pages = pages.filter((p) => p.layout === args.layout);
    const multi = layoutsOf(inv.pages).length > 1;
    // one scale for every page, so a smaller format looks smaller
    const imgs = new Map(pages.map((p) => [p.id, decoded(path.join(dir, `page-${p.id}.png`))]));
    const tallest = Math.max(1, ...[...imgs.values()].filter(Boolean).map((i) => i.height));
    const k = MAP_THUMB_H / tallest;
    const list = pages.map((p) => {
      const img = imgs.get(p.id);
      return {
        id: p.id, name: p.name, spread: p.spread, side: p.side, layout: multi ? p.layout : '', sizeLabel: `${p.w} × ${p.h} mm`,
        thumb: img ? scaleImage(img, Math.max(6, Math.round(img.width * k)), Math.max(8, Math.round(img.height * k))) : null,
      };
    });
    const title = `${inv.name}${has(args.layout) ? ` – ${args.layout}` : ''} · ${pages.length} pages`;
    const png = encodePng(buildOverviewMap({ pages: list, title }));
    const file = path.join(dir, 'page-map.png');
    fs.writeFileSync(file, png);
    // text: spreads per layout, with the master prefix of each page
    const lines = [];
    let lastLayout = null, spread = null, row = [];
    const flush = () => { if (row.length) lines.push(`  ${row.join(' ')}`); row = []; };
    for (const p of pages) {
      if (multi && p.layout !== lastLayout) { flush(); lines.push(`${p.layout}:`); lastLayout = p.layout; spread = null; }
      if (spread !== null && p.spread !== spread) { row.push('|'); }
      row.push(`${p.name}${p.master ? `[${p.master}]` : ''}`);
      spread = p.spread;
    }
    flush();
    const text = [
      `${fr ? 'Plan des pages' : 'Page map'}: ${pages.length} pages${multi ? `, ${layoutsOf(inv.pages).length} ${fr ? 'mises en page' : 'layouts'}` : ''}. ${fr ? 'Planches séparées par |, gabarit entre crochets' : 'Spreads separated by |, master prefix in brackets'}:`,
      ...lines,
      `${fr ? 'Image à montrer à l\'utilisateur (fichier)' : 'Image to show the user (file)'}: ${file}`,
    ];
    return { content: [{ type: 'text', text: text.join('\n') }, { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  };

  handlers.compare_layouts = async (args) => {
    const fr = args.language !== 'en';
    const L0 = labelsFor(args.language || 'fr');
    const all = await readPages();
    let pairs, nameA, nameB;
    if (has(args.pageA) || has(args.pageB)) {
      if (!has(args.pageA) || !has(args.pageB)) throw new Error('Give both pageA and pageB');
      const [pa, pb] = resolvePageRefs([args.pageA, args.pageB], all);
      pairs = [[pa, pb]];
      nameA = pa.layout ? `${pa.layout}` : `${L0.page} ${pa.name}`;
      nameB = pb.layout ? `${pb.layout}` : `${L0.page} ${pb.name}`;
      if (nameA === nameB) { nameA = `${nameA} · ${pa.name}`; nameB = `${nameB} · ${pb.name}`; }
    } else {
      const layouts = layoutsOf(all);
      if (layouts.length < 2) throw new Error('The document has a single layout: compare two pages with pageA / pageB, or create an alternate layout first');
      if (!has(args.a) || !has(args.b)) throw new Error(`Give a and b (layouts: ${layouts.join(', ')}), or pageA / pageB`);
      for (const l of [args.a, args.b]) if (!layouts.includes(l)) throw new Error(`Layout not found: ${l}. Layouts: ${layouts.join(', ')}`);
      const A = all.filter((p) => p.layout === args.a), B = all.filter((p) => p.layout === args.b);
      let positions = A.map((_, i) => i);
      if (Array.isArray(args.pages) && args.pages.length) {
        positions = args.pages.map((ref) => {
          const s = String(ref).trim();
          const nth = s.match(/^\+(\d+)$/);
          const i = nth ? Number(nth[1]) - 1 : A.findIndex((p) => p.name === s);
          if (i < 0 || i >= A.length) throw new Error(`Page "${s}" not found in layout ${args.a} (its pages: ${A.map((p) => p.name).join(', ')})`);
          return i;
        });
      }
      pairs = positions.map((i) => [A[i] || null, B[i] || null]);
      nameA = args.a; nameB = args.b;
    }
    const L = { ...L0, before: nameA, after: nameB, legend: { modified: fr ? 'Différent' : 'Differs', moved: L0.legend.moved, removed: fr ? `Seulement ${nameA}` : `Only ${nameA}`, added: fr ? `Seulement ${nameB}` : `Only ${nameB}` } };
    const ids = [...new Set(pairs.flat().filter(Boolean).map((p) => p.id))];
    const dir = outDir('layouts');
    const jobs = pairs.flat().filter(Boolean).map((p) => ({ i: p.index, f: path.join(dir, `page-${p.id}.png`) }));
    const inv = JSON.parse(String(await run(inventoryScript(ids, null, renderJs(jsJson(jobs), 72)))).replace(/^INVENTORY\n/, ''));
    const byId = new Map(inv.pages.map((p) => [p.id, p]));
    const sections = [], images = [];
    pairs.forEach(([pa, pb], k) => {
      const ia = pa && byId.get(pa.id), ib = pb && byId.get(pb.id);
      const prefix = pairs.length > 1 ? `${k + 1}.` : '';
      if (!ia || !ib) {
        sections.push({ prefix, pageA: pa, pageB: pb, rows: [{ zone: 0, kind: ia ? 'removed' : 'added', a: null, b: null, prop: 'page', va: ia ? pa.name : L.none, vb: ib ? pb.name : L.none }] });
        return;
      }
      const { rows, same } = compareLayoutPages(ia, ib, L);
      sections.push({ prefix, pageA: pa, pageB: pb, rows, same });
      const imgA = decoded(path.join(dir, `page-${pa.id}.png`)), imgB = decoded(path.join(dir, `page-${pb.id}.png`));
      if (!imgA || !imgB) return;
      const zonesA = [], zonesB = [], seen = new Set();
      for (const r of rows) {
        if (seen.has(r.zone)) continue;
        seen.add(r.zone);
        const ra = r.a && boundsToRect(r.a.bounds, ia.widthMm, imgA), rb = r.b && boundsToRect(r.b.bounds, ib.widthMm, imgB);
        if (ra) zonesA.push({ rect: ra, zone: `${prefix}${r.zone}`, kind: r.kind });
        if (rb) zonesB.push({ rect: rb, zone: `${prefix}${r.zone}`, kind: r.kind });
      }
      // pages of different sizes: show both at the same height
      const H = Math.max(imgA.height, imgB.height);
      const fit = (img) => (img.height === H ? img : scaleImage(img, Math.round((img.width * H) / img.height), H));
      const sa = H / imgA.height, sb = H / imgB.height;
      const scaleZ = (z, s) => ({ ...z, rect: { x: Math.round(z.rect.x * s), y: Math.round(z.rect.y * s), w: Math.round(z.rect.w * s), h: Math.round(z.rect.h * s) } });
      const png = encodePng(buildPageComposite({ before: fit(imgA), after: fit(imgB), beforeZones: zonesA.map((z) => scaleZ(z, sa)), afterZones: zonesB.map((z) => scaleZ(z, sb)), L, beforeName: pa.name, afterName: pb.name }));
      const file = path.join(dir, `compare-${String(k + 1).padStart(3, '0')}.png`);
      fs.writeFileSync(file, png);
      images.push({ file, png, diffs: seen.size });
    });
    const table = layoutTable(sections, nameA, nameB, L);
    const diffs = sections.reduce((n, s) => n + new Set(s.rows.map((r) => r.zone)).size, 0);
    const identical = sections.filter((s) => !s.rows.length).map((s) => `${s.pageA.name}/${s.pageB.name}`);
    const text = [
      fr
        ? `${nameA} ↔ ${nameB} : ${pairs.length} paire(s) de pages, ${diffs} différence(s)${identical.length ? ` ; identiques (place relative, texte, styles) : ${identical.join(', ')}` : ''}.`
        : `${nameA} ↔ ${nameB}: ${pairs.length} page pair(s), ${diffs} difference(s)${identical.length ? `; identical (relative place, text, styles): ${identical.join(', ')}` : ''}.`,
      fr ? `Images : ${nameA} à gauche, ${nameB} à droite, à la même hauteur ; orange = différent, rouge = seulement ${nameA}, vert = seulement ${nameB} ; numéros = colonne #.` : `Images: ${nameA} left, ${nameB} right, same height; orange = differs, red = only ${nameA}, green = only ${nameB}; numbers = # column.`,
    ];
    if (images.length) text.push(`${fr ? 'Images à montrer à l\'utilisateur (fichiers)' : 'Images to show the user (files)'}: ${images.map((i) => i.file).join(' ; ')}`);
    if (table) text.push('', table);
    const max = Math.max(0, Math.min(10, has(args.maxImages) ? jsNum(args.maxImages, 'maxImages') : 3));
    const content = [{ type: 'text', text: text.join('\n') }];
    for (const i of images.filter((x) => x.diffs).slice(0, max)) content.push({ type: 'image', data: i.png.toString('base64'), mimeType: 'image/png' });
    return { content };
  };

  return { definitions, handlers };
}
