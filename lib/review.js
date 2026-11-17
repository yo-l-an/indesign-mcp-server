// Review comparison: BEFORE and AFTER snapshots of the same pages -> what changed, as a table,
// a summary and review images. One interface, no InDesign and no files:
//
//   const out = await compareSnapshots({ before, after, source, language, sensitivity, crop });
//   out -> { after, diff, images: [{ file, png, caption }], rows, table, summary, title, L }
//
// before / after are page inventories (inventoryScript in tools/review-tools.js). The source
// adapter supplies what the comparison needs beyond them:
//   pageImage(side, pageId)  decoded page render ('before' | 'after'), or null
//   locatePages(objectIds)   ids of the pages where these objects are now (moved out of scope)
//   addPages(pageIds)        inventory pages for those ids, added to AFTER (with their renders)
//   thumbnails(pages)        Map pageId -> small render of the current pages (page map)
//   samePixels(pageId)       optional: true when the before and after renders are identical
//                            (lets unchanged pages skip decoding and diffing)
// The review_compare tool backs it with InDesign and the snapshot folder; tests with images in
// memory. `images[].file` is the file name to write; `after` may have gained pages.

import { encodePng } from './png.js';
import {
  diffInventories, groupRows, pixelDiffRegions, pageStructureDiff, buildPageMap, buildMoveComposite, scaleImage, boundsToRect, intersects, buildPageComposite, changeRows, changesTable, labelsFor, cropRectFor, cropImage,
} from './review-diff.js';

const TEXT_PROPS = new Set(['text', 'tableText']);
const MAP_THUMB_H = 160;   // page map thumbnail height (px; pages are rendered at 36 dpi, ~420 px for A4)

// Part of g inside r (grown by pad, clipped to r), or null
const clipRect = (g, r, pad = 0) => {
  const x0 = Math.max(r.x, g.x - pad), y0 = Math.max(r.y, g.y - pad);
  const x1 = Math.min(r.x + r.w, g.x + g.w + pad), y1 = Math.min(r.y + r.h, g.y + g.h + pad);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

// Merge regions closer than pad (fine regions -> one visual zone per area)
const mergeNear = (rects, pad) => {
  const out = rects.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        j = i;
      }
    }
  }
  return out;
};

const SENSITIVITY = { low: { threshold: 60, minPixels: 6 }, normal: { threshold: 40, minPixels: 3 }, high: { threshold: 20, minPixels: 1 } };

