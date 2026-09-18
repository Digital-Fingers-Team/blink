// Find a SPHEREx "visit" of a moving solar-system body: sample its JPL ephemeris across the mission,
// ask IRSA which exposures cover each sample within ±4 days, and keep the richest one.
// Usage: node build_mover.js Vesta vesta
import { writeFile, mkdir } from 'node:fs/promises';
import { horizons } from './external.js';
import { parseVotable } from './sia.js';

const [target = 'Vesta', id = 'vesta'] = process.argv.slice(2);
const MJD0 = 60796, MJD1 = Date.now() / 86400000 + 40587 - 20; // 2025-05-01 -> ~3 weeks ago (archive latency)
const eph = await horizons(target, MJD0, MJD1, 24 * 5); // every 5 days
console.log(target, 'ephemeris points', eph.points.length);
let best = null;
for (const p of eph.points) {
  const url = `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2&POS=circle+${p.ra.toFixed(4)}+${p.dec.toFixed(4)}+0.05&TIME=${(p.mjd - 4).toFixed(2)}+${(p.mjd + 4).toFixed(2)}&RESPONSEFORMAT=VOTABLE&MAXREC=2000`;
  let rows = []; try { rows = parseVotable(await (await fetch(url)).text()).rows; } catch (e) { console.warn('SIA failed', e.message); continue; }
  const sci = rows.filter(o => o.dataproduct_subtype === 'science');
  process.stdout.write(`${p.date} ${p.ra.toFixed(2)},${p.dec.toFixed(2)} -> ${sci.length} exposures\n`);
  if (!best || sci.length > best.rows.length) best = { p, rows: sci };
}
if (!best || !best.rows.length) { console.error('no coverage found'); process.exit(1); }
// Refine: exact ephemeris every 6 h across the visit, centre the field on the mid-visit position
const t0 = Math.min(...best.rows.map(o => +o.t_min)), t1 = Math.max(...best.rows.map(o => +o.t_min));
const fine = await horizons(target, t0 - 0.5, t1 + 0.5, 6);
const mid = fine.points[Math.floor(fine.points.length / 2)];
const exposures = best.rows.map(o => { let key = null; try { key = JSON.parse(o.cloud_access).aws.key; } catch {} return { obsid: o.obs_id, band: (o.energy_bandpassname || '').replace('SPHEREx-', ''), mjd: +o.t_min, exptime: +o.t_exptime, key }; }).filter(e => e.key).sort((a, b) => a.mjd - b.mjd);
const counts = {}; for (const e of exposures) counts[e.band] = (counts[e.band] || 0) + 1;
const band = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
await mkdir(new URL('../web/missions/', import.meta.url), { recursive: true });
await writeFile(new URL(`../web/missions/${id}.json`, import.meta.url), JSON.stringify({ id, title: eph.target, target, ra: mid.ra, dec: mid.dec, mjd0: t0, mjd1: t1, band, counts, track: fine.points, exposures }));
console.log(`wrote ${id}.json: ${exposures.length} exposures, centre ${mid.ra.toFixed(4)},${mid.dec.toFixed(4)}, ${fmt(t0)} .. ${fmt(t1)}, bands`, counts);
function fmt(m) { return new Date((m - 40587) * 86400000).toISOString().slice(0, 10); }
