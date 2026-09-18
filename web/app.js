// BLINK — SPHEREx Time Machine (front-end)
import { robustStats, toImageData, subtractBackground, medianStack, matchedDifference, aperturePhotometry, findPeaks, flagPersistent, percentile, finiteSample } from './render.js';

const $ = (s) => document.querySelector(s);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const BAND_COLOR = { D1: '#7c9cff', D2: '#4fd1ff', D3: '#6ee7a8', D4: '#ffe066', D5: '#ff9f43', D6: '#ff6b6b' };
const MAX_FRAMES = 90;

const MISSIONS = {
  '3iatlas': { title: 'Interstellar comet 3I/ATLAS', sub: 'Comet-locked: the comet stays centred while the Galaxy streams past. Aug & Dec 2025.', file: 'missions/3iatlas.json', band: 'D3', n: 96, scale: 6.15, lock: 'comet', track: '3I' },
  planet9: { title: 'Planet Nine candidate zone', sub: 'Phan et al. 2025 paired an IRAS (1983) and an AKARI (2006) source moving ~2′/yr. Extrapolated to 2025 it should be near here. Blink it yourself.', ra: 34.70, dec: -49.81, n: 200, scale: 12, band: 'D2' },
  vesta: { title: 'Asteroid 4 Vesta', sub: 'A bright main-belt asteroid crossing a SPHEREx field. The cyan diamond is JPL\'s predicted position for each exposure.', file: 'missions/vesta.json', track: 'Vesta', n: 160, scale: 9 },
  mira: { title: 'Mira (ο Ceti)', sub: 'The prototype pulsating variable: a 332-day cycle, changing brightness between SPHEREx visits.', ra: 34.8367, dec: -2.9776, band: 'D1', n: 128, scale: 6.15 },
  nep: { title: 'North Ecliptic Pole deep field', sub: 'SPHEREx revisits the ecliptic poles on almost every orbit — dozens of epochs to blink.', ra: 270.0, dec: 66.56, collection: 'deep', n: 128, scale: 6.15 },
};

const S = {
  target: null, epochs: null, band: 'auto', frames: [], idx: 0, playing: false, timer: 0, mode: 'blink',
  stretch: 'asinh', cmap: 'gray', n: 128, scale: 6.15, cuts: null, template: null, track: null, waveTol: Infinity,
  known: new Map(), peaks: new Map(), loadToken: 0, mission: null, hoverIdx: -1, aladin: null, marker: null, fpOverlay: null,
};

// ---------- utilities ----------
const mjdToDate = (m) => new Date((m - 40587) * 86400000);
const fmtDate = (m) => mjdToDate(m).toISOString().slice(0, 16).replace('T', ' ') + ' UT';
const fmtDeg = (v, n = 4) => v.toFixed(n);
function toast(msg, ms = 2400) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function tangent(ra0, dec0) {
  const a0 = ra0 * D2R, d0 = dec0 * D2R, sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  return {
    fromSky(ra, dec) { const a = ra * D2R, d = dec * D2R, da = a - a0, sd = Math.sin(d), cd = Math.cos(d), cda = Math.cos(da); const den = sd * sd0 + cd * cd0 * cda; return [(cd * Math.sin(da) / den) * R2D, ((sd * cd0 - cd * sd0 * cda) / den) * R2D]; },
    toSky(xi, eta) { const x = xi * D2R, y = eta * D2R, den = cd0 - y * sd0; const ra = a0 + Math.atan2(x, den), dec = Math.atan2(sd0 + y * cd0, Math.sqrt(x * x + den * den)); return [(((ra * R2D) % 360) + 360) % 360, dec * R2D]; },
  };
}
// frame pixel (i east-left, j north-up) <-> sky, for the frame's own centre
function skyToPix(frame, ra, dec) { const [xi, eta] = tangent(frame.meta.ra, frame.meta.dec).fromSky(ra, dec); const s = frame.meta.scale / 3600, half = (frame.meta.n - 1) / 2; return [half - xi / s, half + eta / s]; }
function pixToSky(frame, i, j) { const s = frame.meta.scale / 3600, half = (frame.meta.n - 1) / 2; return tangent(frame.meta.ra, frame.meta.dec).toSky(-(i - half) * s, (j - half) * s); }
function angSep(ra1, dec1, ra2, dec2) { const s = Math.sin((dec2 - dec1) * D2R / 2) ** 2 + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin((ra2 - ra1) * D2R / 2) ** 2; return 2 * Math.asin(Math.sqrt(s)) * R2D; }

async function api(path, params) { const u = new URL(path, location.href); for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) u.searchParams.set(k, v); const r = await fetch(u); if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch {} throw new Error(m); } return r; }
async function fetchCutout(key, ra, dec, n, scale) {
  const r = await api('api/cutout', { key, ra, dec, n, scale }); const buf = await r.arrayBuffer(); const dv = new DataView(buf);
  const len = dv.getUint32(0, true); const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  const data = new Float32Array(buf.slice(4 + len)); return { meta, data };
}
async function mapLimit(items, limit, fn) { let i = 0; const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch (e) { console.warn('item failed', e); } } }); await Promise.all(workers); }

