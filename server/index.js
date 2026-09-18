// BLINK — SPHEREx Time Machine — API + static server
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEpochs, groupVisits } from './sia.js';
import { makeCutout, packCutout } from './cutout.js';
import { cached } from './cache.js';
import { smallBodies, horizons, resolveAny } from './external.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8790;
const app = Fastify({ logger: { level: 'info' } });

app.register(fastifyStatic, { root: path.join(__dirname, '..', 'web'), prefix: '/', cacheControl: true, maxAge: '1h' });

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const bad = (rep, msg) => rep.code(400).send({ error: msg });

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

// All SPHEREx QR2 exposures covering a sky position, grouped into visits per detector band.
app.get('/api/epochs', async (req, rep) => {
  const ra = num(req.query.ra), dec = num(req.query.dec);
  if (ra === undefined || dec === undefined || ra < 0 || ra >= 360 || Math.abs(dec) > 90) return bad(rep, 'ra/dec required');
  const collection = req.query.collection === 'deep' ? 'spherex_qr2_deep' : 'spherex_qr2';
  const key = `${collection}|${ra.toFixed(5)}|${dec.toFixed(5)}`;
  const data = await cached('epochs', key, 6 * 3600, () => listEpochs(ra, dec, { collection }));
  return { ...data, visits: groupVisits(data.epochs) };
});

// One reprojected cutout (binary: uint32 jsonLen, json meta, float32le pixels)
app.get('/api/cutout', async (req, rep) => {
  const key = req.query.key, ra = num(req.query.ra), dec = num(req.query.dec);
  const n = Math.min(256, Math.max(16, num(req.query.n, 128) | 0)), scale = Math.min(60, Math.max(2, num(req.query.scale, 6.15)));
  if (!key || !/^qr2?\/level2\/[\w\-\/\.]+\.fits$/.test(key)) return bad(rep, 'key must be a SPHEREx level2 S3 key');
  if (!(ra >= 0 && ra < 360 && Math.abs(dec) <= 90)) return bad(rep, 'ra/dec required');
  const ck = `${key}|${ra.toFixed(6)}|${dec.toFixed(6)}|${n}|${scale}`;
  const buf = await cached('cutout', ck, 30 * 86400, async () => packCutout(await makeCutout(key, ra, dec, n, scale)), { binary: true });
  rep.header('Content-Type', 'application/octet-stream').header('Cache-Control', 'public, max-age=86400');
  return buf;
});

// Known asteroids/comets in the field at the time of an exposure (JPL SBDB identification)
app.get('/api/smallbodies', async (req, rep) => {
  const ra = num(req.query.ra), dec = num(req.query.dec), mjd = num(req.query.mjd), hw = Math.min(2, Math.max(0.02, num(req.query.hw, 0.15)));
  if (!(ra >= 0 && ra < 360 && Math.abs(dec) <= 90) || !mjd) return bad(rep, 'ra/dec/mjd required');
  const key = `${ra.toFixed(4)}|${dec.toFixed(4)}|${mjd.toFixed(3)}|${hw}`;
  return cached('sb', key, 30 * 86400, () => smallBodies(ra, dec, mjd, hw));
});

// Ephemeris track for a named solar-system body
app.get('/api/horizons', async (req, rep) => {
  const target = String(req.query.target || '').slice(0, 40), mjd0 = num(req.query.mjd0), mjd1 = num(req.query.mjd1), step = num(req.query.step, 12);
  if (!target || !mjd0 || !mjd1 || mjd1 < mjd0 || mjd1 - mjd0 > 800) return bad(rep, 'target/mjd0/mjd1 required (<800 d)');
  const key = `${target}|${mjd0.toFixed(2)}|${mjd1.toFixed(2)}|${step}`;
  return cached('hz', key, 7 * 86400, () => horizons(target, mjd0, mjd1, step));
});

// Name -> coordinates (fixed objects via Sesame, solar-system via Horizons)
app.get('/api/resolve', async (req, rep) => {
  const name = String(req.query.name || '').trim().slice(0, 80); if (!name) return bad(rep, 'name required');
  const r = await cached('name', name.toLowerCase(), 7 * 86400, async () => (await resolveAny(name, num(req.query.mjd))) || { error: 'not found' });
  if (r.error) return rep.code(404).send(r);
  return r;
});

app.setErrorHandler((err, req, rep) => { req.log.error(err); rep.code(err.statusCode || 500).send({ error: err.message }); });

app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' }).then(() => console.log('BLINK listening on', PORT));
