// Small raster toolkit for the review images (no dependency): "over" alpha compositing,
// anti-aliased shapes, soft shadows and text from a pre-rendered Inter atlas.
// Images are { width, height, data: RGBA Uint8Array } (see lib/png.js).

import zlib from 'zlib';
import { createImage } from './png.js';
import { FONT_ATLAS } from './font-atlas.js';

export { createImage };

// ---- compositing ------------------------------------------------------------------------------

// Paint rgb with coverage a (0-1) over pixel (x, y)
export function blendPixel(img, x, y, rgb, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4, d = img.data;
  const da = d[o + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[o] = Math.round((rgb[0] * a + d[o] * da * (1 - a)) / oa);
  d[o + 1] = Math.round((rgb[1] * a + d[o + 1] * da * (1 - a)) / oa);
  d[o + 2] = Math.round((rgb[2] * a + d[o + 2] * da * (1 - a)) / oa);
  d[o + 3] = Math.round(oa * 255);
}

export function fillRect(img, x, y, w, h, rgb, alpha = 1) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blendPixel(img, xx, yy, rgb, alpha);
}

export function strokeRect(img, r, rgb, t, alpha = 1) {
  fillRect(img, r.x - t, r.y - t, r.w + 2 * t, t, rgb, alpha);
  fillRect(img, r.x - t, r.y + r.h, r.w + 2 * t, t, rgb, alpha);
  fillRect(img, r.x - t, r.y, t, r.h, rgb, alpha);
  fillRect(img, r.x + r.w, r.y, t, r.h, rgb, alpha);
}

// Copy src over dst at (dx, dy), honouring src alpha
export function blit(src, dst, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a > 0) blendPixel(dst, x + dx, ty, [src.data[s], src.data[s + 1], src.data[s + 2]], a);
    }
  }
}

export function copyImage(img) {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

// ---- anti-aliased shapes ----------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Signed distance to a rounded rectangle (negative inside)
function roundRectDist(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r)), cy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - cx, dy = py - cy;
  return Math.hypot(dx, dy) - r;
}

export function roundRect(img, x, y, w, h, r, rgb, alpha = 1) {
  r = Math.min(r, w / 2, h / 2);
  for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) {
    const cov = clamp01(0.5 - roundRectDist(xx + 0.5, yy + 0.5, x, y, w, h, r));
    if (cov > 0) blendPixel(img, xx, yy, rgb, cov * alpha);
  }
}

// Ring of thickness t around a rounded rectangle (outside edge at the rectangle + t)
export function strokeRoundRect(img, x, y, w, h, r, t, rgb, alpha = 1) {
  for (let yy = Math.floor(y - t - 1); yy < Math.ceil(y + h + t + 1); yy++) for (let xx = Math.floor(x - t - 1); xx < Math.ceil(x + w + t + 1); xx++) {
    const d = roundRectDist(xx + 0.5, yy + 0.5, x, y, w, h, r);
    const cov = clamp01(Math.min(d + 0.5, t - d + 0.5));
    if (cov > 0) blendPixel(img, xx, yy, rgb, cov * alpha);
  }
}

export function circle(img, cx, cy, r, rgb, alpha = 1) {
  for (let yy = Math.floor(cy - r - 1); yy <= Math.ceil(cy + r + 1); yy++) for (let xx = Math.floor(cx - r - 1); xx <= Math.ceil(cx + r + 1); xx++) {
    const cov = clamp01(r + 0.5 - Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy));
    if (cov > 0) blendPixel(img, xx, yy, rgb, cov * alpha);
  }
}

// Line of the given width with round caps
export function line(img, x0, y0, x1, y1, width, rgb, alpha = 1) {
  const hw = width / 2;
  const vx = x1 - x0, vy = y1 - y0, len2 = vx * vx + vy * vy || 1;
  for (let yy = Math.floor(Math.min(y0, y1) - hw - 1); yy <= Math.ceil(Math.max(y0, y1) + hw + 1); yy++) {
    for (let xx = Math.floor(Math.min(x0, x1) - hw - 1); xx <= Math.ceil(Math.max(x0, x1) + hw + 1); xx++) {
      const px = xx + 0.5, py = yy + 0.5;
      const t = clamp01(((px - x0) * vx + (py - y0) * vy) / len2);
      const d = Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
      const cov = clamp01(hw + 0.5 - d);
      if (cov > 0) blendPixel(img, xx, yy, rgb, cov * alpha);
    }
  }
}