// ---------- sky map (Aladin Lite) ----------
function initSky() {
  A.init.then(() => {
    const aladin = A.aladin('#aladin', { survey: 'CDS/P/SPHEREx/QR2/color', fov: 4, target: '156.09 -41.65', cooFrame: 'ICRSd', showReticle: true, showCooGrid: false, showSimbadPointerControl: false, showFullscreenControl: true, showLayersControl: false, showGotoControl: false, showShareControl: false, showFrame: false, showProjectionControl: false, showSettingsControl: false, showCooGridControl: false, showZoomControl: true, showContextMenu: false, realFullscreen: false });
    S.aladin = aladin;
    S.marker = A.catalog({ name: 'Target', sourceSize: 22, color: '#ffb547', shape: 'cross' }); aladin.addCatalog(S.marker);
    S.fpOverlay = A.graphicOverlay({ color: 'rgba(96,200,255,.6)', lineWidth: 1.5 }); aladin.addOverlay(S.fpOverlay);
    aladin.on('click', (o) => { if (!o || o.isDragging || !Number.isFinite(o.ra)) return; setTarget({ ra: o.ra, dec: o.dec, name: null }); });
    $('#surveySel').addEventListener('change', (e) => aladin.setBaseImageLayer(e.target.value));
    const h = parseHash(); if (h) applyHash(h); else runMission('3iatlas');
  });
}
function syncSky(ra, dec, fov) {
  if (!S.aladin) return; S.aladin.gotoRaDec(ra, dec); if (fov) S.aladin.setFoV(fov);
  S.marker.removeAll(); S.marker.addSources([A.source(ra, dec, { name: S.target?.name || 'target' })]);
}
function showFootprint(frame) { // outline of the exposure currently displayed
  if (!S.fpOverlay) return; S.fpOverlay.removeAll(); if (!frame || !S.epochs) return;
  const e = S.epochs.epochs.find(x => x.obsid === frame.meta.obsid && x.band === frame.meta.band); if (!e || !e.region) return;
  const m = /POLYGON ICRS ([\d\.\-\s]+)/.exec(e.region); if (!m) return; const v = m[1].trim().split(/\s+/).map(Number); const pts = [];
  for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]); S.fpOverlay.add(A.polygon(pts));
}

