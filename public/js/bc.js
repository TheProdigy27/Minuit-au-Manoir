// Compression des photos pour la carte graphique, aux formats qu'elle lit directement (BC1 et BC5 de
// Direct3D, dits S3TC et RGTC en WebGL) : 4 à 8 fois moins de mémoire que des pixels bruts, et moins
// de données à lire à chaque pixel. Chaque bloc de 4 × 4 pixels garde deux valeurs extrêmes et, pour
// chaque pixel, une valeur prise entre elles.
//  BC1 (8 octets par bloc) : deux couleurs 5-6-5 et quatre teintes ; pour la couleur des photos.
//  BC5 (16 octets par bloc) : deux canaux indépendants, chacun avec huit niveaux ; pour le relief
//  (x et y de la normale, z se déduit) et pour l'occlusion et la rugosité.

// Toutes les étapes, d'une photo RGBA (lignes du haut vers le bas) à ses niveaux de mipmap compressés,
// rangés comme les veut WebGL (première ligne en bas). `kind` : 'color' (couleur sRGB, filtrée en
// lumière linéaire), 'normal' (normales renormalisées à chaque niveau) ou 'data' (canaux bruts).
export function compress(px, w, h, kind) {
  flip(px, w, h);
  const out = [];
  for (let level = { w, h, data: px }; ; level = half(level, kind)) {
    out.push({ width: level.w, height: level.h, data: kind === 'color' ? bc1(level.data, level.w, level.h) : bc5(level.data, level.w, level.h) });
    if (level.w === 1 && level.h === 1) return out;
  }
}

function flip(px, w, h) {
  const row = w * 4, tmp = new Uint8Array(row);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * row, b = (h - 1 - y) * row;
    tmp.set(px.subarray(a, a + row));
    px.copyWithin(a, b, b + row);
    px.set(tmp, b);
  }
}

const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const SRGB = new Uint8Array(4096).map((_, i) => {
  const c = i / 4095;
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
});

// Niveau suivant : moyenne de chaque carré de 2 × 2 pixels.
function half({ w, h, data }, kind) {
  const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1), out = new Uint8Array(W * H * 4);
  const dx = w > 1 ? 1 : 0, dy = h > 1 ? 1 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = ((y * 2) * w + x * 2) * 4, b = a + dx * 4, c = a + dy * w * 4, d = c + dx * 4, o = (y * W + x) * 4;
      if (kind === 'color') {
        for (let k = 0; k < 3; k++) out[o + k] = SRGB[Math.round(((LIN[data[a + k]] + LIN[data[b + k]] + LIN[data[c + k]] + LIN[data[d + k]]) / 4) * 4095)];
      } else if (kind === 'normal') {
        let nx = 0, ny = 0, nz = 0;
        for (const s of [a, b, c, d]) {
          nx += data[s] / 127.5 - 1;
          ny += data[s + 1] / 127.5 - 1;
          nz += data[s + 2] / 127.5 - 1;
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        out[o] = Math.round((nx / l + 1) * 127.5);
        out[o + 1] = Math.round((ny / l + 1) * 127.5);
        out[o + 2] = Math.round((nz / l + 1) * 127.5);
      } else {
        for (let k = 0; k < 3; k++) out[o + k] = (data[a + k] + data[b + k] + data[c + k] + data[d + k] + 2) >> 2;
      }
      out[o + 3] = 255;
    }
  }
  return { w: W, h: H, data: out };
}

// Les 16 pixels d'un bloc (répétés au bord des tout petits niveaux).
function gather(src, w, h, bx, by, dst) {
  for (let j = 0; j < 4; j++) {
    const y = Math.min(by + j, h - 1);
    for (let i = 0; i < 4; i++) {
      const s = (y * w + Math.min(bx + i, w - 1)) * 4, k = (j * 4 + i) * 4;
      dst[k] = src[s];
      dst[k + 1] = src[s + 1];
      dst[k + 2] = src[s + 2];
    }
  }
}

// --- BC1 -------------------------------------------------------------------

const e5 = v => (v << 3) | (v >> 2);
const e6 = v => (v << 2) | (v >> 4);

