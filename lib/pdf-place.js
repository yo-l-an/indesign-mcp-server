// Placing PDF and Illustrator files: which page (artboard), which crop, and where the bleed goes.
// Shared by place_graphic, place_image and place_image_in_shape, so the three behave the same.
//
//   PDF_PROPS                          schema of pdfPage, crop, position
//   pdfPlacement(args, file)           validated { pdfPage, crop, position, boxes } (null: not a PDF/AI)
//   pdfPlaceScript(placement)          ES3 snippets: before (set the place preferences), check(g)
//                                      (the file has that page), restore, info(g) (result text;
//                                      set placement.scaleX / scaleY first when the artboard is scaled)
//   artboardBounds(placement, box)     frame bounds so that box is the artboard and the bleed hangs out
//
// What each crop covers (checked in InDesign 2027): the artboard
// is "trim" for every file ("pdf" too for an Illustrator .ai; for a PDF exported with bleed "pdf"
// usually includes the bleed); artboard + bleed is "bleed". An .ai carries no bleed: Illustrator
// writes its PDF part with every box equal to the artboard.

import fs from 'fs';
import path from 'path';
import { jsStr } from './script-runtime.js';
import { pdfPageBoxes } from './pdf-source.js';

export const CROPS = { pdf: 'CROP_PDF', art: 'CROP_ART', trim: 'CROP_TRIM', bleed: 'CROP_BLEED', media: 'CROP_MEDIA', content_visible: 'CROP_CONTENT_VISIBLE_LAYERS', content_all: 'CROP_CONTENT_ALL_LAYERS' };
const POSITIONS = ['artboard', 'bleed'];

export const PDF_PROPS = {
  pdfPage: { type: 'number', description: 'PDF / AI: page (Illustrator: artboard) to place, 1-based', default: 1 },
  crop: { type: 'string', enum: Object.keys(CROPS), description: 'PDF / AI: what to place: pdf (crop box; for an .ai the artboard), trim (the artboard), bleed (artboard + bleed, from a PDF exported with bleed; an .ai has none), art, media, content_visible, content_all', default: 'pdf' },
  position: { type: 'string', enum: POSITIONS, description: 'With crop "bleed": artboard (default) = x, y, width, height describe the artboard and the bleed hangs outside (onto the document bleed for a full-page visual; in a shape: the artboard is fitted, the bleed is cut by the shape); bleed = they describe the whole graphic including the bleed' },
};

export const isPdfLike = (file) => ['.pdf', '.ai'].includes(path.extname(String(file || '')).toLowerCase());

export function pdfPlacement(args, file) {
  const given = ['pdfPage', 'crop', 'position'].filter((k) => args[k] !== undefined && args[k] !== null);
  if (!isPdfLike(file)) {
    if (given.length) throw new Error(`${given.join(', ')} only apply to .pdf and .ai files`);
    return null;
  }
  const crop = args.crop ?? 'pdf';
  if (!CROPS[crop]) throw new Error(`Invalid crop: ${crop} (use ${Object.keys(CROPS).join(', ')})`);
  const pdfPage = args.pdfPage === undefined || args.pdfPage === null ? 1 : Math.floor(Number(args.pdfPage));
  if (!Number.isFinite(pdfPage) || pdfPage < 1) throw new Error('pdfPage must be >= 1');
  if (args.position !== undefined && args.position !== null) {
    if (!POSITIONS.includes(args.position)) throw new Error(`Invalid position: ${args.position} (use artboard or bleed)`);
    if (crop !== 'bleed') throw new Error('position applies with crop: "bleed" (the other crops have no bleed around the artboard)');
  }
  const position = crop === 'bleed' ? (args.position ?? 'artboard') : null;
  let boxes = null;
  if (position === 'artboard') {
    try {
      boxes = pdfPageBoxes(fs.readFileSync(file), pdfPage);
    } catch (e) {
      throw new Error(`Cannot read the artboard and bleed of ${path.basename(file)}: ${e.message}. Use position: "bleed" to place the whole graphic instead.`);
    }
  }
  return { pdfPage, crop, position, boxes, isAi: path.extname(file).toLowerCase() === '.ai' };
}

// ES3 for the script: place preferences set before placing, restored afterwards (in a finally)
export function pdfPlaceScript(p) {
  if (!p) return { before: '', check: () => '', restore: '', info: () => '""' };
  return {
    before: `var __pp = app.pdfPlacePreferences, __oldPage = __pp.pageNumber, __oldCrop = __pp.pdfCrop;
        __pp.pageNumber = ${p.pdfPage};
        __pp.pdfCrop = PDFCrop.${CROPS[p.crop]};`,
    // InDesign silently falls back to page 1 when the file has fewer pages
    check: (g) => `
        var __placedPage = ${g}.pdfAttributes.pageNumber;
        if (__placedPage !== ${p.pdfPage}) throw new Error("The file has no page ${p.pdfPage}: InDesign placed page " + __placedPage + " instead (the file has fewer pages)");`,
    restore: 'try { __pp.pageNumber = __oldPage; __pp.pdfCrop = __oldCrop; } catch (eRestore) {}',
    // sx / sy: ES expressions of the artboard scale (numbers from Node, or script variables)
    info: (g, sx = String(p.scaleX ?? 1), sy = String(p.scaleY ?? p.scaleX ?? 1)) => `(function () { try { return " pdfPage=" + ${g}.pdfAttributes.pageNumber + " crop=" + ${jsStr(p.crop)}; } catch (eInfo) { return ""; } })() + ${bleedNote(p, sx, sy)}`,
  };
}

const mm = (n) => Math.round(n * 100) / 100;

// ES expression: the bleed added around the artboard, at its placed scale
function bleedNote(p, sx, sy) {
  if (p.position !== 'artboard' || !p.boxes) return '""';
  const b = p.boxes.bleed;
  if (!p.boxes.hasBleed) return jsStr(` position=artboard; the file carries no bleed${p.isAi ? ' (an Illustrator .ai stops at the artboard: place a PDF exported with bleed)' : ''}`);
  const side = (v, s) => `Math.round(${v} * (${s}) * 100) / 100`;
  return `" position=artboard; bleed added (mm): top " + ${side(b.top, sy)} + ", left " + ${side(b.left, sx)} + ", bottom " + ${side(b.bottom, sy)} + ", right " + ${side(b.right, sx)}`;
}

// Scale of the artboard for a target box (mm): width or height scales it, both must keep its ratio
export function artboardScale(p, { width = null, height = null }) {
  const { width: aw, height: ah } = p.boxes;
  if (width !== null && height !== null) {
    const sx = width / aw, sy = height / ah;
    if (Math.abs(sx - sy) > 0.01 * Math.max(sx, sy)) {
      throw new Error(`The artboard is ${mm(aw)} × ${mm(ah)} mm: give width or height (it keeps its proportions), or both in that ratio`);
    }
    return sx;
  }
  if (width !== null) return width / aw;
  if (height !== null) return height / ah;
  return 1;
}

// Graphic/frame bounds [top, left, bottom, right] when the artboard sits at x, y with scale s
export function artboardBounds(p, x, y, s) {
  const { width: aw, height: ah, bleed: b } = p.boxes;
  return [y - b.top * s, x - b.left * s, y + (ah + b.bottom) * s, x + (aw + b.right) * s];
}
