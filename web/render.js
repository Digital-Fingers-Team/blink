// Image maths for the Time Machine: robust statistics, stretches, colour maps, stacking, differencing.

export function finiteSample(data, max = 20000) {
  const step = Math.max(1, Math.floor(data.length / max)); const out = [];
  for (let i = 0; i < data.length; i += step) { const v = data[i]; if (Number.isFinite(v)) out.push(v); }
  return out.sort((a, b) => a - b);
}
export function percentile(sorted, p) { if (!sorted.length) return NaN; const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1)))); return sorted[i]; }
export function robustStats(data) {
  const s = finiteSample(data); if (!s.length) return { median: 0, sigma: 1, lo: 0, hi: 1, n: 0 };
  const median = percentile(s, 0.5);
  const dev = s.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const sigma = 1.4826 * percentile(dev, 0.5) || (percentile(s, 0.84) - percentile(s, 0.16)) / 2 || 1;
  return { median, sigma, lo: percentile(s, 0.005), hi: percentile(s, 0.995), n: s.length, p99: percentile(s, 0.99) };
}

// Map a value range to [0,1] using a linear / asinh / log stretch. `lo`/`hi` are the display cuts.
export function makeStretch(mode, lo, hi) {
  const span = (hi - lo) || 1;
  if (mode === 'linear') return v => (v - lo) / span;
  if (mode === 'log') return v => Math.log10(1 + 100 * Math.max(0, (v - lo) / span)) / Math.log10(101);
  const k = 8; const norm = Math.asinh(k); // asinh
  return v => Math.asinh(k * Math.max(0, (v - lo) / span)) / norm;
}

// Colour maps as 256-entry RGB LUTs
function lut(stops) { // stops: [[t, r, g, b], ...]
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    const u = (t - a[0]) / ((b[0] - a[0]) || 1);
    out[i * 3] = a[1] + (b[1] - a[1]) * u; out[i * 3 + 1] = a[2] + (b[2] - a[2]) * u; out[i * 3 + 2] = a[3] + (b[3] - a[3]) * u;
  }
  return out;
}
export const CMAPS = {
  gray: lut([[0, 0, 0, 0], [1, 255, 255, 255]]),
  ember: lut([[0, 0, 0, 4], [0.25, 60, 12, 90], [0.5, 190, 50, 60], [0.75, 250, 150, 30], [1, 255, 250, 200]]),
  ice: lut([[0, 2, 4, 20], [0.4, 20, 60, 140], [0.7, 90, 170, 230], [1, 240, 250, 255]]),
  diverging: lut([[0, 30, 90, 200], [0.5, 245, 245, 245], [1, 200, 40, 30]]),
};

// Render a Float32 frame into an ImageData. `nan` pixels get a dim checker so gaps are obvious.
export function toImageData(data, n, { lo, hi, mode = 'asinh', cmap = 'gray', diverging = false }) {
  const img = new ImageData(n, n); const px = img.data; const f = makeStretch(mode, lo, hi); const L = CMAPS[cmap] || CMAPS.gray;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = data[j * n + i]; const o = ((n - 1 - j) * n + i) * 4; // flip: row 0 (south) drawn at bottom
    if (!Number.isFinite(v)) { const c = ((i >> 3) + (j >> 3)) & 1 ? 26 : 20; px[o] = c; px[o + 1] = c; px[o + 2] = c + 6; px[o + 3] = 255; continue; }
    let t = diverging ? 0.5 + 0.5 * Math.max(-1, Math.min(1, (v - 0.5 * (lo + hi)) / (0.5 * (hi - lo) || 1))) : Math.max(0, Math.min(1, f(v)));
    const k = Math.round(t * 255) * 3; px[o] = L[k]; px[o + 1] = L[k + 1]; px[o + 2] = L[k + 2]; px[o + 3] = 255;
  }
  return img;
}

export function subtractBackground(data) { const { median } = robustStats(data); const out = new Float32Array(data.length); for (let i = 0; i < data.length; i++) out[i] = data[i] - median; return out; }

