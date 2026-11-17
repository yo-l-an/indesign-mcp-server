#!/usr/bin/env node
/**
 * README screenshots: review_compare images rendered from fixture pages, no InDesign needed.
 * The pages are drawn here (shapes and Inter text from lib/raster.js), their inventories are
 * written beside them, and the real compareSnapshots builds the images.
 *
 *   npm run screenshots            -> assets/readme/*.png
 *   node scripts/readme-screenshots.mjs <dir>
 *
 * Two scenarios, four images:
 *   review-objects.png   move, resize, rotation, fx effect, fill, opacity (zone label icons)
 *   review-text.png      text edit, object added, object removed
 *   review-move.png      an object moved to another page
 *   review-pages.png     page map: a page moved and a page added
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createImage, fillRect, roundRect, triangle, line, drawString } from '../lib/raster.js';
import { compareSnapshots } from '../lib/review.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PX = 3;                       // pixels per mm
const W = 148, H = 210;             // A5, mm

const C = {
  paper: [255, 255, 255], ink: [31, 41, 55], grey: [156, 163, 175], light: [229, 231, 235],
  mint: [167, 243, 208], coral: [251, 146, 120], navy: [30, 58, 138], sun: [252, 211, 77],
  violet: [139, 92, 246], teal: [20, 184, 166],
};

// ---------------------------------------------------------------------------------------------
// Fixture objects: { id, type, x, y, w, h (mm), rotation, rgb, swatch, opacity, effects, text, size }
// drawn on a page image and described in the inventory the way review-tools.js captures it

function corners(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = -((o.rotation || 0) * Math.PI) / 180;   // InDesign: + turns left
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx * o.w) / 2, dy = (sy * o.h) / 2;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  });
}

function bounds(o) {
  const pts = corners(o);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)].map((v) => Math.round(v * 1000) / 1000);
}

function drawObject(img, o) {
  const alpha = (o.opacity ?? 100) / 100;
  if ((o.effects || []).includes('drop shadow')) {
    for (let k = 4; k >= 1; k--) fillRect(img, (o.x + 1.2) * PX - k, (o.y + 1.8) * PX - k, o.w * PX + 2 * k, o.h * PX + 2 * k, [0, 0, 0], 0.07);
  }
  if (o.rgb) {
    if (o.rotation) {
      const p = corners(o).map(([x, y]) => [x * PX, y * PX]);
      triangle(img, [p[0], p[1], p[2]], o.rgb, alpha);
      triangle(img, [p[0], p[2], p[3]], o.rgb, alpha);
      line(img, p[0][0], p[0][1], p[2][0], p[2][1], 1.5, o.rgb, alpha);   // no seam between the halves
    } else if (o.round) {
      roundRect(img, o.x * PX, o.y * PX, o.w * PX, o.h * PX, o.round * PX, o.rgb, alpha);
    } else {
      fillRect(img, o.x * PX, o.y * PX, o.w * PX, o.h * PX, o.rgb, alpha);
    }
  }
  if (o.text) {
    o.text.split('\n').forEach((line, i) => drawString(img, line, o.x * PX + (o.rgb ? 8 : 0), o.y * PX + (o.rgb ? 6 : 0) + i * (o.size + 6), o.size, o.ink || C.ink));
  }
}

function inventoryItem(o, pageId) {
  const it = { id: o.id, type: o.type || (o.text ? 'TextFrame' : 'Rectangle'), pageId, bounds: bounds(o), rotation: o.rotation || 0, fill: o.swatch || (o.rgb ? 'Swatch' : 'None') };
  it.opacity = o.opacity ?? 100;
  if (o.effects) it.effects = o.effects;
  if (o.text) it.text = o.text.replace(/\n/g, ' ');
  if (o.name) it.name = o.name;
  return it;
}

const pageImage = (objects, bg = C.paper) => {
  const img = createImage(W * PX, H * PX, [...bg, 255]);
  objects.forEach((o) => drawObject(img, o));
  return img;
};

const page = (id, number, objects) => ({ id, index: number - 1, number, name: String(number), widthMm: W, heightMm: H, items: objects.map((o) => inventoryItem(o, id)) });
const inventory = (pages, allPages) => ({
  document: { name: 'Brochure.indd', pageCount: allPages.length, allPageIds: allPages.map((p) => p.id), allPages },
  pages, pageIds: pages.map((p) => p.id), resolution: PX * 25.4,
});

// ---------------------------------------------------------------------------------------------
// Scenario 1: objects edited on page 1, text and objects added / removed on page 2, a photo
// moved from page 2 to page 3

const header = (swatch, rgb, id = 11) => ({ id, x: 0, y: 0, w: W, h: 34, rgb, swatch });
const title = { id: 12, x: 12, y: 12, w: 110, h: 10, text: 'Summer collection', size: 20 };
const caption = { id: 13, x: 12, y: 188, w: 120, h: 8, text: 'Brochure – spring edition', size: 11, ink: C.grey };

const page1Before = [
  header('Mint', C.mint), title, caption,
  { id: 21, x: 14, y: 48, w: 46, h: 46, rgb: C.navy, swatch: 'Navy', name: 'Logo' },
  { id: 22, x: 82, y: 48, w: 50, h: 34, rgb: C.sun, swatch: 'Sun', name: 'Photo' },
  { id: 23, x: 14, y: 116, w: 46, h: 40, rgb: C.violet, swatch: 'Violet' },
  { id: 24, x: 82, y: 116, w: 50, h: 40, rgb: C.teal, swatch: 'Teal' },
];
const page1After = [
  header('Coral', C.coral), title, caption,
  { ...page1Before[3], rotation: 12 },                                    // rotation
  { ...page1Before[4], x: 88, y: 60 },                                    // move
  { ...page1Before[5], w: 56, h: 48, opacity: 50 },                       // resize + opacity
  { ...page1Before[6], effects: ['drop shadow'] },                        // fx
];

const priceBefore = { id: 31, x: 14, y: 46, w: 120, h: 30, text: 'Price: 39 euros, sizes S to L\nLinen shirt, made in Portugal', size: 13 };
const priceAfter = { ...priceBefore, text: 'Price: 45 euros, sizes S to XL\nLinen shirt, made in Portugal' };
const sticker = { id: 32, x: 96, y: 92, w: 36, h: 14, rgb: C.coral, swatch: 'Coral', round: 3, text: 'NEW', size: 13, ink: [255, 255, 255] };
const badge = { id: 33, x: 14, y: 92, w: 40, h: 14, rgb: C.navy, swatch: 'Navy', round: 3, text: '-20 %', size: 13, ink: [255, 255, 255] };
const photo = { id: 34, x: 14, y: 122, w: 118, h: 56, rgb: C.sun, swatch: 'Sun', name: 'Hero photo' };
const photoMoved = { ...photo, y: 50 };
const page3Text = { id: 41, x: 14, y: 120, w: 118, h: 30, text: 'Our shops\nOpen every day, 10 am to 7 pm', size: 13 };

const P = (n, side, spread) => ({ id: n, name: String(n), spread, side });

async function scenarioEdits() {
  const all = [P(1, 'single', 1), P(2, 'single', 2), P(3, 'single', 3)];
  const before = inventory([page(1, 1, page1Before), page(2, 2, [header('Mint', C.mint, 51), priceBefore, sticker, photo]), page(3, 3, [header('Mint', C.mint, 52), page3Text])], all);
  const after = inventory([page(1, 1, page1After), page(2, 2, [header('Mint', C.mint, 51), priceAfter, badge]), page(3, 3, [header('Mint', C.mint, 52), photoMoved, page3Text])], all);
  const images = {
    'before:1': pageImage(page1Before), 'after:1': pageImage(page1After),
    'before:2': pageImage([header('Mint', C.mint, 51), priceBefore, sticker, photo]), 'after:2': pageImage([header('Mint', C.mint, 51), priceAfter, badge]),
    'before:3': pageImage([header('Mint', C.mint, 52), page3Text]), 'after:3': pageImage([header('Mint', C.mint, 52), photoMoved, page3Text]),
  };
  return compareSnapshots({ before, after, source: memorySource(images), language: 'en', crop: false });
}

// ---------------------------------------------------------------------------------------------
// Scenario 2: page map of a facing-pages brochure, page 6 moved after page 2 and a page added

const THUMB = [C.mint, C.coral, C.sun, C.violet, C.teal, C.navy, C.light, [244, 114, 182]];
const thumbPage = (n) => pageImage([
  { id: 1, x: 0, y: 0, w: W, h: 60, rgb: THUMB[(n - 1) % THUMB.length] },
  { id: 2, x: 14, y: 76, w: 120, h: 6, rgb: C.light }, { id: 3, x: 14, y: 88, w: 96, h: 6, rgb: C.light },
  { id: 4, x: 14, y: 100, w: 110, h: 6, rgb: C.light },
  { id: 5, x: 14, y: 124, w: 120, h: 60, rgb: [243, 244, 246] },
]);

async function scenarioPages() {
  // spreads: [1] [2 3] [4 5] [6 7]   ->   [1] [2 6] [3 4] [5 8] [7]   (6 moved after 2, 8 added)
  const facing = (ids) => ids.map((id, i) => ({ id, name: String(i + 1), spread: Math.floor((i + 1) / 2), side: i === 0 ? 'right' : i % 2 ? 'left' : 'right' }));
  const before = inventory([], facing([1, 2, 3, 4, 5, 6, 7]));
  const after = inventory([], facing([1, 2, 6, 3, 4, 5, 8, 7]));
  before.pageIds = []; after.pageIds = [];
  const source = memorySource({});
  source.thumbnails = async (list) => new Map(list.map((p) => [p.id, thumbPage(p.id)]));
  source.pageImage = (side, id) => thumbPage(id);
  return compareSnapshots({ before, after, source, language: 'en' });
}

function memorySource(images) {
  return {
    pageImage: (side, id) => images[`${side}:${id}`] || null,
    locatePages: async () => [],
    addPages: async () => [],
    thumbnails: async () => new Map(),
  };
}

// ---------------------------------------------------------------------------------------------

export const SCREENSHOTS = {
  'review-page-001.png': 'review-objects.png',
  'review-page-002.png': 'review-text.png',
  'review-move-002-to-003.png': 'review-move.png',
  'review-pages.png': 'review-pages.png',
};

// Renders the README images into dir; returns [{ file, caption }] and the review tables
export async function renderReadmeScreenshots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const runs = [await scenarioEdits(), await scenarioPages()];
  const written = [];
  for (const out of runs) {
    for (const img of out.images) {
      const name = SCREENSHOTS[img.file];
      if (!name) continue;
      fs.writeFileSync(path.join(dir, name), img.png);
      written.push({ file: name, caption: img.caption });
    }
  }
  return { written, tables: runs.map((r) => r.table) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || path.join(ROOT, 'assets', 'readme'));
  const { written, tables } = await renderReadmeScreenshots(dir);
  for (const w of written) console.log(`${path.relative(process.cwd(), path.join(dir, w.file))}  (${w.caption})`);
  if (process.env.SHOW_TABLES) console.log('\n' + tables.join('\n\n'));
}
