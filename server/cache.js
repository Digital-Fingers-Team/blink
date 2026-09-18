// Tiny disk cache: JSON or binary blobs keyed by a stable string, with TTL.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.env.BLINK_CACHE || path.resolve(process.cwd(), '../cache');

function file(ns, key, ext) {
  const h = createHash('sha1').update(key).digest('hex');
  return path.join(ROOT, ns, h.slice(0, 2), h + ext);
}

export async function cached(ns, key, ttlSec, produce, { binary = false } = {}) {
  const p = file(ns, key, binary ? '.bin' : '.json');
  try {
    const st = await stat(p);
    if (Date.now() - st.mtimeMs < ttlSec * 1000) {
      const buf = await readFile(p);
      return binary ? buf : JSON.parse(buf.toString('utf8'));
    }
  } catch {}
  const val = await produce();
  if (val && val.partial) return val; // transient upstream failure: do not cache
  try {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, binary ? val : JSON.stringify(val));
  } catch (e) { console.warn('cache write failed', e.message); }
  return val;
}