// ---------- target & epochs ----------
async function setTarget(t, opts = {}) {
  stop(); S.loadToken++; S.mission = opts.mission || null;
  S.target = t; S.frames = []; S.idx = 0; S.template = null; S.known.clear(); S.peaks.clear(); S.track = null; S.epochs = null;
  document.querySelectorAll('.missions button').forEach(b => b.classList.toggle('on', b.dataset.mission === S.mission));
  $('#tmTitle').textContent = opts.title || t.name || `${fmtDeg(t.ra)}, ${fmtDeg(t.dec)}`;
  $('#tmSub').textContent = opts.sub || `RA ${fmtDeg(t.ra, 5)}°  Dec ${fmtDeg(t.dec, 5)}°`;
  $('#viewerEmpty').hidden = true; status('Searching IRSA for every SPHEREx exposure of this spot…');
  render(); drawTimeline(); drawSpectrum(); listDetections();
  syncSky(t.ra, t.dec, opts.fov);
  writeHash();
  try {
    if (opts.exposures) { S.epochs = { epochs: opts.exposures, count: opts.exposures.length }; }
    else { const r = await api('api/epochs', { ra: t.ra, dec: t.dec, collection: opts.collection }); S.epochs = await r.json(); }
  } catch (e) { status('IRSA search failed: ' + e.message, true); return; }
  if (!S.epochs.count) { status('No SPHEREx exposures cover this position yet (or IRSA is busy).', true); $('#viewerEmpty').hidden = false; return; }
  buildBandSeg(S.epochs.epochs, opts.band);
  await loadFrames();
}
function buildBandSeg(epochs, preferred) {
  const counts = {}; for (const e of epochs) counts[e.band] = (counts[e.band] || 0) + 1;
  const bands = Object.keys(counts).sort();
  const seg = $('#bandSeg'); seg.innerHTML = '';
  const best = preferred && counts[preferred] ? preferred : bands.reduce((a, b) => counts[b] > (counts[a] || 0) ? b : a, bands[0]);
  S.band = best;
  for (const b of bands) { const btn = document.createElement('button'); btn.dataset.band = b; btn.textContent = b; btn.title = `${counts[b]} exposures`; btn.style.color = BAND_COLOR[b]; btn.classList.toggle('on', b === best); btn.onclick = () => { S.band = b; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn)); loadFrames(); }; seg.appendChild(btn); }
}
function pickExposures() {
  let list = S.epochs.epochs.filter(e => e.band === S.band && e.key);
  if (list.length > MAX_FRAMES) { const step = list.length / MAX_FRAMES; const out = []; for (let i = 0; i < MAX_FRAMES; i++) out.push(list[Math.floor(i * step)]); list = out; }
  return list;
}
async function loadFrames() {
  stop(); const token = ++S.loadToken; S.frames = []; S.idx = 0; S.template = null; S.peaks.clear(); S.cuts = null;
  const list = pickExposures(); if (!list.length) { status('No frames in this band.', true); return; }
  status(`Loading ${list.length} exposures…`); $('#progressBar').style.width = '0%';
  let done = 0; const t0 = performance.now();
  await mapLimit(list, 6, async (e) => {
    if (token !== S.loadToken) return;
    const ra = e.cra ?? S.target.ra, dec = e.cdec ?? S.target.dec; // comet-locked missions carry per-frame centres (cra/cdec)
    const c = await fetchCutout(e.key, ra, dec, S.n, S.scale);
    if (token !== S.loadToken) return;
    if (c.meta.coverage < 0.15) { done++; return; }
    const f = { meta: { ...c.meta, band: e.band, key: e.key, mjd: e.mjd ?? c.meta.mjd, exptime: e.exptime }, raw: c.data, bg: subtractBackground(c.data) };
    f.phot = aperturePhotometry(f.bg, f.meta.n, f.meta.scale);
    S.frames.push(f); S.frames.sort((a, b) => a.meta.mjd - b.meta.mjd);
    done++; $('#progressBar').style.width = `${(100 * done / list.length).toFixed(0)}%`;
    if (S.frames.length === 1 || done % 4 === 0) { computeCuts(); render(); drawTimeline(); }
    status(`Loaded ${done}/${list.length}`);
  });
  if (token !== S.loadToken) return;
  $('#progressBar').style.width = '0%';
  if (!S.frames.length) { status('Frames did not cover the target.', true); return; }
  computeTemplate(); computeCuts(); render(); drawTimeline(); drawSpectrum();
  status(`${S.frames.length} frames · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  enableControls(true);
  computeAllPeaks(token);
  loadKnownBodies(token); loadTrack(token);
  if (S.frames.length > 1 && !S.playing) play();
}
function enableControls(on) { for (const id of ['playBtn', 'prevBtn', 'nextBtn', 'reportBtn', 'jsonBtn']) $('#' + id).disabled = !on; }
function status(msg, err = false) { const el = $('#tmStatus'); el.textContent = msg; el.style.color = err ? 'var(--danger)' : ''; }

// ---------- overlays data ----------
async function loadKnownBodies(token) {
  if (!$('#ovKnown').checked) return;
  const groups = new Map(); // visits within 0.05 d share one JPL query
  for (const f of S.frames) { const k = `${f.meta.ra.toFixed(3)}|${f.meta.dec.toFixed(3)}|${(Math.round(f.meta.mjd / 0.05) * 0.05).toFixed(2)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  const hw = (S.n * S.scale / 3600) * 0.6 + 0.02;
  await mapLimit([...groups.values()], 3, async (frames) => {
    if (token !== S.loadToken) return; const f = frames[0];
    try { const r = await api('api/smallbodies', { ra: f.meta.ra, dec: f.meta.dec, mjd: f.meta.mjd, hw: hw.toFixed(3) }); const j = await r.json(); for (const g of frames) S.known.set(g, j.bodies); }
    catch (e) { for (const g of frames) S.known.set(g, []); }
    if (frames.includes(S.frames[S.idx])) { drawOverlay(); listDetections(); }
  });
}
async function loadTrack(token) {
  if (S.track && S.track.length) { drawOverlay(); listDetections(); return; }
  const name = S.mission ? MISSIONS[S.mission].track : (S.target.moving ? S.target.name : null);
  if (!name || !S.frames.length) return;
  const m0 = S.frames[0].meta.mjd - 0.5, m1 = S.frames[S.frames.length - 1].meta.mjd + 0.5;
  try { const r = await api('api/horizons', { target: name, mjd0: m0, mjd1: m1, step: 6 }); const j = await r.json(); if (token === S.loadToken) { S.track = j.points; drawOverlay(); listDetections(); } } catch (e) { console.warn('track', e.message); }
}
function trackAt(mjd) {
  const t = S.track; if (!t || !t.length) return null;
  if (mjd <= t[0].mjd) return t[0]; if (mjd >= t[t.length - 1].mjd) return t[t.length - 1];
  let i = 0; while (i < t.length - 2 && t[i + 1].mjd < mjd) i++;
  const a = t[i], b = t[i + 1], u = (mjd - a.mjd) / (b.mjd - a.mjd || 1); let dra = b.ra - a.ra; if (dra > 180) dra -= 360; if (dra < -180) dra += 360;
  return { mjd, ra: a.ra + dra * u, dec: a.dec + (b.dec - a.dec) * u, mag: a.mag };
}

// ---------- image pipeline ----------
function computeTemplate() { S.template = S.frames.length >= 3 ? medianStack(S.frames.map(f => f.bg)) : null; S.suppressed = 0; }
function diffFor(f) {
  let e = S.peaks.get(f); if (e) return e;
  const m = matchedDifference(f.bg, S.template); e = { diff: m.diff, peaks: findPeaks(m.diff, f.meta.n, 5, 3, S.template), scale: m.scale }; S.peaks.set(f, e); return e;
}
// Difference every frame (in idle slices) so residuals can be cross-checked across epochs.
async function computeAllPeaks(token) {
  if (!S.template) return;
  for (let i = 0; i < S.frames.length; i++) { if (token !== S.loadToken) return; diffFor(S.frames[i]); if (i % 8 === 7) await new Promise(r => setTimeout(r, 0)); }
  const minRepeat = Math.max(2, Math.ceil(0.12 * S.frames.length));
  S.suppressed = flagPersistent(S.frames.map(f => S.peaks.get(f).peaks), minRepeat, S.frames.map(f => f.meta.mjd));
  if (S.mode === 'diff') { drawOverlay(); listDetections(); }
}
const livePeaks = (f) => (S.peaks.get(f)?.peaks || []).filter(p => !p.persistent);
function computeCuts() {
  const all = []; for (const f of S.frames) { const s = finiteSample(f.bg, 4000); for (let i = 0; i < s.length; i += 4) all.push(s[i]); }
  all.sort((a, b) => a - b); const st = robustStats(all);
  S.cuts = { lo: st.median - 1.5 * st.sigma, hi: Math.max(percentile(all, 0.997), st.median + 8 * st.sigma) };
}
function frameFilter() { // wavelength-matching subset for blinking
  if (!Number.isFinite(S.waveTol) || !S.frames.length) return S.frames.map((_, i) => i);
  const w0 = S.frames[S.idx]?.meta.wavelength; if (!Number.isFinite(w0)) return S.frames.map((_, i) => i);
  return S.frames.map((f, i) => [f, i]).filter(([f]) => Number.isFinite(f.meta.wavelength) && Math.abs(f.meta.wavelength - w0) <= S.waveTol).map(([, i]) => i);
}
function currentImage() {
  const f = S.frames[S.idx]; if (!f) return null;
  if (S.mode === 'template' && S.template) return { data: S.template, diverging: false };
  if (S.mode === 'diff' && S.template) return { data: diffFor(f).diff, diverging: true };
  return { data: f.bg, diverging: false };
}
const off = document.createElement('canvas'); const offCtx = off.getContext('2d');
function render() {
  const cv = $('#frameCanvas'); const ctx = cv.getContext('2d'); const f = S.frames[S.idx];
  if (!f) { ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, cv.width, cv.height); drawOverlay(); updateHud(); return; }
  const img = currentImage(); const n = f.meta.n; off.width = n; off.height = n;
  let lo = S.cuts?.lo ?? 0, hi = S.cuts?.hi ?? 1;
  if (img.diverging) { const st = robustStats(img.data); lo = -6 * st.sigma; hi = 6 * st.sigma; }
  offCtx.putImageData(toImageData(img.data, n, { lo, hi, mode: S.stretch, cmap: img.diverging ? 'diverging' : S.cmap, diverging: img.diverging }), 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(off, 0, 0, cv.width, cv.height);
  drawOverlay(); updateHud(); if (f !== S.lastFp) { S.lastFp = f; showFootprint(f); }
}
function updateHud() {
  const f = S.frames[S.idx];
  $('#hudIdx').textContent = f ? `${S.idx + 1} / ${S.frames.length}` : '0 / 0';
  $('#hudDate').textContent = f ? fmtDate(f.meta.mjd) : '—';
  const chip = $('#hudBand'); chip.textContent = f ? f.meta.band : '—'; chip.style.background = f ? BAND_COLOR[f.meta.band] : '';
  $('#hudWave').textContent = f && Number.isFinite(f.meta.wavelength) ? `λ ${f.meta.wavelength.toFixed(3)} µm` : '';
  $('#frameInfo').textContent = f ? JSON.stringify({ ...f.meta, phot: f.phot && { mJy: +f.phot.mjy.toFixed(3), bg: +f.phot.bg.toFixed(4) } }, null, 1) : '';
  const link = $('#irsaLink'); if (f) { link.hidden = false; link.href = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/' + f.meta.key; } else link.hidden = true;
}
function drawOverlay() {
  const cv = $('#overlayCanvas'); const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  const f = S.frames[S.idx]; if (!f) return; const n = f.meta.n, k = cv.width / n;
  const toXY = (i, j) => [(i + 0.5) * k, (n - 1 - j + 0.5) * k];
  ctx.lineWidth = 1.2; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  // scale bar + compass
  const arcmin = 60 / f.meta.scale * k; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath(); ctx.moveTo(14, cv.height - 34); ctx.lineTo(14 + arcmin, cv.height - 34); ctx.stroke(); ctx.fillText('1′', 14 + arcmin + 6, cv.height - 34);
  ctx.fillText('N ↑  E ←', cv.width - 70, 16);
  if ($('#ovGrid').checked) { const [cx, cy] = toXY((n - 1) / 2, (n - 1) / 2); ctx.strokeStyle = 'rgba(255,181,71,.7)'; ctx.beginPath(); ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 18, cy); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 6); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 18); ctx.stroke(); }
  if ($('#ovKnown').checked) for (const b of (S.known.get(f) || [])) {
    const [i, j] = skyToPix(f, b.ra, b.dec); if (i < -2 || j < -2 || i > n + 2 || j > n + 2) continue; const [x, y] = toXY(i, j);
    ctx.strokeStyle = '#6ee7a8'; ctx.fillStyle = '#6ee7a8'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.fillText(`${b.name.replace(/\s*\(.*\)$/, '')}${b.vmag ? ' V' + b.vmag.toFixed(1) : ''}`, x + 12, y - 10);
  }
  if ($('#ovTrack').checked && S.track) { const p = trackAt(f.meta.mjd); if (p) { const [i, j] = skyToPix(f, p.ra, p.dec); const [x, y] = toXY(i, j); ctx.strokeStyle = '#60c8ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 12); ctx.lineTo(x - 12, y); ctx.closePath(); ctx.stroke(); ctx.fillStyle = '#60c8ff'; ctx.fillText('predicted', x + 14, y + 12); } }
  const cometLocked = S.mission && MISSIONS[S.mission].lock === 'comet';
  if ($('#ovPeaks').checked && S.mode === 'diff' && !cometLocked) for (const p of livePeaks(f)) {
    const [x, y] = toXY(p.x, p.y); const known = matchKnown(f, p); ctx.strokeStyle = known ? '#6ee7a8' : p.confirmed ? '#ff6b6b' : 'rgba(255,160,160,.45)'; ctx.lineWidth = 1.4; ctx.strokeRect(x - 8, y - 8, 16, 16); ctx.fillStyle = ctx.strokeStyle; ctx.fillText(`${p.snr.toFixed(0)}σ`, x + 11, y + 11);
  }
}
function matchKnown(f, p) { const [ra, dec] = pixToSky(f, p.x, p.y); const near = 2.5 * f.meta.scale / 3600; let best = null;
  if (S.target && angSep(ra, dec, S.target.ra, S.target.dec) < 2 * near) return { name: `${S.target.name || 'target'} — brightness changed vs. static sky`, kind: 'track', d: 0 }; for (const b of (S.known.get(f) || [])) { const d = angSep(ra, dec, b.ra, b.dec); if (d < near && (!best || d < best.d)) best = { ...b, d }; } if (!best && S.track) { const t = trackAt(f.meta.mjd); if (t && angSep(ra, dec, t.ra, t.dec) < near) best = { name: 'ephemeris target', kind: 'track', d: 0 }; } return best; }

// ---------- timeline ----------
function drawTimeline() {
  const cv = $('#timeline'); const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = 64 * devicePixelRatio; const ctx = cv.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = W / devicePixelRatio, h = 64; ctx.clearRect(0, 0, w, h); const fr = S.frames; if (!fr.length) { ctx.fillStyle = '#4b5578'; ctx.font = '12px system-ui'; ctx.fillText('timeline', 8, 36); return; }
  // compressed time axis: visits (gaps > 5 d) are separated by a fixed gutter
  const pos = timelinePositions(w); const sel = new Set(frameFilter());
  let lastVisit = -1, lastLabelX = -Infinity; ctx.font = '10px system-ui'; ctx.textBaseline = 'top';
  fr.forEach((f, i) => { if (pos.visit[i] !== lastVisit) { lastVisit = pos.visit[i]; if (pos.x[i] - lastLabelX < 66) return; lastLabelX = pos.x[i]; ctx.fillStyle = '#7d89b0'; ctx.fillText(mjdToDate(f.meta.mjd).toISOString().slice(0, 10), Math.min(pos.x[i] - 2, w - 62), 4); } });
  fr.forEach((f, i) => { const x = pos.x[i]; ctx.fillStyle = sel.has(i) ? BAND_COLOR[f.meta.band] : 'rgba(120,130,170,.35)'; ctx.fillRect(x - 1.5, 22, 3, 24); });
  ctx.fillStyle = '#ffb547'; ctx.fillRect(pos.x[S.idx] - 2.5, 18, 5, 32);
  if (S.hoverIdx >= 0 && fr[S.hoverIdx]) { ctx.fillStyle = '#e8ecf8'; ctx.fillText(fmtDate(fr[S.hoverIdx].meta.mjd), Math.min(w - 120, pos.x[S.hoverIdx]), 52); }
}
function timelinePositions(w) {
  const fr = S.frames; const x = [], visit = []; let v = 0; const gaps = []; for (let i = 1; i < fr.length; i++) gaps.push(fr[i].meta.mjd - fr[i - 1].meta.mjd > 5);
  const nGap = gaps.filter(Boolean).length; const gutter = 18; const inner = w - 20 - gutter * nGap; const per = fr.length > 1 ? inner / (fr.length - 1) : 0;
  let cx = 10; x.push(cx); visit.push(0); for (let i = 1; i < fr.length; i++) { cx += per; if (gaps[i - 1]) { cx += gutter; v++; } x.push(cx); visit.push(v); }
  return { x, visit };
}
function timelineIndexAt(px) { const w = $('#timeline').clientWidth; const pos = timelinePositions(w); let best = 0, bd = Infinity; pos.x.forEach((x, i) => { const d = Math.abs(x - px); if (d < bd) { bd = d; best = i; } }); return best; }

// ---------- spectrum ----------
function drawSpectrum() {
  const cv = $('#spectrum'); const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = 180 * devicePixelRatio; const ctx = cv.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = W / devicePixelRatio, h = 180; ctx.clearRect(0, 0, w, h);
  const pts = S.frames.map((f, i) => ({ i, w: f.meta.wavelength, y: f.phot?.mjy, band: f.meta.band })).filter(p => Number.isFinite(p.w) && Number.isFinite(p.y));
  ctx.font = '10px system-ui'; ctx.fillStyle = '#7d89b0';
  if (pts.length < 2) { ctx.fillText('spectrum appears once frames are loaded', 8, 90); return; }
  const L = 44, R = 10, T = 10, B = 24; const ys = pts.map(p => p.y).sort((a, b) => a - b); const ylo = Math.min(0, ys[Math.floor(ys.length * 0.05)]), yhi = ys[Math.floor(ys.length * 0.97)] * 1.15 || 1;
  const xw = (v) => L + (v - 0.7) / (5.1 - 0.7) * (w - L - R), yv = (v) => T + (1 - (v - ylo) / (yhi - ylo)) * (h - T - B);
  ctx.strokeStyle = '#232c4a'; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, h - B); ctx.lineTo(w - R, h - B); ctx.stroke();
  for (const t of [1, 2, 3, 4, 5]) { ctx.fillText(t + ' µm', xw(t) - 10, h - B + 6); ctx.strokeStyle = '#161c33'; ctx.beginPath(); ctx.moveTo(xw(t), T); ctx.lineTo(xw(t), h - B); ctx.stroke(); }
  ctx.fillText(yhi.toPrecision(2) + ' mJy', 2, T); ctx.fillText(ylo.toPrecision(2), 2, h - B - 10);
  if (ylo < 0) { ctx.strokeStyle = '#3a4468'; ctx.beginPath(); ctx.moveTo(L, yv(0)); ctx.lineTo(w - R, yv(0)); ctx.stroke(); }
  for (const p of pts) { const cur = p.i === S.idx, hov = p.i === S.hoverIdx; ctx.fillStyle = BAND_COLOR[p.band]; ctx.beginPath(); ctx.arc(xw(p.w), yv(Math.min(yhi, Math.max(ylo, p.y))), cur || hov ? 5 : 2.6, 0, Math.PI * 2); ctx.fill(); if (cur) { ctx.strokeStyle = '#fff'; ctx.stroke(); } }
}

// ---------- detections ----------
function listDetections() {
  const f = S.frames[S.idx]; const list = $('#detectList'); list.innerHTML = ''; let n = 0;
  const LABEL = { known: 'KNOWN', track: 'TARGET', unknown: 'UNIDENTIFIED', single: 'SINGLE FRAME' };
  const add = (kind, title, meta, onClick) => { const d = document.createElement('div'); d.className = 'det'; d.innerHTML = `<span class="kind ${kind}">${LABEL[kind]}</span><span>${title}</span><span class="meta">${meta}</span>`; if (onClick) d.onclick = onClick; list.appendChild(d); n++; };
  if (f) {
    const cometLocked = S.mission && MISSIONS[S.mission].lock === 'comet';
    if (S.mode === 'diff' && !cometLocked) for (const p of [...livePeaks(f)].sort((a, b) => (b.confirmed | 0) - (a.confirmed | 0) || b.snr - a.snr)) { const k = matchKnown(f, p); const [ra, dec] = pixToSky(f, p.x, p.y); const kind = k ? (k.kind === 'track' ? 'track' : 'known') : (p.confirmed ? 'unknown' : 'single'); add(kind, k ? k.name : `${p.confirmed ? 'mover' : 'hit'} at ${fmtDeg(ra)}, ${fmtDeg(dec)}`, `${p.snr.toFixed(0)}σ · ${p.npix} px${!k && !p.confirmed ? ' · seen in one frame only (cosmic ray?)' : !k ? ' · seen again in a neighbouring frame' : ''}`, () => { S.mode = 'diff'; }); }
    for (const b of (S.known.get(f) || [])) { const [i, j] = skyToPix(f, b.ra, b.dec); if (i < 0 || j < 0 || i >= f.meta.n || j >= f.meta.n) continue; add('known', b.name, `${b.kind}${b.vmag ? ' · V ' + b.vmag.toFixed(1) : ''} · in field`); }
    const t = S.track && trackAt(f.meta.mjd); if (t) add('track', `${S.mission ? MISSIONS[S.mission].track : S.target.name} (JPL ephemeris)`, `${fmtDeg(t.ra)}, ${fmtDeg(t.dec)}`);
  }
  if (S.mission && MISSIONS[S.mission].lock === 'comet' && S.mode === 'diff') { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'Comet-locked view: the frames are centred on the comet, so background stars are the movers here and the comet is the static object at the centre.'; list.prepend(d); }
  if (S.mode === 'diff' && S.suppressed) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = `${S.suppressed} residual${S.suppressed > 1 ? 's' : ''} that repeat at the same place across epochs were suppressed as static artefacts.`; list.appendChild(d); }
  $('#detectCount').textContent = n; if (!n) list.innerHTML = `<div class="hint">${S.mode === 'diff' ? 'No ≥5σ residuals in this frame.' : 'Switch to Difference mode to auto-detect movers; known asteroids/comets in the field are listed here as they load.'}</div>`;
}