export async function compareSnapshots({ before, after, source, language = 'fr', sensitivity = 'normal', crop = true }) {
  const L = labelsFor(language);
  const fr = L === labelsFor('fr');
  const sens = SENSITIVITY[sensitivity] || SENSITIVITY.normal;

  let diff = diffInventories(before, after);
  // Objects missing from the scope may have moved to a page outside it: find their page and
  // add it to AFTER, so they show as moved instead of removed
  const missing = diff.changes.filter((c) => c.kind === 'removed').map((c) => c.id);
  if (missing.length) {
    const found = await source.locatePages(missing);
    const extra = [...new Set(found)].filter((pid) => !after.pages.some((p) => p.id === pid));
    if (extra.length) {
      after.pages.push(...(await source.addPages(extra)));
      diff = diffInventories(before, after);
    }
  }
  const isMove = (c) => c.kind === 'modified' && c.props.some((p) => p.prop === 'page');
  const imageCache = new Map();
  const pageImage = (side, pid) => {
    const k = `${side}:${pid}`;
    if (!imageCache.has(k)) imageCache.set(k, source.pageImage(side, pid) || null);
    return imageCache.get(k);
  };
  const pageKeys = [...new Set([...before.pages.map((p) => p.id), ...after.pages.map((p) => p.id)])];
  const visualZones = [];
  let nextZone = diff.changes.length + 1;
  const pagesOut = [];
  for (const pid of pageKeys) {
    const pb = before.pages.find((p) => p.id === pid) || null;
    const pa = after.pages.find((p) => p.id === pid) || null;
    // Same render before and after: no pixel change. With no object change on the page either,
    // there is nothing to show, so the page is not even decoded
    const identical = !!(pb && pa && source.samePixels && source.samePixels(pid));
    if (identical && !diff.changes.some((c) => c.before?.pageId === pid || c.after?.pageId === pid)) continue;
    let imgB = pb ? pageImage('before', pid) : null;
    let imgA = pa ? pageImage('after', pid) : null;
    let beforeZones = [], afterZones = [];
    const sameSize = imgB && imgA && imgB.width === imgA.width && imgB.height === imgA.height;
    const regions = imgB && imgA && !identical ? pixelDiffRegions(imgB, imgA, { cell: 4, gap: 1, ...sens }) : [];
    const explained = [];
    const isTextOnly = (c) => c.kind === 'modified' && c.props.every((p) => TEXT_PROPS.has(p.prop));
    // Areas of the other changes (moves, fills, added, removed objects) on this page: their pixels
    // must not be attributed to a text change in an object underneath
    const otherRects = [];
    for (const c of diff.changes) {
      if (isTextOnly(c) && !isMove(c)) continue;
      if (c.before && c.kind !== 'added' && c.before.pageId === pid && imgB) { const r = boundsToRect(c.before.bounds, pb.widthMm, imgB); if (r) otherRects.push(r); }
      if (c.after && c.kind !== 'removed' && c.after.pageId === pid && imgA) { const r = boundsToRect(c.after.bounds, pa.widthMm, imgA); if (r) otherRects.push(r); }
    }
    const area = (r) => r.w * r.h;
    const mostlyIn = (g, o) => { const i = clipRect(g, o); return i && area(i) > 0.5 * area(g); };
    // A text-only change marks the changed lines (pixel areas inside the object), not the whole
    // frame, so a one-word edit shows as a small zone and a short gutter bar
    const zonesFor = (c, r) => {
      explained.push(r);
      if (!isTextOnly(c) || !sameSize) return [r];
      const near = Math.max(6, Math.round(imgA.width / 80));
      const own = regions.filter((g) => intersects(g, r) && !otherRects.some((o) => mostlyIn(g, o)));
      const inside = mergeNear(own.map((g) => clipRect(g, r, 2)).filter(Boolean), near);
      return inside.length ? inside : [r];
    };
    for (const c of diff.changes) {
      if (isMove(c)) {
        // shown in the move image; here it only explains its pixels
        if (c.before.pageId === pid && imgB) { const r = boundsToRect(c.before.bounds, pb.widthMm, imgB); if (r) explained.push(r); }
        if (c.after.pageId === pid && imgA) { const r = boundsToRect(c.after.bounds, pa.widthMm, imgA); if (r) explained.push(r); }
        continue;
      }
      if (c.kind !== 'added' && c.before.pageId === pid && imgB) {
        const r = boundsToRect(c.before.bounds, pb.widthMm, imgB);
        if (r) zonesFor(c, r).forEach((rect, i) => beforeZones.push({ rect, zone: c.zone, kind: c.kind, noLabel: i > 0 }));
      }
      if (c.kind !== 'removed' && c.after.pageId === pid && imgA) {
        const r = boundsToRect(c.after.bounds, pa.widthMm, imgA);
        if (r) zonesFor(c, r).forEach((rect, i) => afterZones.push({ rect, zone: c.zone, kind: c.kind, noLabel: i > 0 }));
      }
    }
    if (imgB && imgA) {
      const pad = Math.round(imgA.width / 100);
      for (const r of mergeNear(regions, pad)) {
        if (explained.some((e) => intersects(r, e, pad))) continue;
        const zone = nextZone++;
        visualZones.push({ zone, pageNumber: pa.name, rect: r, renamedFrom: pb.name !== pa.name ? pb.name : null });
        beforeZones.push({ rect: r, zone, kind: 'visual' });
        afterZones.push({ rect: r, zone, kind: 'visual' });
      }
    }
    // No zone: nothing to show (an empty added or removed page is in the page map)
    if (!beforeZones.length && !afterZones.length) continue;
    // Crop both sides to the same changed area (same page size only)
    let cropped = false;
    if (crop && imgB && imgA && imgB.width === imgA.width && imgB.height === imgA.height) {
      const cr = cropRectFor([...beforeZones, ...afterZones].map((z) => z.rect), imgA.width, imgA.height);
      if (cr) {
        const shift = (zones) => zones.map((z) => ({ zone: z.zone, kind: z.kind, noLabel: z.noLabel, rect: { ...z.rect, x: z.rect.x - cr.x, y: z.rect.y - cr.y } }));
        imgB = cropImage(imgB, cr); imgA = cropImage(imgA, cr);
        beforeZones = shift(beforeZones); afterZones = shift(afterZones);
        cropped = true;
      }
    }
    const page = pa || pb;
    const composite = buildPageComposite({ before: imgB, after: imgA, beforeZones, afterZones, pageNumber: page.name, beforeName: pb ? pb.name : page.name, afterName: pa ? pa.name : page.name, L, cropped });
    const file = `review-page-${String(page.index + 1).padStart(3, '0')}.png`;
    pagesOut.push({ index: page.index, name: page.name, file, png: encodePng(composite), caption: `${L.page} ${page.name} – ${new Set([...beforeZones, ...afterZones].map((z) => z.zone)).size} zone(s)` });
  }
  pagesOut.sort((x, y) => x.index - y.index);

  // Objects that changed page: one image per (source page, destination page)
  const movesOut = [];
  const groups = new Map();
  for (const c of diff.changes.filter(isMove)) {
    const k = `${c.before.pageId}>${c.after.pageId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) {
    const c0 = list[0];
    const pb = before.pages.find((p) => p.id === c0.before.pageId), pa = after.pages.find((p) => p.id === c0.after.pageId);
    const src = pb && pageImage('before', pb.id), dst = pa && pageImage('after', pa.id);
    if (!src || !dst) continue;
    const links = list.map((c) => ({ zone: c.zone, from: boundsToRect(c.before.bounds, pb.widthMm, src), to: boundsToRect(c.after.bounds, pa.widthMm, dst) })).filter((l) => l.from && l.to);
    if (!links.length) continue;
    const png = encodePng(buildMoveComposite({ src: { img: src, name: pb.name }, dst: { img: dst, name: pa.name }, links, L }));
    const file = `review-move-${String(pb.index + 1).padStart(3, '0')}-to-${String(pa.index + 1).padStart(3, '0')}.png`;
    movesOut.push({ file, png, caption: `${L.page} ${pb.name} → ${L.page} ${pa.name} – ${links.length} ${fr ? 'objet(s) déplacé(s)' : 'object(s) moved'}` });
  }

  // Pages added, removed or reordered: page map with thumbnails (current pages rendered small)
  const mapOut = [];
  const pageRows = diff.docChanges.filter((d) => d.scope === 'page');
  if (pageRows.length && after.document.allPages) {
    const curPages = after.document.allPages.map((p, i) => ({ ...p, index: i }));
    const thumbs = await source.thumbnails(curPages);
    const thumb = (img) => (img ? scaleImage(img, Math.max(8, Math.round((img.width * MAP_THUMB_H) / img.height)), MAP_THUMB_H) : null);
    const afterList = curPages.map((p) => ({ id: p.id, name: p.name, spread: p.spread, side: p.side, thumb: thumb(thumbs.get(p.id)) }));
    const byId = new Map(afterList.map((p) => [p.id, p.thumb]));
    const beforeList = (before.document.allPages || before.document.allPageIds.map((pid) => ({ id: pid, name: '?' })))
      .map((p) => ({ id: p.id, name: p.name, spread: p.spread, side: p.side, thumb: byId.get(p.id) || thumb(pageImage('before', p.id)) }));
    const st = pageStructureDiff(before.document.allPageIds, after.document.allPageIds);
    const png = encodePng(buildPageMap({ before: beforeList, after: afterList, st, L }));
    const file = 'review-pages.png';
    mapOut.push({ file, png, caption: fr ? `Plan des pages – ${st.moved.length} déplacée(s), ${st.added.length} ajoutée(s), ${st.removed.length} supprimée(s)` : `Page map – ${st.moved.length} moved, ${st.added.length} added, ${st.removed.length} removed` });
  }
  const imagesOut = [...mapOut, ...movesOut, ...pagesOut];

  const allRows = changeRows(diff, visualZones, L);
  const rows = groupRows(allRows);
  const table = rows.length ? changesTable(rows, L) : '';
  const counts = { modified: 0, added: 0, removed: 0, moved: 0 };
  diff.changes.forEach((c) => counts[isMove(c) ? 'moved' : c.kind]++);
  const pagesList = [...new Set([...pagesOut.map((p) => p.name), ...diff.changes.filter(isMove).map((c) => c.after.pageName)])].sort((x, y) => (parseInt(x, 10) || 0) - (parseInt(y, 10) || 0)).join(', ') || '—';
  const summary = !allRows.length
    ? (fr ? 'Aucune différence détectée.' : 'No difference found.')
    : fr
      ? `${counts.modified} modifié(s), ${counts.added} ajouté(s), ${counts.removed} supprimé(s)${counts.moved ? `, ${counts.moved} déplacé(s) vers une autre page` : ''}${visualZones.length ? `, ${visualZones.length} zone(s) visuelle(s)` : ''}${diff.docChanges.length ? `, ${diff.docChanges.length} au niveau document` : ''} – pages ${pagesList}.`
      : `${counts.modified} modified, ${counts.added} added, ${counts.removed} removed${counts.moved ? `, ${counts.moved} moved to another page` : ''}${visualZones.length ? `, ${visualZones.length} visual area(s)` : ''}${diff.docChanges.length ? `, ${diff.docChanges.length} document-level` : ''} – pages ${pagesList}.`;

  const title = fr ? `Revue des modifications – ${after.document.name}` : `Change review – ${after.document.name}`;
  return { after, diff, images: imagesOut, rows: allRows, table, summary, title, L };
}
