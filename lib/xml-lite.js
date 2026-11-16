// Minimal ZIP reader and XML parser (no dependency), enough for Office Open XML files.

import zlib from 'zlib';

// ---- ZIP ----------------------------------------------------------------------------------------

// Map of entry name -> () => Buffer (inflated on demand)
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file (no central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported ZIP compression ${method} for ${name}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---- XML ----------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
});

// Element: { n: name, a: { attr: value }, c: [children: element | string] }
export function parseXml(xml) {
  const root = { n: '#root', a: {}, c: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.c.push(m[1]);
    else if (m[3]) {
      if (m[2] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const a = {};
      for (const am of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[am[1]] = decodeEntities(am[2] ?? am[3]);
      const el = { n: m[3], a, c: [] };
      top.c.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.c.push(decodeEntities(m[6]));
  }
  return root;
}

export const kids = (el, name) => (el?.c || []).filter((c) => typeof c !== 'string' && (!name || c.n === name));
export const kid = (el, name) => (el?.c || []).find((c) => typeof c !== 'string' && c.n === name) || null;

// Depth-first search for elements by name
export function findAll(el, name, out = []) {
  for (const c of el?.c || []) {
    if (typeof c === 'string') continue;
    if (c.n === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
