// Build the 3I/ATLAS mission file: IRSA's curated observation table gives obs_id + detector +
// predicted comet position per exposure, but not S3 keys. We recover keys from SIA2 by querying
// around the comet's track and matching obs_id/detector.
import { writeFile, mkdir } from 'node:fs/promises';
import { parseVotable } from './sia.js';

const VOT = 'https://irsa.ipac.caltech.edu/data/SPHEREx/docs/comet3iatlas/obscore_3I_Atlas.vot';
const xml = await (await fetch(VOT)).text();
const { rows } = parseVotable(xml);
const obs = rows.map(o => ({
  obsid: o.obs_id, det: +String(o.spherex_detector).replace(/\D/g, ""), mjd: +o.t_min, cometRa: +o.comet_ra, cometDec: +o.comet_dec,
  ra: +o.s_ra, dec: +o.s_dec, emMin: +o.em_min * 1e6, emMax: +o.em_max * 1e6, did: o.obs_creator_did,
}));
console.log('table rows', obs.length);
// Cluster by season (Aug vs Dec 2025) and query SIA2 around the mean comet position
const seasons = {}; for (const o of obs) (seasons[o.mjd < 60950 ? 'aug' : 'dec'] ||= []).push(o);
const want = new Map(obs.map(o => [`${o.obsid}/D${o.det}`, o]));
const found = new Map();
for (const [name, list] of Object.entries(seasons)) {
  const ra = list.reduce((a, o) => a + o.cometRa, 0) / list.length, dec = list.reduce((a, o) => a + o.cometDec, 0) / list.length;
  const spread = Math.max(...list.map(o => Math.hypot((o.cometRa - ra) * Math.cos(dec * Math.PI / 180), o.cometDec - dec)));
  const radius = Math.min(10, spread + 3).toFixed(2);
  const t0 = Math.min(...list.map(o => o.mjd)) - 1, t1 = Math.max(...list.map(o => o.mjd)) + 1;
  const url = `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2&POS=circle+${ra.toFixed(4)}+${dec.toFixed(4)}+${radius}&TIME=${t0}+${t1}&RESPONSEFORMAT=VOTABLE&MAXREC=20000`;
  console.log(name, list.length, 'exposures; query', url);
  const r = await fetch(url); const { rows: sr } = parseVotable(await r.text());
  console.log('  SIA rows', sr.length);
  for (const o of sr) {
    const k = `${o.obs_id}/${(o.energy_bandpassname || '').replace('SPHEREx-', '')}`;
    if (want.has(k) && !found.has(k)) { let key = null; try { key = JSON.parse(o.cloud_access).aws.key; } catch {} found.set(k, { key, url: o.access_url, t: +o.t_min }); }
  }
}
const out = [];
for (const [k, o] of want) { const f = found.get(k); if (f && f.key) out.push({ ...o, band: 'D' + o.det, key: f.key }); }
out.sort((a, b) => a.mjd - b.mjd);
console.log('matched', out.length, 'of', want.size);
await mkdir(new URL('../web/missions/', import.meta.url), { recursive: true });
await writeFile(new URL('../web/missions/3iatlas.json', import.meta.url), JSON.stringify({
  id: '3iatlas', title: 'Interstellar comet 3I/ATLAS', generated: new Date().toISOString(), source: VOT, exposures: out,
}, null, 0));
console.log('wrote web/missions/3iatlas.json');