// ---------- playback ----------
function play() { if (S.frames.length < 2) return; S.playing = true; $('#playBtn').textContent = '❚❚ Pause'; tick(); }
function stop() { S.playing = false; clearTimeout(S.timer); $('#playBtn').textContent = '▶ Blink'; }
function tick() { if (!S.playing) return; step(1); const fps = +$('#speed').value; S.timer = setTimeout(tick, 1000 / fps); }
function step(d) { const sel = frameFilter(); if (!sel.length) return; let k = sel.indexOf(S.idx); k = (k + d + sel.length) % sel.length; S.idx = sel[k]; render(); drawTimeline(); drawSpectrum(); listDetections(); }
function goto(i) { S.idx = Math.max(0, Math.min(S.frames.length - 1, i)); render(); drawTimeline(); drawSpectrum(); listDetections(); }

// ---------- missions, search, hash ----------
async function runMission(id) {
  const m = MISSIONS[id]; if (!m) return; S.n = m.n || 128; S.scale = m.scale || 6.15; $('#sizeSel').value = `${S.n},${S.scale}`;
  if (m.file) {
    status('Loading mission…'); let j; try { j = await (await fetch(m.file)).json(); } catch (e) { status('Mission data missing: ' + e.message, true); return; }
    const exposures = j.exposures.map(e => ({ ...e, cra: m.lock === 'comet' ? e.cometRa : undefined, cdec: m.lock === 'comet' ? e.cometDec : undefined }));
    const first = exposures[Math.floor(exposures.length / 2)]; const ra = j.ra ?? first.cra, dec = j.dec ?? first.cdec;
    const p = setTarget({ ra, dec, name: m.title, moving: !!m.track }, { mission: id, title: m.title, sub: m.sub, exposures, band: m.band || j.band, fov: 3 });
    if (j.track) S.track = j.track;
    return p;
  }
  return setTarget({ ra: m.ra, dec: m.dec, name: m.title }, { mission: id, title: m.title, sub: m.sub, band: m.band, collection: m.collection, fov: 3 });
}
async function search(q) {
  q = q.trim(); if (!q) return; const m = /^\s*([+-]?\d+(?:\.\d+)?)[\s,]+([+-]?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (m) return setTarget({ ra: ((+m[1] % 360) + 360) % 360, dec: +m[2], name: null }, { fov: 2 });
  status('Resolving name…'); try { const r = await api('api/resolve', { name: q }); const j = await r.json(); return setTarget({ ra: j.ra, dec: j.dec, name: j.name, moving: j.moving }, { title: j.name, sub: `${j.type || ''}${j.moving ? ' · solar-system body (position now; SPHEREx frames may not include it)' : ''}`, fov: 2 }); }
  catch (e) { status(`Could not resolve "${q}"`, true); }
}
function writeHash() { if (!S.target) return; const p = new URLSearchParams(); if (S.mission) p.set('m', S.mission); else { p.set('ra', S.target.ra.toFixed(5)); p.set('dec', S.target.dec.toFixed(5)); if (S.target.name) p.set('name', S.target.name); } history.replaceState(null, '', '#' + p.toString()); }
function parseHash() { const h = location.hash.slice(1); if (!h) return null; const p = new URLSearchParams(h); return p.get('m') ? { mission: p.get('m') } : (p.get('ra') ? { ra: +p.get('ra'), dec: +p.get('dec'), name: p.get('name') } : null); }
function applyHash(h) { if (h.mission) runMission(h.mission); else setTarget({ ra: h.ra, dec: h.dec, name: h.name }, { fov: 2 }); }

// ---------- report ----------
function buildReport() {
  const f = S.frames[S.idx]; const lines = [];
  lines.push(`BLINK — SPHEREx Time Machine — discovery report`, `Generated ${new Date().toISOString()}`, ``);
  lines.push(`Target: ${S.target.name || '(unnamed)'}  RA ${fmtDeg(S.target.ra, 5)}°  Dec ${fmtDeg(S.target.dec, 5)}°`);
  lines.push(`Band ${S.band} · ${S.frames.length} SPHEREx QR2 exposures from ${fmtDate(S.frames[0].meta.mjd)} to ${fmtDate(S.frames[S.frames.length - 1].meta.mjd)}`);
  lines.push(`Field ${(S.n * S.scale / 60).toFixed(1)}′ · ${S.scale}″/px · mode ${S.mode}`, ``);
  if (f) {
    lines.push(`Current frame: ${f.meta.obsid} D${f.meta.detector} · ${fmtDate(f.meta.mjd)} · λ ${f.meta.wavelength?.toFixed(3)} µm`);
    lines.push(`  ${f.meta.url}`);
    const pk = livePeaks(f); if (pk.length) { lines.push(`  Movers ≥5σ vs. static-sky template (static residuals removed):`); for (const p of pk) { const k = matchKnown(f, p); const [ra, dec] = pixToSky(f, p.x, p.y); lines.push(`   - ${fmtDeg(ra, 5)}, ${fmtDeg(dec, 5)}  ${p.snr.toFixed(1)}σ  ${p.npix}px  ${k ? 'matches ' + k.name : 'NO CATALOGUED MATCH'}`); } }
    const kb = S.known.get(f) || []; if (kb.length) lines.push(`  Known small bodies in field (JPL SBDB): ${kb.map(b => b.name).join('; ')}`);
  }
  lines.push(``, `Photometry at target (aperture 2.5 px, annulus 5–9 px):`);
  for (const g of S.frames) lines.push(`  ${fmtDate(g.meta.mjd)}  ${g.meta.band}  λ=${g.meta.wavelength?.toFixed(3)}  ${g.phot ? g.phot.mjy.toFixed(3) + ' mJy' : '—'}`);
  lines.push(``, `Data: NASA/JPL-Caltech SPHEREx QR2 via IRSA & AWS Open Data. Ephemerides: JPL SSD. Verify before reporting to the MPC.`);
  return lines.join('\n');
}
function downloadJson() {
  const out = { target: S.target, band: S.band, field: { n: S.n, scale: S.scale }, frames: S.frames.map(f => ({ ...f.meta, phot: f.phot, peaks: livePeaks(f).map(p => ({ ...p, sky: pixToSky(f, p.x, p.y) })), known: S.known.get(f) || [] })), track: S.track };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })); a.download = `blink-${(S.target.name || 'target').replace(/\W+/g, '_')}.json`; a.click();
}

