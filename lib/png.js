// Minimal PNG decoder / encoder (no dependency), enough for the PNGs InDesign exports and the
// review images this server draws. Images are handled as { width, height, data } with data an
// RGBA Uint8Array (4 bytes per pixel, rows top to bottom).
//
// Decoding supports 8-bit greyscale, RGB, palette, grey+alpha and RGBA, non-interlaced
// (InDesign's PNG export never interlaces). Anything else throws a clear error.

import zlib from 'zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function createImage(width, height, rgba = [255, 255, 255, 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
  let pos = 8;
  let width, height, bitDepth, colorType, interlace;
  let palette = null, transparency = null;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const chunk = buffer.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'tRNS') {
      transparency = chunk;
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw new Error('PNG without IHDR');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth} (only 8-bit)`);
  if (interlace) throw new Error('Interlaced PNGs are not supported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is truncated');
  const pixels = new Uint8Array(stride * height);
  const zero = new Uint8Array(stride);
  // One loop per filter type: the filter is per row, so the per-byte switch is hoisted out
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = y ? pixels : zero;
    const p0 = y ? cur - stride : 0;
    switch (filter) {
      case 0:
        pixels.set(raw.subarray(src, src + stride), cur);
        break;
      case 1:
        for (let x = 0; x < channels; x++) pixels[cur + x] = raw[src + x];
        for (let x = channels; x < stride; x++) pixels[cur + x] = (raw[src + x] + pixels[cur + x - channels]) & 0xff;
        break;
      case 2:
        for (let x = 0; x < stride; x++) pixels[cur + x] = (raw[src + x] + prev[p0 + x]) & 0xff;
        break;
      case 3:
        for (let x = 0; x < channels; x++) pixels[cur + x] = (raw[src + x] + (prev[p0 + x] >> 1)) & 0xff;
        for (let x = channels; x < stride; x++) pixels[cur + x] = (raw[src + x] + ((pixels[cur + x - channels] + prev[p0 + x]) >> 1)) & 0xff;
        break;
      case 4:
        for (let x = 0; x < channels; x++) pixels[cur + x] = (raw[src + x] + prev[p0 + x]) & 0xff;   // a = c = 0: Paeth picks b
        for (let x = channels; x < stride; x++) {
          const a = pixels[cur + x - channels], b = prev[p0 + x], c = prev[p0 + x - channels];
          const p = a + b - c;
          const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
          pixels[cur + x] = (raw[src + x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        break;
      default: throw new Error(`Invalid PNG filter ${filter}`);
    }
  }

  const n = width * height;
  const out = new Uint8Array(n * 4);
  const img = { width, height, data: out };
  switch (colorType) {
    case 6: out.set(pixels); break;
    case 2: for (let i = 0, j = 0, o = 0; i < n; i++, j += 3, o += 4) { out[o] = pixels[j]; out[o + 1] = pixels[j + 1]; out[o + 2] = pixels[j + 2]; out[o + 3] = 255; } break;
    case 0: for (let i = 0, o = 0; i < n; i++, o += 4) { out[o] = out[o + 1] = out[o + 2] = pixels[i]; out[o + 3] = 255; } break;
    case 4: for (let i = 0, j = 0, o = 0; i < n; i++, j += 2, o += 4) { out[o] = out[o + 1] = out[o + 2] = pixels[j]; out[o + 3] = pixels[j + 1]; } break;
    case 3:
      for (let i = 0, o = 0; i < n; i++, o += 4) {
        const k = pixels[i];
        if (!palette || k * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
        out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
        out[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
      }
      break;
  }
  return img;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Encode as 8-bit RGBA, or RGB flattened on white with { alpha: false }
export function encodePng(img, { alpha = true } = {}) {
  const { width, height, data } = img;
  if (alpha) {
    const stride4 = width * 4;
    const raw4 = Buffer.alloc((stride4 + 1) * height);
    for (let y = 0; y < height; y++) {
      raw4[y * (stride4 + 1)] = 0;
      Buffer.from(data.buffer, data.byteOffset + y * stride4, stride4).copy(raw4, y * (stride4 + 1) + 1);
    }
    const hdr = Buffer.alloc(13);
    hdr.writeUInt32BE(width, 0);
    hdr.writeUInt32BE(height, 4);
    hdr[8] = 8; hdr[9] = 6;
    return Buffer.concat([SIGNATURE, chunk('IHDR', hdr), chunk('IDAT', zlib.deflateSync(raw4, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  }
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = y * (stride + 1) + 1 + x * 3;
      const a = data[s + 3] / 255;
      raw[d] = Math.round(data[s] * a + 255 * (1 - a));
      raw[d + 1] = Math.round(data[s + 1] * a + 255 * (1 - a));
      raw[d + 2] = Math.round(data[s + 2] * a + 255 * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