export function triangle(img, pts, rgb, alpha = 1) {
  const [a, b, c] = pts;
  const side = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const inside = (p) => {
    const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const minX = Math.floor(Math.min(a[0], b[0], c[0])), maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1])), maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let n = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside([x + (sx + 0.5) / 4, y + (sy + 0.5) / 4])) n++;
    if (n) blendPixel(img, x, y, rgb, (n / 16) * alpha);
  }
}

// Arrow with a filled head; halo = white outline so it reads over busy pages
export function arrow(img, x0, y0, x1, y1, width, rgb, { halo = false } = {}) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = 4 * width + 5;
  const hx = x1 - Math.cos(ang) * head * 0.7, hy = y1 - Math.sin(ang) * head * 0.7;
  const wing = (s, grow = 0) => [x1 - Math.cos(ang + s * 0.42) * (head + grow), y1 - Math.sin(ang + s * 0.42) * (head + grow)];
  if (halo) {
    line(img, x0, y0, hx, hy, width + 3, [255, 255, 255], 0.9);
    triangle(img, [[x1 + Math.cos(ang) * 2, y1 + Math.sin(ang) * 2], wing(1, 3), wing(-1, 3)], [255, 255, 255], 0.9);
  }
  line(img, x0, y0, hx, hy, width, rgb);
  triangle(img, [[x1, y1], wing(1), wing(-1)], rgb);
}

// Soft drop shadow around a rectangle (painted outside it only)
export function shadow(img, r, { blur = 8, alpha = 0.16, dy = 2, radius = 2 } = {}) {
  const x = r.x, y = r.y + dy;
  for (let yy = Math.floor(y - blur); yy < Math.ceil(y + r.h + blur); yy++) for (let xx = Math.floor(x - blur); xx < Math.ceil(x + r.w + blur); xx++) {
    const d = roundRectDist(xx + 0.5, yy + 0.5, x, y, r.w, r.h, radius);
    if (d <= 0) continue;
    const k = clamp01(1 - d / blur);
    if (k > 0) blendPixel(img, xx, yy, [17, 24, 39], alpha * k * k);
  }
}

// Box-filter downscale (thumbnails), flattened on white
export function scaleImage(img, w, h) {
  const out = createImage(w, h, [255, 255, 255, 255]);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4, a = img.data[o + 3] / 255;
        r += img.data[o] * a + 255 * (1 - a); g += img.data[o + 1] * a + 255 * (1 - a); b += img.data[o + 2] * a + 255 * (1 - a); n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return out;
}

// ---- text -------------------------------------------------------------------------------------

const SIZES = Object.keys(FONT_ATLAS).map(Number).sort((a, b) => a - b);
const decoded = new Map();
function face(size) {
  const s = SIZES.reduce((best, v) => (Math.abs(v - size) < Math.abs(best - size) ? v : best), SIZES[0]);
  if (!decoded.has(s)) {
    const f = FONT_ATLAS[s];
    decoded.set(s, { ...f, bytes: zlib.inflateSync(Buffer.from(f.data, 'base64')) });
  }
  return decoded.get(s);
}
const glyphOf = (f, ch) => f.glyphs[ch] || f.glyphs['?'];

export function textWidth(text, size) {
  const f = face(size);
  let w = 0;
  for (const ch of String(text)) w += glyphOf(f, ch)[5];
  return Math.round(w);
}

export function lineHeight(size) {
  const f = face(size);
  return f.ascent + f.descent;
}

// Draw text with its line box top-left at (x, y)
export function drawString(img, text, x, y, size, rgb, alpha = 1) {
  const f = face(size);
  let cx = x;
  for (const ch of String(text)) {
    const [off, w, h, gx, gy, adv] = glyphOf(f, ch);
    const ox = Math.round(cx + gx), oy = Math.round(y + gy);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cov = f.bytes[off + j * w + i];
      if (cov) blendPixel(img, ox + i, oy + j, rgb, (cov / 255) * alpha);
    }
    cx += adv;
  }
  return Math.round(cx - x);
}

// Text shortened with "…" to fit maxWidth
export function fitText(text, size, maxWidth) {
  let t = String(text);
  if (textWidth(t, size) <= maxWidth) return t;
  while (t.length > 1 && textWidth(t + '…', size) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}
