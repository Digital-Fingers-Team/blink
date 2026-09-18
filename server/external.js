// Proxies to external services that do not send CORS headers (JPL) or that we want cached.
const D2R = Math.PI / 180;

function mjdToDate(mjd) { return new Date((mjd - 40587) * 86400000); }
function fmtRa(ra) { const h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), ss = (m - mm) * 60; return `${String(hh).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${ss.toFixed(2).padStart(5, '0')}`; }
function fmtDec(dec) { const s = dec < 0 ? 'M' : ''; const a = Math.abs(dec), dd = Math.floor(a), m = (a - dd) * 60, mm = Math.floor(m), ss = (m - mm) * 60; return `${s}${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${ss.toFixed(1).padStart(4, '0')}`; }
function sexToDeg(s, hours) { const p = s.trim().replace(/[:'"]/g, ' ').split(/\s+/).map(Number); const sign = /^-/.test(s.trim()) ? -1 : 1; const v = Math.abs(p[0]) + (p[1] || 0) / 60 + (p[2] || 0) / 3600; return sign * v * (hours ? 15 : 1); }

// Known small bodies (asteroids + comets) inside a box around (ra, dec) at a given MJD,
// via NASA/JPL's Small-Body Identification API. Half-width in degrees (JPL treats hwidth as degrees).
export async function smallBodies(ra, dec, mjd, halfDeg = 0.15, vmagLim = 22) {
  const d = mjdToDate(mjd); const t = d.toISOString().slice(0, 19).replace('T', '_');
  const out = [];
  for (const kind of ['a', 'c']) {
    const q = new URLSearchParams({
      'sb-kind': kind, 'mag-required': 'true', 'two-pass': 'true', 'suppress-first-pass': 'true', 'req-elem': 'false',
      'vmag-lim': String(vmagLim), 'fov-ra-center': fmtRa(ra), 'fov-dec-center': fmtDec(dec),
      'fov-ra-hwidth': String(halfDeg), 'fov-dec-hwidth': String(halfDeg), 'obs-time': t, 'mpc-code': '500',
    });
    const r = await fetch('https://ssd-api.jpl.nasa.gov/sb_ident.api?' + q, { headers: { 'User-Agent': 'BLINK-SPHEREx/0.1' } });
    if (!r.ok) throw new Error(`sb_ident HTTP ${r.status}`);
    const j = await r.json();
    const fields = j.fields_second || []; const rows = j.data_second_pass || [];
    const iN = fields.findIndex(f => /Object name/i.test(f)), iR = fields.findIndex(f => /RA/.test(f) && /hh/.test(f)), iD = fields.findIndex(f => /Dec/.test(f) && /dd/.test(f));
    const iV = fields.findIndex(f => /Visual magnitude/i.test(f)), iRa = fields.findIndex(f => /RA rate/i.test(f)), iDr = fields.findIndex(f => /Dec rate/i.test(f));
    for (const row of rows) out.push({
      name: row[iN], kind: kind === 'a' ? 'asteroid' : 'comet', ra: sexToDeg(row[iR], true), dec: sexToDeg(row[iD], false),
      vmag: iV >= 0 ? +row[iV] : null, raRate: iRa >= 0 ? +row[iRa] : null, decRate: iDr >= 0 ? +row[iDr] : null,
    });
  }
  return { ra, dec, mjd, halfDeg, count: out.length, bodies: out };
}

// JPL Horizons ephemeris for a named body (e.g. "3I", "Ceres", "2025 N1") between two MJDs.
export async function horizons(target, mjd0, mjd1, stepHours = 12) {
  const iso = m => mjdToDate(m).toISOString().slice(0, 16).replace('T', ' ');
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${target}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CENTER: "'500@399'",
    START_TIME: `'${iso(mjd0)}'`, STOP_TIME: `'${iso(mjd1)}'`, STEP_SIZE: `'${stepHours} h'`, QUANTITIES: "'1,9'", ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES',
  });
  const r = await fetch('https://ssd.jpl.nasa.gov/api/horizons.api?' + q, { headers: { 'User-Agent': 'BLINK-SPHEREx/0.1' } });
  if (!r.ok) throw new Error(`horizons HTTP ${r.status}`);
  const j = await r.json(); const txt = j.result || '';
  const a = txt.indexOf('$$SOE'), b = txt.indexOf('$$EOE'); if (a < 0 || b < 0) throw new Error('horizons: ' + txt.slice(0, 300));
  const lines = txt.slice(a + 5, b).trim().split('\n');
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const toMjd = (d) => { const m = /(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(d); return m ? Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]) / 86400000 + 40587 : NaN; };
  // CSV columns: date, sun-flag, moon-flag, RA, Dec, APmag, S-brt (blank fields kept)
  const pts = lines.map(l => { const c = l.split(',').map(s => s.trim()); return { mjd: toMjd(c[0]), date: c[0], ra: +c[3], dec: +c[4], mag: Number.isFinite(+c[5]) && c[5] !== '' ? +c[5] : null }; }).filter(p => Number.isFinite(p.ra) && Number.isFinite(p.mjd));
  const name = /Target body name:\s*(.+?)\s{2,}/.exec(txt)?.[1] || target;
  return { target: name, points: pts };
}

// CDS Sesame name resolver (SIMBAD/NED/VizieR) -> ra, dec
export async function resolveName(name) {
  const r = await fetch('https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?' + encodeURIComponent(name));
  const xml = await r.text();
  const ra = /<jradeg>([^<]+)<\/jradeg>/.exec(xml)?.[1], dec = /<jdedeg>([^<]+)<\/jdedeg>/.exec(xml)?.[1];
  if (!ra) return null;
  const oname = /<oname>([^<]+)<\/oname>/.exec(xml)?.[1] || name, otype = /<otype>([^<]+)<\/otype>/.exec(xml)?.[1] || '';
  return { name: oname, type: otype, ra: +ra, dec: +dec };
}

// Solar-system bodies aren't in Sesame: try Horizons for "now-ish" position instead.
export async function resolveAny(name, mjd) {
  const fixed = await resolveName(name).catch(() => null);
  if (fixed) return { ...fixed, moving: false };
  try {
    const m = mjd || (Date.now() / 86400000 + 40587);
    const h = await horizons(name, m, m + 0.5, 12);
    if (h.points.length) return { name: h.target, type: 'solar-system', ra: h.points[0].ra, dec: h.points[0].dec, moving: true };
  } catch {}
  return null;
}
