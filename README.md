# BLINK — SPHEREx Time Machine

A public web tool that lines up every NASA SPHEREx exposure of any point on the sky and blinks them —
the way Clyde Tombaugh found Pluto in 1930, rebuilt for a billion objects in 102 infrared colours.

Built for the 2026 NASA Space Apps Challenge, *Planet X and SPHEREx*.

## What it does

* **All-sky map** — SPHEREx Quick Release 2 mosaics (CDS HiPS) in Aladin Lite. Click anywhere.
* **Time Machine** — IRSA's SIA2 service lists every SPHEREx exposure covering that point; pixels are
  read straight from NASA's open-data S3 bucket with HTTP range requests (no 71 MB downloads),
  reprojected north-up onto one grid, and blinked.
* **Difference imaging** — each frame minus the per-pixel median of all frames; static stars cancel,
  movers light up. Peaks ≥ 5σ are listed as detections.
* **Known-object check** — JPL's Small-Body Identification API labels every catalogued asteroid and
  comet in the field at the instant of each exposure. A mover without a label is either an artefact
  or something new.
* **Ephemeris tracks** — JPL Horizons predicts where a named body should be in every frame.
* **Spectrum** — SPHEREx's linear-variable filters see each target at a different wavelength on every
  exposure; aperture photometry across frames yields a 0.75–5 µm spectrum.
* **Missions** — interstellar comet 3I/ATLAS (comet-locked), the IRAS/AKARI Planet Nine candidate
  zone, asteroid Vesta, the variable star Mira, and the North Ecliptic Pole deep field.

## Layout

```
server/   Node 20 + Fastify. API + static hosting. No Python, no FITS library — a 140-line
          range-request FITS reader and a TAN-SIP WCS implementation.
  fits.js       header parsing, row-range reads, WCS-WAVE lookup table
  wcs.js        TAN + SIP (forward and inverse), tangent-plane helpers
  cutout.js     reprojected cutouts on a common grid
  sia.js        IRSA SIA2 client + visit grouping
  external.js   JPL sb_ident, JPL Horizons, CDS Sesame
  cache.js      disk cache with TTL
  index.js      routes
  build_3iatlas.js / build_mover.js / warm.js   mission data builders + cache warmer
web/      static front-end (ES modules, Aladin Lite v3 from CDS CDN)
  app.js        state, loading, playback, overlays, timeline, spectrum, report
  render.js     robust stats, stretches, colour maps, median stack, difference, peak finder
```

## API

| Route | Purpose |
|---|---|
| `GET /api/epochs?ra&dec[&collection=deep]` | all exposures covering a point, grouped into visits per band |
| `GET /api/cutout?key&ra&dec&n&scale` | reprojected cutout — `uint32 jsonLen, json, float32le[n*n]` |
| `GET /api/smallbodies?ra&dec&mjd&hw` | known asteroids/comets in the field at that time |
| `GET /api/horizons?target&mjd0&mjd1&step` | ephemeris track |
| `GET /api/resolve?name` | name → coordinates (Sesame, then Horizons) |

## Run

```
cd server && npm install && PORT=8790 node index.js
node build_3iatlas.js          # mission data from IRSA's 3I/ATLAS table
node build_mover.js Vesta vesta
node warm.js                   # pre-warm caches for the demo missions
```

## Data & credits

SPHEREx data: NASA/JPL-Caltech, processed at IPAC; served by IRSA and the AWS Open Data Program
(`s3://nasa-irsa-spherex`). HiPS mosaics: CDS, Strasbourg. Ephemerides and small-body identification:
NASA/JPL Solar System Dynamics. Name resolution: CDS Sesame. 3I/ATLAS observation table: IRSA.
Planet Nine candidate: Phan et al. 2025, PASA (arXiv:2504.17288).
