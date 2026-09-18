// TAN (gnomonic) projection with SIP distortion, as used by SPHEREx Level-2 images.
// Conventions follow FITS WCS Papers I/II and the SIP convention (Shupe et al. 2005).
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

function sipPoly(h, prefix, order, u, v) {
  let s = 0;
  for (let p = 0; p <= order; p++) for (let q = 0; q <= order - p; q++) {
    const c = h[`${prefix}_${p}_${q}`]; if (c) s += c * Math.pow(u, p) * Math.pow(v, q);
  }
  return s;
}

export function makeWcs(h) {
  const crpix1 = h.CRPIX1, crpix2 = h.CRPIX2, crval1 = h.CRVAL1, crval2 = h.CRVAL2;
  const cd1 = h.CDELT1 ?? 1, cd2 = h.CDELT2 ?? 1;
  let m11, m12, m21, m22;
  if (h.CD1_1 !== undefined) { m11 = h.CD1_1; m12 = h.CD1_2 || 0; m21 = h.CD2_1 || 0; m22 = h.CD2_2; }
  else { m11 = (h.PC1_1 ?? 1) * cd1; m12 = (h.PC1_2 ?? 0) * cd1; m21 = (h.PC2_1 ?? 0) * cd2; m22 = (h.PC2_2 ?? 1) * cd2; }
  const det = m11 * m22 - m12 * m21;
  const i11 = m22 / det, i12 = -m12 / det, i21 = -m21 / det, i22 = m11 / det;
  const aOrd = h.A_ORDER || 0, bOrd = h.B_ORDER || 0, apOrd = h.AP_ORDER || 0, bpOrd = h.BP_ORDER || 0;
  const a0 = crval1 * D2R, d0 = crval2 * D2R, sd0 = Math.sin(d0), cd0 = Math.cos(d0);

  // pixel (1-based FITS x,y) -> [ra, dec] degrees
  function pix2sky(x, y) {
    let u = x - crpix1, v = y - crpix2;
    if (aOrd) { const f = sipPoly(h, 'A', aOrd, u, v), g = sipPoly(h, 'B', bOrd, u, v); u += f; v += g; }
    const xi = (m11 * u + m12 * v) * D2R, eta = (m21 * u + m22 * v) * D2R;
    const den = cd0 - eta * sd0;
    const ra = a0 + Math.atan2(xi, den);
    const dec = Math.atan2(sd0 + eta * cd0, Math.sqrt(xi * xi + den * den));
    let r = ra * R2D; r = ((r % 360) + 360) % 360;
    return [r, dec * R2D];
  }
  // [ra, dec] degrees -> pixel (1-based FITS x,y)
  function sky2pix(ra, dec) {
    const a = ra * D2R, d = dec * D2R, da = a - a0;
    const sd = Math.sin(d), cd = Math.cos(d), cda = Math.cos(da);
    const den = sd * sd0 + cd * cd0 * cda;
    if (den <= 0) return [NaN, NaN];
    const xi = (cd * Math.sin(da) / den) * R2D, eta = ((sd * cd0 - cd * sd0 * cda) / den) * R2D;
    let u = i11 * xi + i12 * eta, v = i21 * xi + i22 * eta;
    if (apOrd) { const f = sipPoly(h, 'AP', apOrd, u, v), g = sipPoly(h, 'BP', bpOrd, u, v); u += f; v += g; }
    return [u + crpix1, v + crpix2];
  }
  const scale = Math.sqrt(Math.abs(det)) * 3600; // arcsec / pixel
  return { pix2sky, sky2pix, scale, crval: [crval1, crval2] };
}

// Tangent plane helpers for the output (north-up, east-left) grid centred on (ra0, dec0).
export function tangentPlane(ra0, dec0) {
  const a0 = ra0 * D2R, d0 = dec0 * D2R, sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  return {
    // xi, eta in degrees -> ra, dec degrees
    toSky(xi, eta) {
      const x = xi * D2R, y = eta * D2R, den = cd0 - y * sd0;
      const ra = a0 + Math.atan2(x, den), dec = Math.atan2(sd0 + y * cd0, Math.sqrt(x * x + den * den));
      return [(((ra * R2D) % 360) + 360) % 360, dec * R2D];
    },
    fromSky(ra, dec) {
      const a = ra * D2R, d = dec * D2R, da = a - a0, sd = Math.sin(d), cd = Math.cos(d), cda = Math.cos(da);
      const den = sd * sd0 + cd * cd0 * cda;
      return [(cd * Math.sin(da) / den) * R2D, ((sd * cd0 - cd * sd0 * cda) / den) * R2D];
    }
  };
}

export function angSep(ra1, dec1, ra2, dec2) { // degrees
  const a1 = ra1 * D2R, d1 = dec1 * D2R, a2 = ra2 * D2R, d2 = dec2 * D2R;
  const s = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(s)) * R2D;
}
