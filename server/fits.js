// Minimal FITS reader for SPHEREx Level-2 spectral image MEFs, fetched by HTTP Range
// from NASA's open-data S3 bucket. We never download a whole 71 MB file: we read the
// headers, the WCS-WAVE lookup table at the tail, and only the rows we need.

const S3_BASE = 'https://nasa-irsa-spherex.s3.amazonaws.com/';
const IRSA_IBE = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/';
const BLOCK = 2880;

// Accept an IRSA access_url, an S3 key, or an S3 URL and return the S3 URL.
export function toS3Url(ref) {
  if (ref.startsWith(S3_BASE)) return ref;
  if (ref.startsWith(IRSA_IBE)) return S3_BASE + ref.slice(IRSA_IBE.length);
  if (ref.startsWith('qr2/') || ref.startsWith('qr/')) return S3_BASE + ref;
  if (ref.startsWith('s3://nasa-irsa-spherex/')) return S3_BASE + ref.slice('s3://nasa-irsa-spherex/'.length);
  throw new Error('unrecognised SPHEREx file reference: ' + ref);
}

// start may be negative for a suffix range (last -start bytes). The returned Buffer carries
// .total (file size from Content-Range) and .start (absolute offset of byte 0).
export async function fetchRange(url, start, end, tries = 3) {
  let lastErr;
  const range = start < 0 ? `bytes=${start}` : `bytes=${start}-${end}`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Range: range } });
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status} for ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const cr = /bytes (\d+)-(\d+)\/(\d+)/.exec(r.headers.get('content-range') || '');
      if (cr) { buf.total = +cr[3]; buf.start = +cr[1]; }
      return buf;
    } catch (e) { lastErr = e; await new Promise(res => setTimeout(res, 300 * (i + 1))); }
  }
  throw lastErr;
}

function parseCards(buf, off) {
  const cards = {}; let p = off;
  while (p + 80 <= buf.length) {
    const c = buf.toString('latin1', p, p + 80); p += 80;
    if (c.trim() === 'END') return { cards, headerLen: Math.ceil((p - off) / BLOCK) * BLOCK };
    const key = c.slice(0, 8).trim();
    if (!key || key === 'COMMENT' || key === 'HISTORY' || c[8] !== '=') continue;
    let v = c.slice(10); const q = v.indexOf("'");
    if (q === 0) { const e = v.indexOf("'", 1); v = v.slice(1, e).trim(); }
    else { v = v.split('/')[0].trim(); const n = Number(v); v = (v === 'T') ? true : (v === 'F') ? false : (Number.isFinite(n) ? n : v); }
    cards[key] = v;
  }
  return null; // END not found in buffer
}

function dataLength(h) {
  const naxis = h.NAXIS || 0; if (!naxis) return 0;
  let n = 1; for (let i = 1; i <= naxis; i++) n *= h['NAXIS' + i];
  return n * Math.abs(h.BITPIX) / 8 + (h.PCOUNT || 0);
}

// Simpler and robust: sequential walk with per-HDU header fetch (SPHEREx files have 7 HDUs)
export async function readLayoutSeq(url) {
  const hdus = []; let off = 0;
  for (let n = 0; n < 12; n++) {
    let want = 8 * BLOCK;
    let buf = await fetchRange(url, off, off + want - 1);
    let res = parseCards(buf, 0);
    if (!res) { buf = await fetchRange(url, off, off + 200 * BLOCK - 1); res = parseCards(buf, 0); if (!res) throw new Error('header too long @' + off); }
    const dl = dataLength(res.cards);
    hdus.push({ name: res.cards.EXTNAME || (n === 0 ? 'PRIMARY' : 'HDU' + n), hdr: res.cards, dataStart: off + res.headerLen, dataLen: dl, hdrStart: off });
    off = off + res.headerLen + Math.ceil(dl / BLOCK) * BLOCK;
    if (res.cards.EXTNAME === 'WCS-WAVE') break;
    if (buf.length < want) break; // EOF
  }
  return hdus;
}

// SPHEREx files are all laid out identically (2040x2040 float32 IMAGE first). We fetch the
// IMAGE header in one go, and the WCS-WAVE table by walking headers only when needed.
export async function openSpherex(url) {
  const head = await fetchRange(url, 0, 12 * BLOCK - 1);
  const prim = parseCards(head, 0); if (!prim) throw new Error('bad primary header');
  const img = parseCards(head, prim.headerLen); if (!img) throw new Error('IMAGE header not in first 12 blocks');
  const h = img.cards;
  const imageStart = prim.headerLen + img.headerLen;
  const imageLen = dataLength(h);
  if (h.BITPIX !== -32 || h.NAXIS !== 2) throw new Error('unexpected IMAGE HDU format');
  return { url, hdr: h, imageStart, imageLen, nx: h.NAXIS1, ny: h.NAXIS2, total: head.total };
}

