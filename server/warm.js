// Pre-warm the disk cache for the demo missions so the first public visitors (and judges) get instant frames.
import { readFile } from 'node:fs/promises';
const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const MISSIONS = [
  { id: '3iatlas', file: '../web/missions/3iatlas.json', n: 96, scale: 6.15, lock: 'comet', bands: ['D3', 'D6', 'D2', 'D5', 'D1', 'D4'] },
  { id: 'vesta', file: '../web/missions/vesta.json', n: 160, scale: 9, bands: ['D2', 'D5'] },
  { id: 'planet9', ra: 34.70, dec: -49.81, n: 200, scale: 12, bands: ['D2', 'D5', 'D1'] },
  { id: 'mira', ra: 34.8367, dec: -2.9776, n: 128, scale: 6.15, bands: ['D1', 'D2', 'D3'] },
  { id: 'nep', ra: 270.0, dec: 66.56, collection: 'deep', n: 128, scale: 6.15, bands: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] },
];
const MAX = 90;
async function run(m) {
  let exposures;
  if (m.file) { const j = JSON.parse(await readFile(new URL(m.file, import.meta.url), 'utf8')); exposures = j.exposures.map(e => ({ ...e, ra: m.lock === 'comet' ? e.cometRa : j.ra, dec: m.lock === 'comet' ? e.cometDec : j.dec })); }
  else { const r = await fetch(`${BASE}/api/epochs?ra=${m.ra}&dec=${m.dec}${m.collection ? '&collection=' + m.collection : ''}`); const j = await r.json(); exposures = j.epochs.map(e => ({ ...e, ra: m.ra, dec: m.dec })); console.log(m.id, 'epochs', j.count); }
  // note: for fixed targets every cutout is centred on the mission target (ra/dec overwritten above)
  for (const band of m.bands) {
    let list = exposures.filter(e => e.band === band && e.key);
    if (list.length > MAX) { const step = list.length / MAX; list = Array.from({ length: MAX }, (_, i) => list[Math.floor(i * step)]); }
    const t0 = Date.now(); let ok = 0, i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => { while (i < list.length) { const e = list[i++]; try { const r = await fetch(`${BASE}/api/cutout?key=${encodeURIComponent(e.key)}&ra=${e.ra}&dec=${e.dec}&n=${m.n}&scale=${m.scale}`); if (r.ok) { await r.arrayBuffer(); ok++; } } catch {} } }));
    console.log(`${m.id} ${band}: ${ok}/${list.length} cutouts in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    // known bodies per visit (grouped like the client does)
    const groups = new Map(); for (const e of list) { const k = `${(+e.ra).toFixed(3)}|${(+e.dec).toFixed(3)}|${(Math.round(e.mjd / 0.05) * 0.05).toFixed(2)}`; if (!groups.has(k)) groups.set(k, e); }
    const hw = (m.n * m.scale / 3600) * 0.6 + 0.02; let j = 0; const gl = [...groups.values()];
    await Promise.all(Array.from({ length: 2 }, async () => { while (j < gl.length) { const e = gl[j++]; try { await fetch(`${BASE}/api/smallbodies?ra=${e.ra}&dec=${e.dec}&mjd=${e.mjd}&hw=${hw.toFixed(3)}`); } catch {} } }));
  }
}
for (const m of MISSIONS) { try { await run(m); } catch (e) { console.error(m.id, 'failed', e.message); } }
console.log('warm done');
