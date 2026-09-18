# BLINK — SPHEREx Time Machine · Pitch kit

## One line
In 1930 Clyde Tombaugh found Pluto by blinking two photographic plates. BLINK rebuilds that machine for NASA SPHEREx — a billion objects, 102 colours, the whole sky every six months — and hands it to anyone with a browser.

## 30-second story (video opening)
1. *Black screen, a click.* "Pluto was found with this sound — a blink comparator flicking between two plates."
2. *Cut to BLINK, 3I/ATLAS mission playing.* "SPHEREx re-images every point of the sky every six months. Anything that moves or changes between visits gives itself away."
3. *Click Difference.* "Static stars cancel. Movers light up. JPL tells us which ones are already known —"
4. *Point at an unlabeled box.* "— and which ones aren't."
5. *Click anywhere on the sky map.* "Every point of the sky. Every SPHEREx exposure ever taken of it. In three seconds."

## Demo script (3 minutes)
| t | Action | Say |
|---|---|---|
| 0:00 | Open on `#m=3iatlas`, playing | "An interstellar comet, locked in the centre, while our Galaxy streams past. These are raw SPHEREx pixels, read straight from NASA's open-data bucket." |
| 0:30 | Switch band D3 → D6, point at λ label | "Every exposure sees the target at a different infrared colour — that's how SPHEREx builds spectra. The spectrum panel fills in as frames load." |
| 0:50 | Mission **Asteroid** (Vesta), then **Difference** | "Vesta crosses the field. The cyan diamond is JPL's prediction; the red blob is the asteroid. The green circles are the *other* asteroids JPL knows about in this field — every one labelled." |
| 1:20 | Mission **Planet 9 zone** | "Phan et al. 2025 found a candidate that moved between IRAS (1983) and AKARI (2006). We extrapolated its motion to 2025. This is that patch of sky in SPHEREx — 66 exposures, three seasons. Nobody had blinked it before." |
| 1:50 | Mission **Mira**, Difference | "Not only movers: Mira's brightness changes between visits, and the difference image says so." |
| 2:10 | Click a random spot on the sky map | "And it works everywhere: IRSA finds every exposure, we reproject them north-up on one grid, and blink." |
| 2:35 | **Copy discovery report** | "Anyone who sees something can produce a report with coordinates, epochs, photometry and the JPL cross-match — ready for a follow-up request or the Minor Planet Center." |
| 2:50 | About dialog | "Open source, no downloads, no logins. Data: NASA/JPL-Caltech, IRSA, AWS Open Data, CDS, JPL SSD." |

## How it maps to the judging criteria
- **Impact** — turns a petabyte-scale expert archive into a public discovery tool; the time-domain gap is real (IRSA's own Source Discovery Tool has no epoch comparison).
- **Creativity** — blink comparator + difference imaging + JPL cross-match + wavelength-aware spectrum in one screen; comet-locked view; Planet Nine candidate zone.
- **Validity** — reads NASA's Level-2 FITS directly (range requests), full TAN-SIP WCS, WCS-WAVE lookup for per-pixel wavelength, median-template subtraction with photometric matching, JPL SBDB identification. Everything traceable: each frame links to its IRSA file.
- **Relevance** — the challenge asks for a public web tool showing SPHEREx images and how they change over time. That is exactly the product.
- **Presentation** — Tombaugh story, five one-click missions, a live site.

## Numbers to quote
- SPHEREx: launched March 2025, 6 detectors × 17 channels = 102 bands, 0.75–5 µm, 6.15″ pixels, whole sky every ~6 months, QR2 data released weekly by IRSA.
- A single exposure file is 71 MB; BLINK reads ~0.3–2 MB of it per cutout.
- First load of a target: ~3–10 s for 40–90 exposures (cached afterwards).

## Honest limitations (say them before the judges do)
- Difference imaging across exposures at different wavelengths leaves residuals on bright stars; the detector suppresses residuals sitting on template sources, but bright-star cores still show. "Match wavelength" narrows the blink to similar-λ frames.
- Geocentric ephemerides (SPHEREx is in low Earth orbit): known-object positions can be off by a pixel or two for near-Earth objects.
- QR2 is a quick-release calibration; the mission's full release will improve photometry.

## Links to put in the submission
- Live: https://blink.pricelens.work.gd
- Code: (push `~/blink` to GitHub before submitting)
- Data credits: NASA/JPL-Caltech SPHEREx via IRSA (10.26131/IRSA652) and AWS Open Data; CDS HiPS; NASA/JPL SSD Horizons & SBDB; CDS Sesame; IRSA 3I/ATLAS observation table; Phan et al. 2025 (arXiv:2504.17288).