// Read rows [y0, y1] (0-based, inclusive) of the IMAGE HDU as Float32Array (row-major, nx wide)
export async function readRows(file, y0, y1) {
  y0 = Math.max(0, y0); y1 = Math.min(file.ny - 1, y1);
  if (y1 < y0) return { y0, y1, data: new Float32Array(0) };
  const rowBytes = file.nx * 4;
  const start = file.imageStart + y0 * rowBytes, end = file.imageStart + (y1 + 1) * rowBytes - 1;
  const buf = await fetchRange(file.url, start, end);
  const n = (y1 - y0 + 1) * file.nx; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatBE(i * 4);
  return { y0, y1, data: out };
}

// Same for the FLAGS HDU (int32) which follows IMAGE; layout: IMAGE data, then FLAGS header (5 blocks)
export async function readFlagRows(file, y0, y1) {
  if (!file.flagsStart) {
    const off = file.imageStart + Math.ceil(file.imageLen / BLOCK) * BLOCK;
    const buf = await fetchRange(file.url, off, off + 8 * BLOCK - 1);
    const res = parseCards(buf, 0); if (!res || res.cards.EXTNAME !== 'FLAGS') return null;
    file.flagsStart = off + res.headerLen;
  }
  y0 = Math.max(0, y0); y1 = Math.min(file.ny - 1, y1);
  const rowBytes = file.nx * 4;
  const buf = await fetchRange(file.url, file.flagsStart + y0 * rowBytes, file.flagsStart + (y1 + 1) * rowBytes - 1);
  const n = (y1 - y0 + 1) * file.nx; const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt32BE(i * 4);
  return { y0, y1, data: out };
}

// WCS-WAVE: BINTABLE with X (9 int32 control pts), Y (14 int32), VALUES (2,9,14) float32.
// Bilinear lookup: wavelength [µm] and bandwidth for any detector pixel.
export async function readWaveTable(file) {
  if (file.wave) return file.wave;
  let hdr, buf;
  // Fast path: WCS-WAVE is the final HDU (1 header block + 1 data block) -> one suffix-range request
  const tail = await fetchRange(file.url, -2 * BLOCK, 0);
  const t = parseCards(tail, 0);
  if (t && t.cards.EXTNAME === 'WCS-WAVE' && t.cards.XTENSION === 'BINTABLE') {
    hdr = t.cards; buf = tail.subarray(t.headerLen, t.headerLen + dataLength(hdr));
  } else { // Slow path: walk the HDU chain
    const hdus = await readLayoutSeq(file.url);
    const w = hdus.find(h => h.name === 'WCS-WAVE'); if (!w) throw new Error('no WCS-WAVE HDU');
    hdr = w.hdr; buf = await fetchRange(file.url, w.dataStart, w.dataStart + w.dataLen - 1);
  }
  const nx = +hdr.TFORM1.replace(/\D/g, ''), ny = +hdr.TFORM2.replace(/\D/g, '');
  const X = [], Y = []; let p = 0;
  for (let i = 0; i < nx; i++, p += 4) X.push(buf.readInt32BE(p));
  for (let i = 0; i < ny; i++, p += 4) Y.push(buf.readInt32BE(p));
  const V = new Float32Array(2 * nx * ny);
  for (let i = 0; i < V.length; i++, p += 4) V[i] = buf.readFloatBE(p);
  file.wave = { X, Y, V, nx, ny, unit: hdr.TUNIT3 || 'um' };
  return file.wave;
}

export function waveAt(wave, x, y) { // x,y 1-based FITS pixel coords
  const { X, Y, V, nx } = wave;
  const br = (arr, v) => { let i = 0; while (i < arr.length - 2 && v > arr[i + 1]) i++; return i; };
  const ix = br(X, x), iy = br(Y, y);
  const tx = Math.min(1, Math.max(0, (x - X[ix]) / (X[ix + 1] - X[ix] || 1)));
  const ty = Math.min(1, Math.max(0, (y - Y[iy]) / (Y[iy + 1] - Y[iy] || 1)));
  const g = (k, i, j) => V[k + 2 * (i + nx * j)];
  const lerp = (k) => {
    const a = g(k, ix, iy) * (1 - tx) + g(k, ix + 1, iy) * tx;
    const b = g(k, ix, iy + 1) * (1 - tx) + g(k, ix + 1, iy + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
  return { wavelength: lerp(0), bandwidth: lerp(1) };
}