// ---------- wiring ----------
function wire() {
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search($('#searchInput').value); });
  document.querySelectorAll('.missions button').forEach(b => b.addEventListener('click', () => runMission(b.dataset.mission)));
  $('#playBtn').onclick = () => S.playing ? stop() : play();
  $('#prevBtn').onclick = () => { stop(); step(-1); }; $('#nextBtn').onclick = () => { stop(); step(1); };
  $('#modeSeg').querySelectorAll('button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; $('#modeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); render(); listDetections(); });
  $('#stretchSel').onchange = (e) => { S.stretch = e.target.value; render(); }; $('#cmapSel').onchange = (e) => { S.cmap = e.target.value; render(); };
  $('#sizeSel').onchange = (e) => { const [n, s] = e.target.value.split(',').map(Number); S.n = n; S.scale = s; if (S.epochs) loadFrames(); };
  for (const id of ['ovKnown', 'ovTrack', 'ovPeaks', 'ovGrid']) $('#' + id).onchange = () => { drawOverlay(); listDetections(); if (id === 'ovKnown' && $('#ovKnown').checked && !S.known.size) loadKnownBodies(S.loadToken); };
  $('#waveTol').oninput = (e) => { const v = +e.target.value; S.waveTol = v >= 20 ? Infinity : v / 100; $('#waveTolVal').textContent = v >= 20 ? 'all' : (v / 100).toFixed(2); drawTimeline(); };
  const tl = $('#timeline'); tl.onclick = (e) => { stop(); goto(timelineIndexAt(e.offsetX)); }; tl.onmousemove = (e) => { S.hoverIdx = timelineIndexAt(e.offsetX); drawTimeline(); drawSpectrum(); }; tl.onmouseleave = () => { S.hoverIdx = -1; drawTimeline(); drawSpectrum(); };
  $('#reportBtn').onclick = async () => { try { await navigator.clipboard.writeText(buildReport()); toast('Report copied to clipboard'); } catch { const w = window.open('', '_blank'); w.document.write('<pre>' + buildReport().replace(/</g, '&lt;') + '</pre>'); } };
  $('#jsonBtn').onclick = downloadJson;
  $('#shareBtn').onclick = async () => { writeHash(); try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast(location.href, 5000); } };
  $('#aboutBtn').onclick = () => $('#aboutDlg').showModal();
  window.addEventListener('resize', () => { drawTimeline(); drawSpectrum(); });
  window.addEventListener('hashchange', () => { const h = parseHash(); if (h && (h.mission ? h.mission !== S.mission : !S.target || Math.abs(h.ra - S.target.ra) > 1e-4 || Math.abs(h.dec - S.target.dec) > 1e-4)) applyHash(h); });
  window.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; if (e.key === ' ') { e.preventDefault(); S.playing ? stop() : play(); } if (e.key === 'ArrowLeft') { stop(); step(-1); } if (e.key === 'ArrowRight') { stop(); step(1); } if (e.key === 'd') $('#modeSeg button[data-mode=diff]').click(); if (e.key === 'b') $('#modeSeg button[data-mode=blink]').click(); });
  $('#footStat').textContent = 'SPHEREx QR2 · updated weekly by IRSA';
}
wire(); initSky();
