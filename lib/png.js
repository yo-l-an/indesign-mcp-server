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
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`Invalid PNG filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }

  const img = createImage(width, height);
  const out = img.data;
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    switch (colorType) {
      case 0: out[o] = out[o + 1] = out[o + 2] = pixels[j]; out[o + 3] = 255; break;
      case 2: out[o] = pixels[j]; out[o + 1] = pixels[j + 1]; out[o + 2] = pixels[j + 2]; out[o + 3] = 255; break;
      case 3: {
        const k = pixels[j];
        if (!palette || k * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
        out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
        out[o + 3] = transparency && k < transparency.length ? transparency[k] : 255;
        break;
      }
      case 4: out[o] = out[o + 1] = out[o + 2] = pixels[j]; out[o + 3] = pixels[j + 1]; break;
      case 6: out[o] = pixels[j]; out[o + 1] = pixels[j + 1]; out[o + 2] = pixels[j + 2]; out[o + 3] = pixels[j + 3]; break;
    }
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

// Encode as 8-bit RGB (the review images are opaque; flattening on white keeps files small)
export function encodePng(img) {
  const { width, height, data } = img;
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