// Couleur unie : les deux extrêmes dont la teinte aux deux tiers tombe au plus près de chaque valeur.
const single = bits => {
  const n = 1 << bits, e = bits === 5 ? e5 : e6, table = [];
  for (let v = 0; v < 256; v++) {
    let best = [0, 0], err = Infinity;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const d = Math.abs((2 * e(a) + e(b)) / 3 - v);
        if (d < err) { err = d; best = [a, b]; }
      }
    }
    table.push(best);
  }
  return table;
};
let ONE5 = null, ONE6 = null;

const PIX = new Float32Array(64), PAL = new Float32Array(12), IDX = new Uint8Array(16);

export function bc1(src, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), out = new Uint8Array(bw * bh * 8);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) bc1Block(src, w, h, bx * 4, by * 4, out, (by * bw + bx) * 8);
  return out;
}

function pack565(r, g, b) {
  return (Math.round((Math.min(255, Math.max(0, r)) * 31) / 255) << 11) | (Math.round((Math.min(255, Math.max(0, g)) * 63) / 255) << 5) | Math.round((Math.min(255, Math.max(0, b)) * 31) / 255);
}

// Indices des 16 pixels pour les extrêmes c0 > c1 (quatre teintes) ; renvoie l'erreur totale.
function fit(c0, c1) {
  PAL[0] = e5(c0 >> 11); PAL[1] = e6((c0 >> 5) & 63); PAL[2] = e5(c0 & 31);
  PAL[3] = e5(c1 >> 11); PAL[4] = e6((c1 >> 5) & 63); PAL[5] = e5(c1 & 31);
  for (let k = 0; k < 3; k++) {
    PAL[6 + k] = (2 * PAL[k] + PAL[3 + k]) / 3;
    PAL[9 + k] = (PAL[k] + 2 * PAL[3 + k]) / 3;
  }
  let total = 0;
  for (let i = 0; i < 16; i++) {
    const r = PIX[i * 4], g = PIX[i * 4 + 1], b = PIX[i * 4 + 2];
    let best = 0, err = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = r - PAL[p * 3], dg = g - PAL[p * 3 + 1], db = b - PAL[p * 3 + 2], d = dr * dr + dg * dg + db * db;
      if (d < err) { err = d; best = p; }
    }
    IDX[i] = best;
    total += err;
  }
  return total;
}

function write1(out, o, c0, c1, idx) {
  out[o] = c0 & 255; out[o + 1] = c0 >> 8; out[o + 2] = c1 & 255; out[o + 3] = c1 >> 8;
  let bits = 0;
  for (let i = 15; i >= 0; i--) bits = (bits << 2) | idx[i];
  out[o + 4] = bits & 255; out[o + 5] = (bits >>> 8) & 255; out[o + 6] = (bits >>> 16) & 255; out[o + 7] = bits >>> 24;
}

