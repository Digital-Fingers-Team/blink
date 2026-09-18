// Build a north-up cutout of one SPHEREx exposure, reprojected onto a common tangent-plane
// grid so that every epoch of a target lines up pixel-for-pixel (required for blinking and
// difference imaging). Only the detector rows that intersect the cutout are fetched.
import { openSpherex, readRows, readWaveTable, waveAt, toS3Url } from './fits.js';
import { makeWcs, tangentPlane } from './wcs.js';

const fileCache = new Map(); // url -> opened file (headers + wave table), bounded
function remember(url, f) { if (fileCache.size > 400) fileCache.delete(fileCache.keys().next().value); fileCache.set(url, f); }

export async function openCached(ref) {
  const url = toS3Url(ref);
  if (fileCache.has(url)) return fileCache.get(url);
  const f = await openSpherex(url); f.wcs = makeWcs(f.hdr); remember(url, f); return f;
}

/**
 * @param ref   S3 key / IRSA access_url of the exposure
 * @param ra0,dec0  target centre (deg)
 * @param n     output size (pixels, square)
 * @param scale output pixel scale (arcsec/px); SPHEREx native is ~6.15
 * @returns {data: Float32Array(n*n) NaN outside detector, meta}
 */
export async function makeCutout(ref, ra0, dec0, n = 128, scale = 6.15) {
  const f = await openCached(ref);
  const tp = tangentPlane(ra0, dec0);
  const s = scale / 3600; // deg/px
  const half = (n - 1) / 2;
  // Output pixel (i, j): i -> east-left (xi decreases with i), j -> north-up (eta increases with j)
  const out = new Float32Array(n * n).fill(NaN);
  // Map all output pixel centres to source pixels. Also collect bounding rows.
  const sx = new Float32Array(n * n), sy = new Float32Array(n * n);
  let ymin = Infinity, ymax = -Infinity, inside = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const xi = -(i - half) * s, eta = (j - half) * s;
    const [ra, dec] = tp.toSky(xi, eta);
    const [x, y] = f.wcs.sky2pix(ra, dec);
    const k = j * n + i; sx[k] = x; sy[k] = y;
    if (x >= 0.5 && x <= f.nx + 0.5 && y >= 0.5 && y <= f.ny + 0.5) { inside++; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  }
  const [cx, cy] = f.wcs.sky2pix(ra0, dec0);
  const meta = {
    obsid: f.hdr.OBSID, detector: f.hdr.DETECTOR, mjd: f.hdr['MJD-AVG'] ?? f.hdr['MJD-OBS'], dateObs: f.hdr['DATE-OBS'],
    exptime: f.hdr.EXPTIME ?? null, bunit: f.hdr.BUNIT, url: f.url, n, scale, ra: ra0, dec: dec0,
    srcX: cx, srcY: cy, coverage: inside / (n * n), nativeScale: f.wcs.scale,
  };
  if (!inside) return { data: out, meta };
  const y0 = Math.max(0, Math.floor(ymin) - 2), y1 = Math.min(f.ny - 1, Math.ceil(ymax) + 1);
  const wavePromise = readWaveTable(f).catch(e => { meta.waveError = String(e.message || e); return null; });
  const rows = await readRows(f, y0, y1);
  const nx = f.nx;
  // Bilinear sampling in source pixel space (FITS 1-based: pixel centre at integer)
  for (let k = 0; k < n * n; k++) {
    const x = sx[k] - 1, y = sy[k] - 1 - rows.y0; // 0-based within slab
    if (!(x >= 0 && x <= nx - 1 && y >= 0 && y <= rows.y1 - rows.y0)) continue;
    const xf = Math.floor(x), yf = Math.floor(y), tx = x - xf, ty = y - yf;
    const x1 = Math.min(xf + 1, nx - 1), y1r = Math.min(yf + 1, rows.y1 - rows.y0);
    const d = rows.data;
    const v00 = d[yf * nx + xf], v10 = d[yf * nx + x1], v01 = d[y1r * nx + xf], v11 = d[y1r * nx + x1];
    // NaN-aware bilinear: fall back to nearest if any neighbour is NaN
    let v = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
    if (Number.isNaN(v)) v = d[Math.round(y) * nx + Math.round(x)];
    out[k] = v;
  }
  // Wavelength at the target pixel (and at the cutout corners, to show the gradient)
  const wave = await wavePromise;
  if (wave) {
    if (cx >= 1 && cx <= f.nx && cy >= 1 && cy <= f.ny) {
      const w = waveAt(wave, cx, cy); meta.wavelength = w.wavelength; meta.bandwidth = w.bandwidth;
    }
    const corner = (k) => (sx[k] >= 1 && sx[k] <= f.nx && sy[k] >= 1 && sy[k] <= f.ny) ? waveAt(wave, sx[k], sy[k]).wavelength : null;
    meta.waveCorners = [corner(0), corner(n - 1), corner((n - 1) * n), corner(n * n - 1)];
  }
  return { data: out, meta };
}

// Serialise: [uint32 jsonLen][json utf8][float32le data]
export function packCutout({ data, meta }) {
  const json = Buffer.from(JSON.stringify(meta), 'utf8');
  const head = Buffer.alloc(4); head.writeUInt32LE(json.length, 0);
  const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.concat([head, json, body]);
}
export function unpackCutout(buf) {
  const len = buf.readUInt32LE(0); const meta = JSON.parse(buf.toString('utf8', 4, 4 + len));
  const body = buf.subarray(4 + len); const data = new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  return { data, meta };
}
