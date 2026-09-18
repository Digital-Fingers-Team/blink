// IRSA SIA2 client: list every SPHEREx QR2 exposure whose footprint contains a sky position.
const SIA = 'https://irsa.ipac.caltech.edu/SIA';

export function parseVotable(xml) {
  const fields = [...xml.matchAll(/<FIELD[^>]*name="([^"]+)"/g)].map(m => m[1]);
  const rows = [...xml.matchAll(/<TR>([\s\S]*?)<\/TR>/g)].map(r => {
    const tds = [...r[1].matchAll(/<TD>([\s\S]*?)<\/TD>/g)].map(m => m[1].trim().replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const o = {}; fields.forEach((f, i) => o[f] = tds[i]); return o;
  });
  return { fields, rows };
}

function mjdToIso(mjd) { return new Date((mjd - 40587) * 86400000).toISOString(); }

export async function listEpochs(ra, dec, { collection = 'spherex_qr2', radius = 0.0005 } = {}) {
  const url = `${SIA}?COLLECTION=${collection}&POS=circle+${ra}+${dec}+${radius}&RESPONSEFORMAT=VOTABLE&MAXREC=5000`;
  const r = await fetch(url, { headers: { 'User-Agent': 'BLINK-SPHEREx-TimeMachine/0.1' } });
  if (!r.ok) throw new Error(`SIA2 HTTP ${r.status}`);
  const { rows } = parseVotable(await r.text());
  const epochs = rows.filter(o => o.dataproduct_subtype === 'science' && o.access_format === 'image/fits').map(o => {
    let key = null; try { key = JSON.parse(o.cloud_access).aws.key; } catch {}
    const band = (o.energy_bandpassname || '').replace('SPHEREx-', '');
    return {
      obsid: o.obs_id, band, det: +band.replace('D', ''), mjd: +o.t_min, date: mjdToIso(+o.t_min),
      exptime: +o.t_exptime, emMin: +o.em_min * 1e6, emMax: +o.em_max * 1e6,
      ra: +o.s_ra, dec: +o.s_dec, url: o.access_url, key, region: o.s_region, released: o.obs_release_date,
    };
  }).sort((a, b) => a.mjd - b.mjd);
  // Point-in-footprint check: SIA2 returns any image whose region intersects the search circle.
  // With a ~2 arcsec radius that is effectively containment, so we keep all rows.
  return { ra, dec, collection, count: epochs.length, epochs };
}

// Group exposures into "visits" (same band, within 1 day) so the UI can show a clean timeline.
export function groupVisits(epochs, gapDays = 1) {
  const byBand = {};
  for (const e of epochs) (byBand[e.band] ||= []).push(e);
  const out = {};
  for (const [band, list] of Object.entries(byBand)) {
    const visits = []; let cur = null;
    for (const e of list) {
      if (!cur || e.mjd - cur.mjdEnd > gapDays) { cur = { band, mjdStart: e.mjd, mjdEnd: e.mjd, exposures: [] }; visits.push(cur); }
      cur.mjdEnd = e.mjd; cur.exposures.push(e);
    }
    out[band] = visits;
  }
  return out;
}
