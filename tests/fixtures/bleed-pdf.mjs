// A print PDF with real boxes, for the placing tests: each page has a TrimBox (the artboard),
// a larger BleedBox (bleed per side, may differ) and MediaBox = CropBox = BleedBox, like a PDF
// exported "with bleed". The bleed area is cyan, the artboard magenta, and a black 2 mm band
// runs along the artboard's top edge, so a render shows exactly where the artboard ends.
//
//   writeBleedPdf(file, [{ width: 100, height: 70, bleed: { top: 3, left: 3, bottom: 3, right: 5 } }, ...])
//   (mm)

import fs from 'fs';

const PT = 72 / 25.4;
const f = (n) => (Math.round(n * 1000) / 1000).toString();

export function bleedPdf(pages) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null), tree = add(null);
  const kids = [];
  for (const p of pages) {
    const b = { top: 0, left: 0, bottom: 0, right: 0, ...p.bleed };
    const W = (p.width + b.left + b.right) * PT, H = (p.height + b.top + b.bottom) * PT;
    const tx = b.left * PT, ty = b.bottom * PT, tw = p.width * PT, th = p.height * PT;
    const content = [
      `1 0 0 0 k 0 0 ${f(W)} ${f(H)} re f`,                         // bleed area: cyan
      `0 1 0 0 k ${f(tx)} ${f(ty)} ${f(tw)} ${f(th)} re f`,           // artboard: magenta
      `0 0 0 1 k ${f(tx)} ${f(ty + th - 2 * PT)} ${f(tw)} ${f(2 * PT)} re f`,   // top band: black
    ].join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const box = `[0 0 ${f(W)} ${f(H)}]`;
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox ${box} /CropBox ${box} /BleedBox ${box} /TrimBox [${f(tx)} ${f(ty)} ${f(tx + tw)} ${f(ty + th)}] /ArtBox [${f(tx)} ${f(ty)} ${f(tx + tw)} ${f(ty + th)}] /Contents ${stream} 0 R /Resources << >> >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.6\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function writeBleedPdf(file, pages) {
  fs.writeFileSync(file, bleedPdf(pages));
  return file;
}
