// Smoke test: WCS round-trip on a real file, epoch listing, and a cutout with timing.
import { openCached, makeCutout } from './cutout.js';
import { listEpochs, groupVisits } from './sia.js';

const ref = 'qr2/level2/2025W19_2B/l2b-v20-2025-247/3/level2_2025W19_2B_0073_2D3_spx_l2b-v20-2025-247.fits';
let t = Date.now();
const f = await openCached(ref);
console.log('open:', Date.now() - t, 'ms  nx,ny', f.nx, f.ny, 'scale', f.wcs.scale.toFixed(3), '"/px  CRVAL', f.wcs.crval);
// WCS round trip
for (const [x, y] of [[1020.5, 1020.5], [1, 1], [2040, 2040], [100, 1900]]) {
  const [ra, dec] = f.wcs.pix2sky(x, y); const [x2, y2] = f.wcs.sky2pix(ra, dec);
  console.log(`pix(${x},${y}) -> ${ra.toFixed(5)},${dec.toFixed(5)} -> pix(${x2.toFixed(3)},${y2.toFixed(3)})`);
}
// Cutout at image centre
t = Date.now();
const c = await makeCutout(ref, f.wcs.crval[0], f.wcs.crval[1], 96, 6.15);
let finite = 0, sum = 0, mx = -Infinity; for (const v of c.data) if (Number.isFinite(v)) { finite++; sum += v; if (v > mx) mx = v; }
console.log('cutout:', Date.now() - t, 'ms  finite', finite, 'mean', (sum / finite).toFixed(4), 'max', mx.toFixed(3), 'meta', JSON.stringify(c.meta));
// Epoch listing for a test position
t = Date.now();
const ep = await listEpochs(127.69444, -39.17760);
console.log('epochs:', Date.now() - t, 'ms  count', ep.count);
const v = groupVisits(ep.epochs);
for (const [b, vs] of Object.entries(v)) console.log(b, vs.map(x => `${x.exposures.length}@${x.mjdStart.toFixed(1)}`).join(' '));
console.log('first:', JSON.stringify(ep.epochs[0]));