function bc1Block(src, w, h, bx, by, out, o) {
  gather(src, w, h, bx, by, PIX);
  let mr = 0, mg = 0, mb = 0, lo = 255, hi = 0;
  for (let i = 0; i < 16; i++) {
    const r = PIX[i * 4], g = PIX[i * 4 + 1], b = PIX[i * 4 + 2];
    mr += r; mg += g; mb += b;
    lo = Math.min(lo, r, g, b);
    hi = Math.max(hi, r, g, b);
  }
  mr /= 16; mg /= 16; mb /= 16;
  let spread = 0;
  for (let i = 0; i < 16; i++) spread = Math.max(spread, Math.abs(PIX[i * 4] - mr), Math.abs(PIX[i * 4 + 1] - mg), Math.abs(PIX[i * 4 + 2] - mb));
  if (spread < 3) {
    // presque uni : la moyenne, au plus près
    ONE5 ??= single(5);
    ONE6 ??= single(6);
    const [ra, rb] = ONE5[Math.round(mr)], [ga, gb] = ONE6[Math.round(mg)], [ba, bb] = ONE5[Math.round(mb)];
    let c0 = (ra << 11) | (ga << 5) | ba, c1 = (rb << 11) | (gb << 5) | bb, k = 2;
    if (c0 < c1) { [c0, c1] = [c1, c0]; k = 3; }
    if (c0 === c1) k = 0;
    write1(out, o, c0, c1, IDX.fill(k));
    return;
  }
  // axe principal des couleurs du bloc (itérations de puissance sur la covariance)
  let rr = 0, rg = 0, rb = 0, gg = 0, gb = 0, bb = 0;
  for (let i = 0; i < 16; i++) {
    const r = PIX[i * 4] - mr, g = PIX[i * 4 + 1] - mg, b = PIX[i * 4 + 2] - mb;
    rr += r * r; rg += r * g; rb += r * b; gg += g * g; gb += g * b; bb += b * b;
  }
  let vr = rr >= gg && rr >= bb ? 1 : 0.5, vg = gg > rr && gg >= bb ? 1 : 0.5, vb = bb > rr && bb > gg ? 1 : 0.5;
  for (let k = 0; k < 6; k++) {
    const r = rr * vr + rg * vg + rb * vb, g = rg * vr + gg * vg + gb * vb, b = rb * vr + gb * vg + bb * vb;
    const l = Math.hypot(r, g, b) || 1;
    vr = r / l; vg = g / l; vb = b / l;
  }
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < 16; i++) {
    const t = (PIX[i * 4] - mr) * vr + (PIX[i * 4 + 1] - mg) * vg + (PIX[i * 4 + 2] - mb) * vb;
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  let c0 = pack565(mr + vr * tmax, mg + vg * tmax, mb + vb * tmax), c1 = pack565(mr + vr * tmin, mg + vg * tmin, mb + vb * tmin);
  if (c0 < c1) [c0, c1] = [c1, c0];
  if (c0 === c1) {
    // les deux extrêmes tombent sur la même couleur 5-6-5 : on les écarte d'un cran
    if (c0 < 0xffff) c0++; else c1--;
  }
  let err = fit(c0, c1);
  const best = IDX.slice();
  // affinage : extrêmes recalculés au plus près des pixels pour ces indices (moindres carrés)
  const W0 = [1, 0, 2 / 3, 1 / 3];
  let aa = 0, ab = 0, bbw = 0, ar = 0, ag = 0, ab2 = 0, br = 0, bg = 0, bb2 = 0;
  for (let i = 0; i < 16; i++) {
    const a = W0[IDX[i]], b = 1 - a, r = PIX[i * 4], g = PIX[i * 4 + 1], bl = PIX[i * 4 + 2];
    aa += a * a; ab += a * b; bbw += b * b;
    ar += a * r; ag += a * g; ab2 += a * bl;
    br += b * r; bg += b * g; bb2 += b * bl;
  }
  const det = aa * bbw - ab * ab;
  if (Math.abs(det) > 1e-6) {
    const k0 = (x, y) => (x * bbw - y * ab) / det, k1 = (x, y) => (y * aa - x * ab) / det;
    let d0 = pack565(k0(ar, br), k0(ag, bg), k0(ab2, bb2)), d1 = pack565(k1(ar, br), k1(ag, bg), k1(ab2, bb2));
    if (d0 < d1) [d0, d1] = [d1, d0];
    if (d0 !== d1) {
      const e = fit(d0, d1);
      if (e < err) {
        err = e;
        c0 = d0;
        c1 = d1;
        best.set(IDX);
      }
    }
  }
  write1(out, o, c0, c1, best);
}

// --- BC4 / BC5 -------------------------------------------------------------

export function bc5(src, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), out = new Uint8Array(bw * bh * 16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      gather(src, w, h, bx * 4, by * 4, PIX);
      const o = (by * bw + bx) * 16;
      bc4Block(0, out, o);
      bc4Block(1, out, o + 8);
    }
  }
  return out;
}

// Un canal : les extrêmes min et max, et huit niveaux régulièrement espacés entre eux.
function bc4Block(ch, out, o) {
  let lo = 255, hi = 0;
  for (let i = 0; i < 16; i++) {
    const v = PIX[i * 4 + ch];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  out[o] = hi;
  out[o + 1] = lo;
  let bits0 = 0, bits1 = 0;
  if (hi > lo) {
    for (let i = 15; i >= 0; i--) {
      const s = Math.round(((PIX[i * 4 + ch] - lo) * 7) / (hi - lo)), idx = s === 7 ? 0 : s === 0 ? 1 : 8 - s;
      if (i >= 8) bits1 = (bits1 << 3) | idx;
      else bits0 = (bits0 << 3) | idx;
    }
  }
  out[o + 2] = bits0 & 255; out[o + 3] = (bits0 >> 8) & 255; out[o + 4] = (bits0 >> 16) & 255;
  out[o + 5] = bits1 & 255; out[o + 6] = (bits1 >> 8) & 255; out[o + 7] = (bits1 >> 16) & 255;
}