// Per-pixel NaN-aware median of many frames -> the "static sky" template
export function medianStack(frames) {
  if (!frames.length) return null; const n = frames[0].length; const out = new Float32Array(n); const buf = new Float32Array(frames.length);
  for (let i = 0; i < n; i++) {
    let m = 0; for (const f of frames) { const v = f[i]; if (Number.isFinite(v)) buf[m++] = v; }
    if (!m) { out[i] = NaN; continue; }
    const s = buf.subarray(0, m).sort(); out[i] = m & 1 ? s[m >> 1] : 0.5 * (s[m / 2 - 1] + s[m / 2]);
  }
  return out;
}

export function difference(a, b) { const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i]; return out; }

// frame - k*template, with k the robust median ratio over bright template pixels. Because SPHEREx sees
// each spot at a different wavelength on every exposure, star fluxes differ frame to frame; a single
// scale factor removes most of that before we look for movers.
export function matchedDifference(frame, template) {
  const st = robustStats(template); const thr = st.median + 8 * st.sigma; const ratios = [];
  for (let i = 0; i < frame.length; i += 1) { const t = template[i], v = frame[i]; if (t > thr && Number.isFinite(v) && v > 0) ratios.push(v / t); }
  ratios.sort((x, y) => x - y); const k = ratios.length >= 10 ? ratios[ratios.length >> 1] : 1;
  const out = new Float32Array(frame.length); for (let i = 0; i < frame.length; i++) out[i] = frame[i] - k * template[i];
  return { diff: out, scale: k, nRef: ratios.length };
}

// Aperture photometry at the frame centre: sum(r<=rAp) - median(annulus) * area. Returns MJy/sr summed and Jy.
export function aperturePhotometry(data, n, scaleArcsec, rAp = 2.5, rIn = 5, rOut = 9) {
  const c = (n - 1) / 2; let sum = 0, area = 0; const ann = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const r = Math.hypot(i - c, j - c); const v = data[j * n + i]; if (!Number.isFinite(v)) continue;
    if (r <= rAp) { sum += v; area++; } else if (r >= rIn && r <= rOut) ann.push(v);
  }
  if (!area) return null;
  ann.sort((a, b) => a - b); const bg = ann.length ? ann[ann.length >> 1] : 0;
  const net = sum - bg * area; const srPerPix = (scaleArcsec / 206264.806) ** 2;
  return { net, bg, area, jy: net * 1e6 * srPerPix, mjy: net * 1e9 * srPerPix };
}

// Simple peak finder on a difference image: pixels > k*sigma above local background, grouped by 8-connectivity
export function findPeaks(diff, n, k = 5, minPix = 2, template = null, maxPix = 150) {
  const { sigma } = robustStats(diff); const thr = k * sigma; const seen = new Uint8Array(n * n); const peaks = [];
  const tst = template ? robustStats(template) : null; const tthr = tst ? tst.median + 3 * tst.sigma : Infinity;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const idx = j * n + i; if (seen[idx] || !(diff[idx] > thr)) continue;
    const stack = [idx]; let cnt = 0, sx = 0, sy = 0, sw = 0, mx = -Infinity, mi = idx; seen[idx] = 1;
    while (stack.length) {
      const p = stack.pop(); const v = diff[p]; cnt++; const px = p % n, py = (p / n) | 0; sx += px * v; sy += py * v; sw += v; if (v > mx) { mx = v; mi = p; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = p + dy * n + dx; const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= n || qy >= n || seen[q] || !(diff[q] > thr)) continue; seen[q] = 1; stack.push(q); }
    }
    // bright static source underneath (3x3 max of the template): a residual, not a mover
    let tmax = -Infinity; if (template) { const px = mi % n, py = (mi / n) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx >= 0 && qy >= 0 && qx < n && qy < n) { const t = template[qy * n + qx]; if (t > tmax) tmax = t; } } }
    const onStar = template && tmax > tthr && tmax > 0.25 * mx;
    // very large blobs are background gradients (zodiacal light differs per epoch), not point-like movers
    if (cnt >= minPix && cnt <= maxPix && !onStar) peaks.push({ x: sx / sw, y: sy / sw, peak: mx, snr: mx / sigma, npix: cnt });
  }
  return peaks.sort((a, b) => b.snr - a.snr).slice(0, 12);
}
