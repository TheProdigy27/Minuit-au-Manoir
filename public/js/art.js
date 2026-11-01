// Dessins procéduraux : le plan du manoir vu de dessus, qui sert aussi de motif au sol et au dessus
// des meubles, puis les motifs des murs, des meubles, des décors et des effets. Les matières
// photographiées (materials.js) leur ajoutent ensuite grain, relief et rugosité.
import { TILE } from '/shared/config.js';
import { tileAt } from '/shared/physics.js';
import { mulberry32 } from '/shared/map.js';

export const TS = 48; // pixels par case du plan
export const PX = 128; // unités de dessin par mètre des murs et des meubles (une case = un mètre)
const RES = 2; // pixels par unité de dessin des murs et des meubles
export const TAU = Math.PI * 2;
export const FONT = '"IM Fell English", Georgia, serif';
export const TITLE = 'Creepster, "IM Fell English", Georgia, serif';

export const STYLE = {
  foyer: { floor: 'checker', a: '#4c3e35', b: '#2e2622', wall: '#4a2f3a', trim: '#5e3f2a' },
  library: { floor: 'wood', a: '#5a3d27', b: '#4a3220', wall: '#2f4434', trim: '#4f3523' },
  dining: { floor: 'parquet', a: '#5c3a22', b: '#4b2f1c', wall: '#5a2c2c', trim: '#5f3c22' },
  bedroom: { floor: 'carpet', a: '#4a2b3d', b: '#3f2434', wall: '#41395a', trim: '#4f3c2c' },
  kitchen: { floor: 'checker', a: '#6a675e', b: '#34322d', wall: '#5a5240', trim: '#3f3d34' },
  chapel: { floor: 'stone', a: '#4d4b52', b: '#3e3c44', wall: '#3d3550', trim: '#2c2636' },
  crypt: { floor: 'stone', a: '#3e4440', b: '#313633', wall: '#323833', trim: '#232825' },
  salon: { floor: 'wood', a: '#5c3826', b: '#4c2e1f', wall: '#5a2a3a', trim: '#653f25' },
  gallery: { floor: 'marble', a: '#5c5a62', b: '#4c4a52', wall: '#46334a', trim: '#5a432d' },
  storage: { floor: 'planks', a: '#4f4230', b: '#433827', wall: '#454030', trim: '#353023' },
  bath: { floor: 'tiles', a: '#5f6e6a', b: '#4d5a56', wall: '#46605c', trim: '#34443f' },
  conservatory: { floor: 'stone', a: '#43543c', b: '#374632', wall: '#33493b', trim: '#26362b' },
  nursery: { floor: 'wood', a: '#5e4632', b: '#503b29', wall: '#5a4a66', trim: '#6a5642' },
  lab: { floor: 'tiles', a: '#3b4a40', b: '#2f3c34', wall: '#304a3d', trim: '#223329' },
};
const BOOKS = ['#5a1f1f', '#2f3f5a', '#3f5a2f', '#5a4a1f', '#4a2f5a', '#6a5a4a', '#2a2a2a'];
const POTIONS = ['#3fbf5f', '#8f3fbf', '#bf3f3f', '#3f8fbf', '#bfaf3f'];

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

export function circle(c, x, y, r, color) {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

// `read` : toile relue pixel par pixel (getImageData), dessinée alors en mémoire plutôt que par la carte graphique.
function canvas(w, h, read = false) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return [cv, cv.getContext('2d', { willReadFrequently: read })];
}

// Toile `s` fois plus fine que les coordonnées de dessin w × h.
function fine(w, h, s) {
  const [cv, c] = canvas(w * s, h * s);
  c.scale(cv.width / w, cv.height / h);
  return [cv, c];
}

// Relief d'un motif : sa luminosité, adoucie, sert de hauteur (les traits sombres sont des creux,
// les ornements clairs des bosses). Renvoie une toile de normales (convention OpenGL).
export function normalFromCanvas(cv, strength = 3, blur = 2) {
  const w = cv.width, h = cv.height, n = w * h;
  const src = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let H = new Float32Array(n), T = new Float32Array(n);
  for (let i = 0; i < n; i++) H[i] = ((src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255) * (src[i * 4 + 3] / 255);
  for (let k = 0; k < blur; k++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      T[i] = (H[i] * 2 + H[y * w + Math.max(0, x - 1)] + H[y * w + Math.min(w - 1, x + 1)]) / 4;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      H[i] = (T[i] * 2 + T[Math.max(0, y - 1) * w + x] + T[Math.min(h - 1, y + 1) * w + x]) / 4;
    }
  }
  const [out, c] = canvas(w, h);
  const img = c.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const dx = H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)];
      const dy = H[y1 + x] - H[y0 + x];
      const nx = -dx * strength, ny = dy * strength, len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      d[i] = (nx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return out;
}

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const wallish = t => t === TILE.WALL || t === TILE.VOID || t === TILE.EXIT;

// ---------------------------------------------------------------------------
// Plan vu de dessus
// ---------------------------------------------------------------------------

function drawFloor(c, x, y, st, rnd, tx, ty) {
  const S = TS;
  switch (st.floor) {
    case 'checker':
      c.fillStyle = (tx + ty) % 2 ? st.a : st.b;
      c.fillRect(x, y, S, S);
      break;
    case 'wood':
    case 'planks': {
      const n = st.floor === 'wood' ? 3 : 2, ph = S / n;
      for (let i = 0; i < n; i++) {
        c.fillStyle = shade(i % 2 ? st.a : st.b, (rnd() - 0.5) * 0.14);
        c.fillRect(x, y + i * ph, S, ph);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(x, y + i * ph, S, 1.5);
        c.fillRect(x + (((tx * 7 + i * 13 + ty * 3) % 4) * S) / 4, y + i * ph, 1.5, ph);
      }
      break;
    }
    case 'parquet': {
      c.fillStyle = st.a;
      c.fillRect(x, y, S, S);
      const horiz = (tx + ty) % 2 === 0;
      for (let i = 0; i < 4; i++) {
        c.fillStyle = shade(i % 2 ? st.a : st.b, (rnd() - 0.5) * 0.1);
        if (horiz) c.fillRect(x, y + (i * S) / 4, S, S / 4 - 1.5); else c.fillRect(x + (i * S) / 4, y, S / 4 - 1.5, S);
      }
      break;
    }
    case 'stone': {
      c.fillStyle = 'rgba(10,10,12,1)';
      c.fillRect(x, y, S, S);
      const hs = S / 2, off = ty % 2 ? hs / 2 : 0;
      for (let i = -1; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          c.fillStyle = shade((i + j) % 2 ? st.a : st.b, (rnd() - 0.5) * 0.2);
          const bx = Math.max(x, x + i * hs + off + 1.5), bw = Math.min(x + S, x + (i + 1) * hs + off - 1.5) - bx;
          if (bw > 0) c.fillRect(bx, y + j * hs + 1.5, bw, hs - 3);
        }
      }
      break;
    }
    case 'marble':
      c.fillStyle = (tx + ty) % 2 ? st.a : st.b;
      c.fillRect(x, y, S, S);
      c.strokeStyle = 'rgba(255,255,255,0.07)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + rnd() * S, y);
      c.quadraticCurveTo(x + rnd() * S, y + S / 2, x + rnd() * S, y + S);
      c.stroke();
      break;
    case 'carpet':
      c.fillStyle = st.a;
      c.fillRect(x, y, S, S);
      c.fillStyle = 'rgba(0,0,0,0.14)';
      c.beginPath();
      c.moveTo(x + S / 2, y + 6);
      c.lineTo(x + S - 6, y + S / 2);
      c.lineTo(x + S / 2, y + S - 6);
      c.lineTo(x + 6, y + S / 2);
      c.closePath();
      c.fill();
      break;
    case 'tiles': {
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(x, y, S, S);
      const q = S / 2;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          c.fillStyle = shade((i + j) % 2 ? st.a : st.b, (rnd() - 0.5) * 0.1);
          c.fillRect(x + i * q + 1, y + j * q + 1, q - 2, q - 2);
        }
      }
      break;
    }
  }
  for (let i = 0; i < 3; i++) {
    c.fillStyle = rnd() < 0.6 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.035)';
    c.beginPath();
    c.arc(x + rnd() * S, y + rnd() * S, 1 + rnd() * 3, 0, TAU);
    c.fill();
  }
}

function splat(c, x, y, r, rnd, color = 'rgba(105,5,15,0.8)') {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, d = r * (0.8 + rnd() * 1.1), s = r * (0.12 + rnd() * 0.3);
    c.beginPath();
    c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, TAU);
    c.fill();
  }
}

function candle(c, x, y) {
  circle(c, x, y, 5, '#3a2a1a');
  circle(c, x, y, 3.5, '#e8dfc8');
  circle(c, x + 1, y + 3, 1.5, '#d8cfb8');
}

function candelabra(c, x, y) {
  circle(c, x, y, 10, '#8a6a2a');
  circle(c, x, y, 7, '#b08a3a');
  for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6]]) candle(c, x + dx, y + dy);
}

// Objets ronds ou fins : pas d'ombre carrée au sol sous leur modèle 3D.
const ROUND = new Set(['pumpkin', 'candelabra', 'rockinghorse', 'plant', 'barrel', 'cauldron', 'fountain', 'pedestal', 'coffin', 'piano']);

function drawFurniture(c, f, rnd) {
  const S = TS, x = f.x * S, y = f.y * S, w = f.w * S, h = f.h * S, m = 4;
  const cx = x + w / 2, cy = y + h / 2;
  c.save();
  if (!ROUND.has(f.k)) {
    c.fillStyle = 'rgba(0,0,0,0.45)';
    rr(c, x + 4, y + 6, w - 3, h - 3, 6);
    c.fill();
  }
  switch (f.k) {
    case 'shelf':
    case 'potions': {
      c.fillStyle = '#2b1b10';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      const vert = f.h > f.w, len = vert ? h : w, thick = vert ? w : h;
      for (let row = 0; row < 2; row++) {
        const across = 6 + (row * (thick - 12)) / 2, depth = (thick - 16) / 2;
        for (let p = 6; p < len - 8;) {
          const s = 3 + rnd() * 4, d = depth - rnd() * 3;
          if (f.k === 'potions') {
            c.fillStyle = POTIONS[Math.floor(rnd() * POTIONS.length)];
            c.beginPath();
            c.arc(vert ? x + across + d / 2 : x + p + s, vert ? y + p + s : y + across + d / 2, Math.min(s, d / 2), 0, TAU);
            c.fill();
            p += s * 2 + 3;
          } else {
            c.fillStyle = BOOKS[Math.floor(rnd() * BOOKS.length)];
            if (vert) c.fillRect(x + across, y + p, d, s); else c.fillRect(x + p, y + across, s, d);
            p += s + 1;
          }
        }
      }
      c.strokeStyle = '#4b3020';
      c.lineWidth = 3;
      c.strokeRect(x + 3, y + 3, w - 6, h - 6);
      break;
    }
    case 'table':
    case 'sidetable':
    case 'nightstand':
    case 'lowtable':
    case 'worktable':
    case 'dresser':
    case 'longtable': {
      c.fillStyle = f.k === 'worktable' ? '#3e3226' : '#4a2e1c';
      rr(c, x + m, y + m, w - 2 * m, h - 2 * m, 5);
      c.fill();
      c.strokeStyle = '#2a190e';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = 'rgba(255,230,200,0.05)';
      for (let i = 1; i < 3; i++) c.fillRect(x + m, y + m + (i * (h - 2 * m)) / 3, w - 2 * m, 1.5);
      if (f.k === 'longtable') {
        c.fillStyle = 'rgba(110,15,25,0.75)';
        c.fillRect(x + m + 8, cy - 9, w - 2 * m - 16, 18);
        if (f.plates) {
          for (let i = 0; i < f.w; i++) {
            for (const py of [y + 14, y + h - 14]) { circle(c, x + i * S + S / 2, py, 7, '#cfc8b8'); circle(c, x + i * S + S / 2, py, 4, '#8a8070'); }
          }
        }
      }
      if (f.k === 'dresser') {
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(cx - 1, y + m, 2, h - 2 * m);
        circle(c, cx - 8, cy, 2, '#b08a3a');
        circle(c, cx + 8, cy, 2, '#b08a3a');
      }
      if (f.flasks) {
        for (let i = 0; i < 4; i++) circle(c, x + 12 + (i * (w - 24)) / 3, cy + (i % 2 ? 5 : -5), 5, POTIONS[i]);
      }
      break;
    }
    case 'bed': {
      c.fillStyle = '#3a2416';
      rr(c, x + 2, y + 2, w - 4, h - 4, 4);
      c.fill();
      c.fillStyle = '#cfc6b4';
      rr(c, x + 6, y + 6, w - 12, h - 12, 6);
      c.fill();
      c.fillStyle = '#e8e0d0';
      rr(c, x + 10, y + 9, w - 20, S * 0.42, 6);
      c.fill();
      c.fillStyle = f.c || '#5a1e2e';
      rr(c, x + 6, y + S * 0.85, w - 12, h - S * 0.85 - 6, 4);
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.2)';
      c.fillRect(x + 6, y + S * 0.85, w - 12, 4);
      if (f.blood) splat(c, cx, y + h * 0.55, 13, rnd);
      break;
    }
    case 'wardrobe':
    case 'cabinet': {
      c.fillStyle = '#2e1c0e';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = '#452a16';
      c.fillRect(x + 5, y + 5, w - 10, h - 10);
      break;
    }
    case 'counter':
    case 'island': {
      c.fillStyle = '#3c3a34';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.fillStyle = '#67635a';
      c.fillRect(x + 4, y + 4, w - 8, h - 8);
      c.fillStyle = '#7a5a3a';
      c.fillRect(x + 10, y + 10, 22, 14);
      c.fillStyle = '#c8c8c8';
      c.fillRect(x + 38, y + 15, 20, 3);
      c.fillStyle = '#3a2a1a';
      c.fillRect(x + 56, y + 14, 8, 5);
      circle(c, x + w - 18, cy, 10, '#1c1c1c');
      circle(c, x + w - 18, cy, 6, '#3a1a10');
      if (rnd() < 0.6) splat(c, x + 26, cy + 6, 6, rnd);
      break;
    }
    case 'stove': {
      c.fillStyle = '#1a1a1c';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      c.strokeStyle = '#4a4a4a';
      c.lineWidth = 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(x + w * (0.27 + i * 0.46), y + h * (0.3 + j * 0.4), 7, 0, TAU); c.stroke(); }
      break;
    }
    case 'barrel': {
      const r = S * 0.38;
      circle(c, cx, cy, r, '#5a3a1e');
      c.strokeStyle = '#24160b';
      c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.62, 0, TAU); c.stroke();
      break;
    }
    case 'crate':
    case 'crates': {
      c.fillStyle = '#6a5232';
      c.fillRect(x + 3, y + 3, w - 6, h - 6);
      break;
    }
    case 'pew': {
      c.fillStyle = '#3e2414';
      c.fillRect(x + 2, y + 10, w - 4, h - 16);
      c.fillStyle = '#2a170c';
      c.fillRect(x + 2, y + h - 12, w - 4, 6);
      c.fillRect(x + 2, y + 10, 5, h - 16);
      c.fillRect(x + w - 7, y + 10, 5, h - 16);
      break;
    }
    case 'altar': {
      c.fillStyle = '#4a4650';
      c.fillRect(x + 2, y + 4, w - 4, h - 8);
      c.fillStyle = '#6a1020';
      c.fillRect(x + w * 0.25, y + 4, w * 0.5, h - 8);
      circle(c, cx, cy, 5, '#c9a040');
      break;
    }
    case 'statue': {
      c.fillStyle = '#45454b';
      c.fillRect(x + 4, y + 4, w - 8, h - 8);
      c.fillStyle = '#6f6f76';
      c.beginPath(); c.ellipse(cx - 11, cy - 1, 5, 12, -0.5, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(cx + 11, cy - 1, 5, 12, 0.5, 0, TAU); c.fill();
      c.fillStyle = '#8a8a90';
      c.beginPath(); c.ellipse(cx, cy + 4, 12, 8, 0, 0, TAU); c.fill();
      circle(c, cx, cy - 3, 7, '#9c9ca2');
      break;
    }
    case 'pedestal': {
      c.fillStyle = '#45454b';
      c.fillRect(x + 8, y + 8, w - 16, h - 16);
      circle(c, cx, cy, 9, '#2a3a5a');
      break;
    }
    case 'clock': {
      c.fillStyle = '#2a170c';
      c.fillRect(x + 8, y + 3, w - 16, h - 6);
      break;
    }
    case 'coffin': {
      c.translate(cx, cy);
      if (f.w > f.h) c.rotate(Math.PI / 2);
      const L = Math.max(w, h) / 2 - 4, W = Math.min(w, h) / 2 - 6;
      c.fillStyle = '#3a2216';
      c.beginPath();
      c.moveTo(-W * 0.6, -L); c.lineTo(W * 0.6, -L); c.lineTo(W, -L * 0.45);
      c.lineTo(W * 0.7, L); c.lineTo(-W * 0.7, L); c.lineTo(-W, -L * 0.45);
      c.closePath();
      c.fill();
      c.strokeStyle = '#5e3c28';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#8a7a5a';
      c.fillRect(-1.5, -L * 0.55, 3, L * 0.95);
      c.fillRect(-W * 0.4, -L * 0.3, W * 0.8, 3);
      break;
    }
    case 'sarcophagus': {
      c.fillStyle = '#4d4c4a';
      c.fillRect(x + 3, y + 3, w - 6, h - 6);
      c.fillStyle = '#626160';
      c.fillRect(x + 9, y + 9, w - 18, h - 18);
      circle(c, cx, y + 22, 9, '#777673');
      c.fillStyle = '#6d6c69';
      c.beginPath(); c.ellipse(cx, cy + 10, 12, 24, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - 10, cy); c.lineTo(cx + 10, cy + 8); c.moveTo(cx + 10, cy); c.lineTo(cx - 10, cy + 8); c.stroke();
      break;
    }
    case 'fireplace': {
      c.fillStyle = '#5a5458';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      break;
    }
    case 'sofa':
    case 'armchair': {
      const col = '#5a1424';
      c.fillStyle = shade(col, -0.35);
      rr(c, x + 3, y + 3, w - 6, h - 6, 8);
      c.fill();
      c.fillStyle = col;
      rr(c, x + 9, y + 6, w - 18, h - 16, 6);
      c.fill();
      break;
    }
    case 'piano': {
      c.fillStyle = '#0c0a0c';
      c.beginPath();
      c.moveTo(x + 4, y + 4);
      c.lineTo(x + w - 4, y + 4);
      c.quadraticCurveTo(x + w - 4, y + h - 4, x + w * 0.45, y + h - 4);
      c.quadraticCurveTo(x + 4, y + h - 4, x + 4, y + h * 0.6);
      c.closePath();
      c.fill();
      c.strokeStyle = '#3a3a3a';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#ddd6c6';
      c.fillRect(x + 6, y + 6, w - 12, 10);
      c.fillStyle = '#111';
      for (let i = 0; i < 14; i++) if (i % 7 !== 2 && i % 7 !== 6) c.fillRect(x + 9 + (i * (w - 18)) / 14, y + 6, 3, 6);
      break;
    }
    case 'bench': {
      c.fillStyle = '#4a3020';
      c.fillRect(x + 3, y + 12, w - 6, h - 24);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      for (let i = 1; i < 3; i++) c.fillRect(x + 3, y + 12 + (i * (h - 24)) / 3, w - 6, 1.5);
      break;
    }
    case 'bathtub': {
      c.fillStyle = '#d8d4cc';
      rr(c, x + 3, y + 5, w - 6, h - 10, 14);
      c.fill();
      c.fillStyle = f.blood ? '#5a0610' : '#3a4a48';
      rr(c, x + 9, y + 10, w - 18, h - 20, 10);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(x + 14, y + 13, w * 0.3, 3);
      break;
    }
    case 'sink': {
      c.fillStyle = '#d8d4cc';
      rr(c, x + 6, y + 6, w - 12, h - 12, 8);
      c.fill();
      circle(c, cx, cy + 2, 10, '#5a6260');
      break;
    }
    case 'fountain': {
      circle(c, cx, cy, Math.min(w, h) / 2 - 3, '#5a5a5e');
      circle(c, cx, cy, Math.min(w, h) / 2 - 10, '#16222a');
      circle(c, cx, cy, 8, '#6a6a6e');
      c.strokeStyle = 'rgba(160,190,220,0.15)';
      c.lineWidth = 1.5;
      for (const r of [20, 30]) { c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); }
      break;
    }
    case 'deadtree': {
      circle(c, cx, cy, S * 0.42, '#2a2018');
      c.strokeStyle = '#3d2c1f';
      c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = rnd() * TAU, l = S * (0.45 + rnd() * 0.25);
        const mx = cx + Math.cos(a) * l * 0.5, my = cy + Math.sin(a) * l * 0.5;
        c.lineWidth = 4;
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(mx, my); c.lineTo(cx + Math.cos(a + 0.4) * l, cy + Math.sin(a + 0.4) * l); c.stroke();
      }
      break;
    }
    case 'plant': {
      circle(c, cx, cy, 13, '#7a3e22');
      circle(c, cx, cy, 10, '#2a1c12');
      break;
    }
    case 'crib': {
      c.fillStyle = '#5a4030';
      c.fillRect(x + 4, y + 6, w - 8, h - 12);
      c.fillStyle = '#c8bca8';
      c.fillRect(x + 9, y + 10, w - 18, h - 20);
      c.fillStyle = '#9a6a7a';
      rr(c, x + w * 0.45, y + 12, w * 0.4, h - 24, 4);
      c.fill();
      break;
    }
    case 'rockinghorse':
      break;
    case 'toychest': {
      c.fillStyle = '#6a4a2a';
      c.fillRect(x + 4, y + 6, w - 8, h - 12);
      c.fillStyle = '#8a5a2a';
      c.fillRect(x + 4, y + 6, w - 8, 8);
      c.fillStyle = '#b08a3a';
      c.fillRect(cx - 4, cy - 2, 8, 6);
      break;
    }
    case 'cauldron': {
      circle(c, cx, cy, Math.min(w, h) / 2 - 6, '#141214');
      circle(c, cx, cy, Math.min(w, h) / 2 - 12, '#2a2a2a');
      break;
    }
    case 'pumpkin':
    case 'candelabra':
      break;
    default:
      c.fillStyle = '#4a3a2a';
      c.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
  }
  c.restore();
}

function drawDecal(c, d, rnd) {
  const S = TS, x = d.x * S, y = d.y * S;
  c.save();
  switch (d.k) {
    case 'rug':
    case 'runner': {
      const w = d.w * S, h = d.h * S;
      c.fillStyle = d.c;
      c.fillRect(x + 4, y + 4, w - 8, h - 8);
      c.strokeStyle = 'rgba(200,160,80,0.35)';
      c.lineWidth = 3;
      c.strokeRect(x + 10, y + 10, w - 20, h - 20);
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 1.5;
      c.strokeRect(x + 16, y + 16, w - 32, h - 32);
      break;
    }
    case 'circle': {
      const w = d.w * S, cx = x + w / 2, cy = y + w / 2, r = w / 2 - 6;
      c.strokeStyle = 'rgba(230,230,220,0.28)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      c.beginPath(); c.arc(cx, cy, r - 10, 0, TAU); c.stroke();
      c.beginPath();
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + ((i * 2) % 5) * (TAU / 5);
        const px = cx + Math.cos(a) * (r - 10), py = cy + Math.sin(a) * (r - 10);
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.stroke();
      break;
    }
    case 'blood':
      splat(c, x, y, 10 * d.s, rnd, 'rgba(95,4,12,0.75)');
      break;
    case 'steps': {
      c.translate(x, y);
      c.rotate(d.r);
      c.fillStyle = 'rgba(95,4,12,0.6)';
      c.beginPath(); c.ellipse(-4, -5, 6, 3, 0, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(4, 5, 6, 3, 0, 0, TAU); c.fill();
      break;
    }
    case 'bones': {
      c.translate(x, y);
      c.rotate(d.r);
      c.strokeStyle = '#8f846e';
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.beginPath(); c.moveTo(-9, 0); c.lineTo(9, 0); c.moveTo(-4, -6); c.lineTo(6, 7); c.stroke();
      for (const [bx, by] of [[-9, 0], [9, 0], [-4, -6], [6, 7]]) circle(c, bx, by, 2.5, '#8f846e');
      break;
    }
    case 'chair':
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(x - 9, y - 9, 18, 18);
      break;
    case 'candles':
      candle(c, x - 5, y + 2);
      candle(c, x + 5, y + 3);
      candle(c, x, y - 5);
      break;
    case 'doll': {
      c.translate(x, y);
      c.rotate(d.r);
      c.fillStyle = '#7a3a4a';
      c.beginPath(); c.ellipse(0, 6, 6, 9, 0, 0, TAU); c.fill();
      circle(c, 0, -6, 7, '#e8dccc');
      circle(c, -2.5, -7, 1.6, '#111');
      circle(c, 2.5, -7, 1.6, '#111');
      c.strokeStyle = '#5a1010';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(-2, -3); c.lineTo(2, -3); c.stroke();
      break;
    }
    case 'blocks':
      c.translate(x, y);
      c.rotate(d.r);
      for (const [bx, by, col] of [[-7, 0, '#8a2a2a'], [3, -4, '#2a5a8a'], [0, 6, '#8a7a2a']]) { c.fillStyle = col; c.fillRect(bx - 4, by - 4, 8, 8); }
      break;
    case 'scratch': {
      c.translate(x, y);
      c.rotate(d.r);
      c.strokeStyle = 'rgba(0,0,0,0.45)';
      c.lineWidth = 2;
      for (let i = -1.5; i <= 1.5; i++) { c.beginPath(); c.moveTo(i * 6 - 4, -14); c.quadraticCurveTo(i * 6 + 2, 0, i * 6 - 2, 14); c.stroke(); }
      break;
    }
  }
  c.restore();
}

function drawWall(c, map, tx, ty, st) {
  const S = TS, x = tx * S, y = ty * S;
  if (!wallish(tileAt(map, tx, ty + 1))) {
    c.fillStyle = '#17121c';
    c.fillRect(x, y, S, S * 0.18);
    c.fillStyle = st.wall;
    c.fillRect(x, y + S * 0.18, S, S * 0.82);
    c.fillStyle = st.trim;
    c.fillRect(x, y + S * 0.66, S, S * 0.34);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(x, y + S * 0.66, S, 2);
    c.fillRect(x, y + S - 3, S, 3);
  } else {
    c.fillStyle = '#17121c';
    c.fillRect(x, y, S, S);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    if (!wallish(tileAt(map, tx - 1, ty))) c.fillRect(x, y, 2, S);
    if (!wallish(tileAt(map, tx + 1, ty))) c.fillRect(x + S - 2, y, 2, S);
    if (!wallish(tileAt(map, tx, ty - 1))) c.fillRect(x, y, S, 2);
  }
}

function drawExitDoor(c, ex) {
  const x = ex.x * TS, y = ex.y * TS, w = ex.w * TS, h = ex.h * TS;
  c.fillStyle = '#2a170c';
  c.fillRect(x - 6, y, w + 12, h);
  c.fillStyle = '#4a2c16';
  c.fillRect(x, y + 4, w, h - 8);
  c.fillStyle = '#000';
  c.fillRect(x + w / 2 - 1, y + 4, 2, h - 8);
}

// Escalier vu de dessus : marches de plus en plus claires vers le haut. Sur l'étage du dessus, sa
// moitié basse est la trémie, plongée dans le noir.
function drawStairs(c, s) {
  const S = TS, n = 16, step = (s.len * S) / n, y = s.y * S, h = s.wid * S;
  for (let i = 0; i < n; i++) {
    const x = s.dx > 0 ? s.x * S + i * step : (s.x + s.len) * S - (i + 1) * step;
    const hole = !s.up && i < n / 2;
    c.fillStyle = hole ? '#07060a' : shade('#5a3c26', -0.45 + (0.7 * i) / n);
    c.fillRect(x, y, step, h);
    if (hole) continue;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(s.dx > 0 ? x : x + step - 2, y, 2, h);
    c.fillStyle = 'rgba(110,20,30,0.75)'; // tapis
    c.fillRect(x, y + h * 0.19, step, h * 0.62);
  }
}

// Teinte moyenne de deux couleurs.
export function blend(a, b) {
  const p = s => parseInt(s.slice(1), 16), x = p(a), y = p(b);
  const m = sh => Math.round((((x >> sh) & 255) + ((y >> sh) & 255)) / 2);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

// Le plan complet, `k` fois plus fin que TS pixels par case (sol, tapis, taches, dessus des meubles).
// `flat` : version posée sur le sol en 3D, d'une teinte unie par pièce (la matière photographiée y
// dessine carreaux et lattes) et sans les tapis, qui ont leur propre volume.
export function buildPlan(map, k = 1, flat = false) {
  const [cv, c] = canvas(map.w * TS * k, map.h * TS * k);
  c.setTransform(k, 0, 0, k, 0, 0);
  const rnd = mulberry32(map.seed ^ 0x5eed);
  const theme = (x, y) => STYLE[themeNear(map, x, y)];
  c.fillStyle = '#07060a';
  c.fillRect(0, 0, map.w * TS, map.h * TS);

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (wallish(tileAt(map, x, y))) continue;
      const st = theme(x, y);
      if (flat) {
        c.fillStyle = blend(st.a, st.b);
        c.fillRect(x * TS, y * TS, TS, TS);
      } else drawFloor(c, x * TS, y * TS, st, rnd, x, y);
    }
  }
  for (const d of map.decals) if (d.k === 'circle' || (!flat && (d.k === 'rug' || d.k === 'runner'))) drawDecal(c, d, rnd);
  for (const d of map.decals) if (d.k !== 'rug' && d.k !== 'runner' && d.k !== 'circle' && d.k !== 'web') drawDecal(c, d, rnd);

  // Pied des murs plus sombre
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (wallish(tileAt(map, x, y))) continue;
      const px = x * TS, py = y * TS;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (!wallish(tileAt(map, x + dx, y + dy))) continue;
        const g = dy
          ? c.createLinearGradient(0, py + (dy > 0 ? TS : 0), 0, py + TS / 2)
          : c.createLinearGradient(px + (dx > 0 ? TS : 0), 0, px + TS / 2, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.5)');
        g.addColorStop(0.5, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(px, py, TS, TS);
      }
    }
  }

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) if (tileAt(map, x, y) === TILE.WALL) drawWall(c, map, x, y, theme(x, y + 1));
  }
  for (const f of map.furniture) drawFurniture(c, f, rnd);
  for (const s of map.stairs) drawStairs(c, s);
  if (map.exit) drawExitDoor(c, map.exit);
  return cv;
}

// Thème de la pièce à laquelle appartient une case (les portes et les murs prennent celui d'une voisine).
export function themeNear(map, x, y) {
  for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
    const r = map.roomIdx[ty * map.w + tx];
    if (r >= 0) return map.rooms[r].theme;
  }
  return 'foyer';
}

// ---------------------------------------------------------------------------
// Murs et plafond (textures vues en face, PX pixels par mètre)
// ---------------------------------------------------------------------------

function motif(c, x, y) {
  c.beginPath();
  c.moveTo(x, y - 10);
  c.quadraticCurveTo(x + 6, y - 2, x, y + 7);
  c.quadraticCurveTo(x - 6, y - 2, x, y - 10);
  c.fill();
  for (const s of [-1, 1]) {
    c.beginPath();
    c.ellipse(x + s * 7, y + 1, 5, 2.2, s * 0.7, 0, TAU);
    c.fill();
  }
  c.fillRect(x - 6, y + 7, 12, 2);
}

function paperWall(c, W, H, st, theme) {
  const Y = m => H - m * PX;
  const tiled = theme === 'kitchen' || theme === 'bath' || theme === 'lab';
  const rail = tiled ? 1.3 : 0.95;
  c.fillStyle = st.wall;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(0,0,0,0.13)';
  for (let x = 0; x < W; x += 32) c.fillRect(x + 13, 0, 6, H);
  c.fillStyle = shade(st.wall, 0.18);
  for (let y = 40, row = 0; y < Y(rail) - 10; y += 44, row++) {
    for (let x = row % 2 ? 0 : 32; x <= W; x += 64) motif(c, x, y);
  }
  // corniche
  c.fillStyle = '#17121c';
  c.fillRect(0, 0, W, 12);
  c.fillStyle = shade(st.trim, -0.25);
  c.fillRect(0, 12, W, 7);
  c.fillStyle = 'rgba(255,255,255,0.07)';
  c.fillRect(0, 19, W, 2);
  const top = Y(rail);
  if (tiled) {
    const col = STYLE[theme].a;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(0, top, W, H - top);
    for (let y = top, row = 0; y < H; y += 32, row++) {
      for (let x = 0; x < W; x += 32) {
        c.fillStyle = shade(col, ((x + y * 3) % 5) * 0.03 + (row % 2 ? 0.05 : 0));
        c.fillRect(x + 1.5, y + 1.5, 29, 29);
      }
    }
    c.fillStyle = shade(col, -0.3);
    c.fillRect(0, top - 5, W, 8);
  } else {
    // lambris
    c.fillStyle = st.trim;
    c.fillRect(0, top, W, H - top);
    const pb = Y(0.22);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(12, top + 14, W - 24, pb - top - 20);
    c.fillStyle = shade(st.trim, 0.1);
    c.fillRect(16, top + 18, W - 32, pb - top - 28);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(16, top + 18, W - 32, 2);
    c.fillStyle = shade(st.trim, -0.35);
    c.fillRect(0, top - 5, W, 9);
    c.fillStyle = 'rgba(255,255,255,0.09)';
    c.fillRect(0, top - 5, W, 2);
  }
  // plinthe
  c.fillStyle = shade(st.trim, -0.5);
  c.fillRect(0, Y(0.14), W, H - Y(0.14));
  c.fillStyle = 'rgba(255,255,255,0.05)';
  c.fillRect(0, Y(0.14), W, 2);
}

// Mur de pierre : la photographie dessine les blocs ; ici la teinte, l'humidité qui remonte et la mousse.
function stoneWall(c, W, H, st, rnd) {
  c.fillStyle = blend(st.wall, '#4a4642');
  c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, H * 0.5, 0, H);
  g.addColorStop(0, 'rgba(8,12,6,0)');
  g.addColorStop(1, 'rgba(8,12,6,0.5)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    if (rnd() < 0.5) continue;
    const x = rnd() * W, y = H * (0.55 + rnd() * 0.4), r = 12 + rnd() * 26;
    const m = c.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, 'rgba(50,80,30,0.35)');
    m.addColorStop(1, 'rgba(50,80,30,0)');
    c.fillStyle = m;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function grime(c, W, H, rnd, v) {
  for (let i = 0; i < 4; i++) {
    const x = rnd() * W, y = rnd() * H * 0.5, len = 40 + rnd() * 180;
    const g = c.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, y, 2 + rnd() * 5, len);
  }
  for (let i = 0; i < 2; i++) {
    const x = rnd() * W, y = H * (0.3 + rnd() * 0.6), r = 15 + rnd() * 35;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(20,15,5,0.28)');
    g.addColorStop(1, 'rgba(20,15,5,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (v === 1) {
    // papier décollé
    c.fillStyle = 'rgba(0,0,0,0.35)';
    const x = 20 + rnd() * 50, y = 40 + rnd() * 80;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 40, y + 6); c.lineTo(x + 26, y + 50); c.lineTo(x + 4, y + 36); c.closePath(); c.fill();
    c.fillStyle = 'rgba(230,210,180,0.15)';
    c.beginPath(); c.moveTo(x + 40, y + 6); c.lineTo(x + 52, y + 26); c.lineTo(x + 26, y + 50); c.closePath(); c.fill();
  } else if (v === 2) {
    // griffures ou main sanglante
    if (rnd() < 0.5) {
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 3;
      const x = 30 + rnd() * 60, y = H * 0.35;
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(x + i * 9, y); c.quadraticCurveTo(x + i * 9 + 8, y + 60, x + i * 9 + 2, y + 120); c.stroke(); }
    } else {
      const x = 40 + rnd() * 40, y = H * (0.45 + rnd() * 0.15);
      c.fillStyle = 'rgba(100,6,14,0.75)';
      c.beginPath(); c.ellipse(x, y, 11, 13, 0, 0, TAU); c.fill();
      for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(x - 9 + i * 6, y - 18 - (i % 3) * 3, 2.6, 8, (i - 1.5) * 0.15, 0, TAU); c.fill(); }
      c.beginPath(); c.ellipse(x + 13, y - 2, 2.6, 7, 0.9, 0, TAU); c.fill();
      c.fillRect(x - 2, y + 8, 3, 40);
    }
  }
}

// Murs d'une pièce : trois variantes côte à côte, chacune large d'une case et haute du sol au plafond.
// Renvoie le motif et son relief, pris avant les salissures (qui n'en ont pas).
export function wallAtlas(theme, height) {
  const st = STYLE[theme] || STYLE.foyer;
  const W = PX, H = Math.round(PX * height);
  const [cv, c] = fine(W * 3, H, RES);
  const rnd = mulberry32(hash(theme));
  const stone = theme === 'crypt' || theme === 'chapel';
  const each = draw => {
    for (let v = 0; v < 3; v++) {
      c.save();
      c.translate(v * W, 0);
      c.beginPath();
      c.rect(0, 0, W, H);
      c.clip();
      draw(v);
      c.restore();
    }
  };
  each(() => (stone ? stoneWall(c, W, H, st, rnd) : paperWall(c, W, H, st, theme)));
  const bump = stone ? null : normalFromCanvas(cv, 3, 2);
  each(v => grime(c, W, H, rnd, v));
  return { color: cv, bump };
}

// ---------------------------------------------------------------------------
// Côtés des meubles
// ---------------------------------------------------------------------------

// Fond uni des côtés en pierre : la photographie y met le grain et les joints.
function stoneBase(c, W, H) {
  c.fillStyle = '#4c4a48';
  c.fillRect(0, 0, W, H);
}

function doorPanel(c, x, y, w, h, base) {
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(x, y, w, h);
  c.fillStyle = shade(base, 0.12);
  c.fillRect(x + 4, y + 4, w - 8, h - 8);
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(x + 4, y + 4, w - 8, 2);
}

function shelves(c, W, H, rnd, step, item) {
  c.fillStyle = '#140c07';
  c.fillRect(0, 0, W, H);
  for (let base = H - 14; base > step * 0.6; base -= step) {
    for (let x = 7; x < W - 8;) x = item(c, x, base, step, rnd);
    c.fillStyle = '#4b3020';
    c.fillRect(0, base, W, 8);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, base + 8, W, 3);
  }
  c.fillStyle = '#3a2416';
  c.fillRect(0, 0, W, 12);
  c.fillStyle = '#2b1b10';
  c.fillRect(0, 0, 6, H);
  c.fillRect(W - 6, 0, 6, H);
}

const SIDES = {
  potions(c, W, H, rnd) {
    shelves(c, W, H, rnd, 0.4 * PX, (c, x, base, step, rnd) => {
      const r = 4 + rnd() * 6;
      if (x + r * 2 > W - 8) return W;
      if (rnd() < 0.15) return x + 12;
      c.fillStyle = 'rgba(200,220,210,0.3)';
      c.fillRect(x + r - 2, base - r * 2 - 9, 4, 10);
      c.fillStyle = POTIONS[Math.floor(rnd() * POTIONS.length)];
      if (rnd() < 0.5) { c.beginPath(); c.arc(x + r, base - r, r, 0, TAU); c.fill(); } else c.fillRect(x, base - r * 2.2, r * 2, r * 2.2);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(x + r * 0.5, base - r * 1.6, 2, r * 0.7);
      return x + r * 2 + 4;
    });
  },
  wardrobe(c, W, H) {
    c.fillStyle = '#24160b';
    c.fillRect(0, 0, W, H);
    doorPanel(c, 10, 24, W - 20, (H - 60) * 0.55, '#452a16');
    doorPanel(c, 10, 30 + (H - 60) * 0.55, W - 20, (H - 60) * 0.45 - 6, '#452a16');
    c.fillStyle = '#b08a3a';
    c.fillRect(W - 24, H * 0.5 - 10, 5, 18);
    c.fillStyle = '#1a1008';
    c.fillRect(0, 0, W, 14);
    c.fillRect(0, H - 20, W, 20);
  },
  cabinet(c, W, H, rnd) {
    c.fillStyle = '#24160b';
    c.fillRect(0, 0, W, H);
    const gh = H * 0.5;
    c.fillStyle = '#0c1014';
    c.fillRect(12, 20, W - 24, gh);
    for (let y = 20 + gh / 3; y < 20 + gh; y += gh / 3) {
      c.fillStyle = '#3a2416';
      c.fillRect(12, y - 3, W - 24, 4);
      for (let x = 18; x < W - 30; x += 22) { circle(c, x + 9, y - 12, 9, '#a8a090'); circle(c, x + 9, y - 12, 5, rnd() < 0.3 ? '#5a1010' : '#7a7468'); }
    }
    c.strokeStyle = '#3a2416';
    c.lineWidth = 3;
    c.strokeRect(12, 20, W - 24, gh);
    c.beginPath(); c.moveTo(W / 2, 20); c.lineTo(W / 2, 20 + gh); c.stroke();
    doorPanel(c, 12, gh + 30, W - 24, H - gh - 52, '#452a16');
    c.fillStyle = '#b08a3a';
    c.fillRect(W / 2 - 8, gh + 50, 4, 10);
    c.fillRect(W / 2 + 4, gh + 50, 4, 10);
  },
  drawers(c, W, H) {
    c.fillStyle = '#2a190e';
    c.fillRect(0, 0, W, H);
    const n = H > 0.8 * PX ? 3 : 2, dh = (H - 24) / n;
    for (let i = 0; i < n; i++) {
      doorPanel(c, 8, 12 + i * dh, W - 16, dh - 6, '#4a2e1c');
      c.fillStyle = '#b08a3a';
      c.fillRect(W / 2 - 10, 12 + i * dh + dh / 2 - 5, 20, 4);
    }
  },
  kitchen(c, W, H) {
    c.fillStyle = '#2c2a26';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#67635a';
    c.fillRect(0, 0, W, 10);
    doorPanel(c, 8, 18, W / 2 - 12, H - 36, '#4a463e');
    doorPanel(c, W / 2 + 4, 18, W / 2 - 12, H - 36, '#4a463e');
    c.fillStyle = '#9a9a9a';
    c.fillRect(W / 2 - 12, 30, 4, 14);
    c.fillRect(W / 2 + 8, 30, 4, 14);
    c.fillStyle = '#141412';
    c.fillRect(0, H - 14, W, 14);
  },
  stove(c, W, H) {
    c.fillStyle = '#18181a';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#2a2a2c';
    c.fillRect(10, 22, W - 20, H - 48);
    c.strokeStyle = '#5a5a5a';
    c.lineWidth = 3;
    c.strokeRect(10, 22, W - 20, H - 48);
    c.fillStyle = '#7a7a7a';
    c.fillRect(24, 32, W - 48, 5);
    const g = c.createLinearGradient(0, H - 40, 0, H - 22);
    g.addColorStop(0, 'rgba(255,120,30,0)');
    g.addColorStop(1, 'rgba(255,120,30,0.9)');
    c.fillStyle = g;
    c.fillRect(16, H - 40, W - 32, 14);
    c.fillStyle = '#0a0a0a';
    for (let x = 18; x < W - 18; x += 10) c.fillRect(x, H - 40, 3, 14);
  },
  crate(c, W, H) {
    c.fillStyle = '#5a4428';
    c.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 24) { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, y, W, 2); }
    c.strokeStyle = '#3a2a16';
    c.lineWidth = 10;
    c.strokeRect(5, 5, W - 10, H - 10);
    c.beginPath(); c.moveTo(8, 8); c.lineTo(W - 8, H - 8); c.stroke();
    c.fillStyle = '#7a7060';
    for (const [x, y] of [[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]]) circle(c, x, y, 2.5, '#7a7060');
  },
  barrel(c, W, H) {
    for (let x = 0; x < W; x += 16) {
      c.fillStyle = shade('#5a3a1e', ((x / 16) % 3) * 0.08 - 0.08);
      c.fillRect(x, 0, 15, H);
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.fillRect(x + 15, 0, 1, H);
    }
    for (const y of [0.12, 0.35, 0.65, 0.88]) {
      c.fillStyle = '#24160b';
      c.fillRect(0, H * y - 5, W, 10);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(0, H * y - 5, W, 2);
    }
  },
  // flanc de sarcophage : moulures, panneau creusé orné d'une croix, lettres effacées
  tomb(c, W, H) {
    stoneBase(c, W, H);
    const groove = (x, y, w, h, t) => {
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(x, y, w, t);
      c.fillRect(x, y, t, h);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(x, y + h - t, w, t);
      c.fillRect(x + w - t, y, t, h);
    };
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(0, 0, W, 8);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, 8, W, 3);
    c.fillRect(0, H - 14, W, 3);
    groove(10, 18, W - 20, H - 40, 3);
    groove(18, 26, W - 36, H - 56, 2);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(W / 2 - 3, 34, 6, H - 76);
    c.fillRect(W / 2 - 18, 46, 36, 6);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fillRect(W / 2 + 3, 34, 2, H - 76);
    c.fillRect(W / 2 - 18, 52, 36, 2);
    // salissures : terre remontée du sol, coulures
    const g = c.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(20,16,10,0)');
    g.addColorStop(1, 'rgba(20,16,10,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const x = 8 + ((i * 37) % (W - 16));
      const d = c.createLinearGradient(0, 10, 0, 10 + H * 0.5);
      d.addColorStop(0, 'rgba(15,12,8,0.3)');
      d.addColorStop(1, 'rgba(15,12,8,0)');
      c.fillStyle = d;
      c.fillRect(x, 10, 3 + (i % 3) * 2, H * 0.5);
    }
  },
  altar(c, W, H, rnd) {
    stoneBase(c, W, H);
    c.fillStyle = '#6a1020';
    c.fillRect(W * 0.18, 0, W * 0.64, H * 0.8);
    c.fillStyle = '#c9a040';
    c.fillRect(W * 0.18, H * 0.8 - 6, W * 0.64, 6);
    c.fillRect(W / 2 - 3, H * 0.15, 6, H * 0.45);
    c.fillRect(W / 2 - 16, H * 0.27, 32, 6);
    for (let x = W * 0.18; x < W * 0.82; x += 8) { c.fillStyle = '#c9a040'; c.fillRect(x, H * 0.8, 3, 10); }
  },
  clock(c, W, H) {
    c.fillStyle = '#2a170c';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#3e2416';
    c.fillRect(8, 8, W - 16, H - 16);
    const cy = H * 0.16, r = W * 0.32;
    circle(c, W / 2, cy, r + 5, '#b08a3a');
    circle(c, W / 2, cy, r, '#d8ccb0');
    c.fillStyle = '#111';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      c.fillRect(W / 2 + Math.cos(a) * r * 0.82 - 1.5, cy + Math.sin(a) * r * 0.82 - 1.5, 3, 3);
    }
    c.strokeStyle = '#111';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(W / 2, cy); c.lineTo(W / 2, cy - r * 0.7); c.moveTo(W / 2, cy); c.lineTo(W / 2 + r * 0.45, cy + r * 0.2); c.stroke();
    c.fillStyle = '#0a0806';
    c.fillRect(W * 0.28, H * 0.34, W * 0.44, H * 0.5);
    c.strokeStyle = '#8a6a2a';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(W / 2, H * 0.36); c.lineTo(W / 2, H * 0.7); c.stroke();
    circle(c, W / 2, H * 0.72, 10, '#b08a3a');
  },
  fireplace(c, W, H, rnd) {
    stoneBase(c, W, H);
    c.fillStyle = '#080404';
    c.beginPath();
    c.moveTo(W * 0.14, H);
    c.lineTo(W * 0.14, H * 0.42);
    c.quadraticCurveTo(W / 2, H * 0.22, W * 0.86, H * 0.42);
    c.lineTo(W * 0.86, H);
    c.fill();
    const g = c.createLinearGradient(0, H * 0.75, 0, H);
    g.addColorStop(0, 'rgba(255,90,20,0)');
    g.addColorStop(1, 'rgba(255,90,20,0.85)');
    c.fillStyle = g;
    c.fillRect(W * 0.14, H * 0.75, W * 0.72, H * 0.25);
    for (let i = 0; i < 12; i++) circle(c, W * 0.2 + rnd() * W * 0.6, H - 4 - rnd() * 12, 2 + rnd() * 3, 'rgba(255,140,40,0.9)');
  },
  crib(c, W, H) {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#6a4a36';
    c.fillRect(0, 0, W, 10);
    c.fillRect(0, H * 0.55, W, 8);
    for (let x = 2; x < W; x += 16) c.fillRect(x, 0, 5, H);
  },
  toy(c, W, H) {
    c.fillStyle = '#6a4a2a';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#8a5a2a';
    c.fillRect(0, 0, W, 12);
    for (let i = 0; i < 5; i++) {
      const x = 14 + i * 24, y = H * 0.55 + (i % 2 ? -10 : 8);
      c.fillStyle = ['#c8a040', '#a04040', '#4070a0'][i % 3];
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 4 : 9;
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      c.fill();
    }
  },
  door(c, W, H) {
    c.fillStyle = '#2a170c';
    c.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += W / 5) {
      c.fillStyle = shade('#4a2c16', ((x / (W / 5)) % 2) * 0.08);
      c.fillRect(x + 2, 0, W / 5 - 3, H);
    }
    c.fillStyle = '#151515';
    for (const y of [0.12, 0.5, 0.86]) c.fillRect(0, H * y, W, 12);
    for (const y of [0.12, 0.5, 0.86]) for (let x = 10; x < W; x += 24) circle(c, x, H * y + 6, 3, '#3a3a3a');
    circle(c, W - 22, H * 0.55, 8, '#151515');
    circle(c, W - 22, H * 0.55, 5, '#5a4a2a');
  },
};

// Côté d'un meuble : un mètre de large, toute sa hauteur `h` (en mètres).
export function sideTexture(kind, h) {
  const [cv, c] = fine(PX, PX * h, RES);
  SIDES[kind](c, PX, PX * h, mulberry32(hash(kind)));
  return cv;
}

// ---------------------------------------------------------------------------
// Décors muraux, vus de face
// ---------------------------------------------------------------------------

export function windowTexture(moon) {
  const [cv, c] = fine(96, 176, 3);
  const g = c.createLinearGradient(0, 0, 0, 176);
  g.addColorStop(0, '#2a3a6a');
  g.addColorStop(1, '#0a1028');
  c.fillStyle = g;
  c.fillRect(0, 0, 96, 176);
  if (moon) {
    const m = c.createRadialGradient(62, 40, 0, 62, 40, 40);
    m.addColorStop(0, 'rgba(230,235,255,0.5)');
    m.addColorStop(1, 'rgba(230,235,255,0)');
    c.fillStyle = m;
    c.fillRect(0, 0, 96, 100);
    circle(c, 62, 40, 11, '#e6ebff');
    circle(c, 58, 37, 2.5, 'rgba(150,160,190,0.6)');
  }
  // branches nues et pluie
  c.strokeStyle = '#05060c';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, 150); c.quadraticCurveTo(30, 120, 44, 70); c.moveTo(22, 118); c.lineTo(6, 96); c.moveTo(36, 96); c.lineTo(58, 82); c.stroke();
  c.strokeStyle = 'rgba(160,180,230,0.12)';
  c.lineWidth = 1;
  for (let i = 0; i < 30; i++) { const x = (i * 37) % 96, y = (i * 53) % 176; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 9); c.stroke(); }
  // croisillons et cadre
  c.fillStyle = '#1e1008';
  c.fillRect(0, 0, 96, 7);
  c.fillRect(0, 169, 96, 7);
  c.fillRect(0, 0, 7, 176);
  c.fillRect(89, 0, 7, 176);
  c.fillRect(45, 0, 6, 176);
  c.fillRect(0, 60, 96, 5);
  c.fillRect(0, 116, 96, 5);
  return cv;
}

export function paintingTexture(v) {
  const [cv, c] = fine(80, 100, 5);
  c.fillStyle = '#8a6a2a';
  c.fillRect(0, 0, 80, 100);
  c.fillStyle = '#5a4418';
  c.fillRect(4, 4, 72, 92);
  c.fillStyle = '#b08a3a';
  c.fillRect(7, 7, 66, 86);
  c.fillStyle = '#1a1416';
  c.fillRect(10, 10, 60, 80);
  const cx = 40, cy = 48;
  if (v === 0) {
    // portrait aux yeux vides
    c.fillStyle = '#2a1e22';
    c.beginPath(); c.ellipse(cx, cy + 32, 24, 18, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#c8bca8';
    c.beginPath(); c.ellipse(cx, cy - 4, 12, 16, 0, 0, TAU); c.fill();
    c.fillStyle = '#2a1a14';
    c.beginPath(); c.ellipse(cx, cy - 14, 13, 9, 0, Math.PI, 0); c.fill();
    circle(c, cx - 5, cy - 4, 3, '#000');
    circle(c, cx + 5, cy - 4, 3, '#000');
    c.fillStyle = 'rgba(90,0,10,0.8)';
    c.fillRect(cx - 5.5, cy - 2, 1.5, 10);
    c.fillRect(cx + 4.5, cy - 2, 1.5, 7);
  } else if (v === 1) {
    // le manoir sous la lune
    const g = c.createLinearGradient(0, 10, 0, 90);
    g.addColorStop(0, '#1a2440');
    g.addColorStop(1, '#2a1a20');
    c.fillStyle = g;
    c.fillRect(10, 10, 60, 80);
    circle(c, 54, 26, 6, '#d8d0b0');
    c.fillStyle = '#0a0a0a';
    c.beginPath(); c.moveTo(10, 90); c.lineTo(10, 66); c.lineTo(24, 66); c.lineTo(24, 54); c.lineTo(32, 44); c.lineTo(40, 54); c.lineTo(40, 62); c.lineTo(58, 62); c.lineTo(58, 70); c.lineTo(70, 70); c.lineTo(70, 90); c.fill();
    c.fillStyle = '#d8a040';
    c.fillRect(30, 58, 3, 4);
    c.fillRect(48, 66, 3, 4);
  } else if (v === 2) {
    c.fillStyle = '#4a0a10';
    c.fillRect(10, 10, 60, 80);
    c.fillStyle = '#7a1018';
    c.beginPath(); c.arc(cx, cy, 20, 0, TAU); c.fill();
    c.fillStyle = '#1a0406';
    c.beginPath(); c.arc(cx, cy, 8, 0, TAU); c.fill();
  } else {
    c.fillStyle = '#20282a';
    c.fillRect(10, 10, 60, 80);
    c.strokeStyle = '#aa9a7a';
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, 16, 0, TAU); c.stroke();
    c.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + ((i * 2) % 5) * (TAU / 5);
      if (i) c.lineTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); else c.moveTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16);
    }
    c.stroke();
  }
  // touches de pinceau qui reprennent les couleurs du tableau, craquelures, vernis jauni et noirci aux bords
  const rnd = mulberry32(v * 31 + 7), S = cv.width / 80;
  const img = c.getImageData(10 * S, 10 * S, 60 * S, 80 * S), data = img.data;
  const at = (x, y) => {
    const i = (Math.min(img.height - 1, Math.floor(y * S)) * img.width + Math.min(img.width - 1, Math.floor(x * S))) * 4;
    return `rgba(${data[i]},${data[i + 1]},${data[i + 2]},0.55)`;
  };
  c.save();
  c.beginPath();
  c.rect(10, 10, 60, 80);
  c.clip();
  c.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * 60, y = rnd() * 80, a = Math.sin(x * 0.15 + y * 0.05) * 1.2 + rnd() * 0.6, len = 0.8 + rnd() * 2.6;
    c.strokeStyle = at(x, y);
    c.lineWidth = 0.4 + rnd() * 0.9;
    c.beginPath();
    c.moveTo(10 + x, 10 + y);
    c.lineTo(10 + x + Math.cos(a) * len, 10 + y + Math.sin(a) * len);
    c.stroke();
  }
  c.strokeStyle = 'rgba(10,6,2,0.35)';
  c.lineWidth = 0.18;
  for (let i = 0; i < 70; i++) {
    let x = 10 + rnd() * 60, y = 10 + rnd() * 80;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 5; k++) c.lineTo((x += (rnd() - 0.5) * 7), (y += (rnd() - 0.5) * 7));
    c.stroke();
  }
  const g = c.createRadialGradient(40, 50, 8, 40, 50, 52);
  g.addColorStop(0, 'rgba(210,170,80,0.10)');
  g.addColorStop(1, 'rgba(25,14,4,0.6)');
  c.fillStyle = g;
  c.fillRect(10, 10, 60, 80);
  c.restore();
  return cv;
}

export function mirrorTexture() {
  const [cv, c] = fine(80, 104, 4);
  c.fillStyle = '#9a9aa4';
  c.beginPath(); c.ellipse(40, 52, 38, 50, 0, 0, TAU); c.fill();
  const g = c.createLinearGradient(0, 0, 80, 104);
  g.addColorStop(0, '#4a5458');
  g.addColorStop(1, '#1a2024');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(40, 52, 31, 43, 0, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(220,230,240,0.55)';
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(28, 26); c.lineTo(42, 50); c.lineTo(34, 74); c.moveTo(42, 50); c.lineTo(60, 58); c.moveTo(42, 50); c.lineTo(52, 30); c.stroke();
  c.fillStyle = 'rgba(120,0,10,0.7)';
  c.font = 'bold 13px Georgia, serif';
  c.textAlign = 'center';
  c.fillText('FUYEZ', 40, 92);
  return cv;
}

export function tornTexture(rnd = mulberry32(5)) {
  const [cv, c] = fine(96, 128, 3);
  c.fillStyle = 'rgba(10,6,8,0.6)';
  c.beginPath();
  c.moveTo(10 + rnd() * 10, 14);
  for (let i = 0; i < 10; i++) c.lineTo(20 + rnd() * 66, 10 + i * 11 + rnd() * 8);
  c.lineTo(14, 110);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(210,190,160,0.18)';
  c.beginPath(); c.moveTo(70, 20); c.lineTo(88, 44); c.lineTo(66, 60); c.closePath(); c.fill();
  return cv;
}

// Toile d'araignée tissée depuis le coin inférieur gauche.
export function webTexture() {
  const [cv, c] = fine(128, 128, 4);
  c.strokeStyle = 'rgba(225,225,235,0.75)';
  c.lineWidth = 0.6;
  const ox = 0, oy = 128;
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox + Math.cos(a) * 128, oy - Math.sin(a) * 128); c.stroke();
  }
  for (const r of [0.2, 0.36, 0.52, 0.68, 0.84]) {
    c.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2), rr2 = r * 128 * (0.94 + (i % 2) * 0.06);
      const px = ox + Math.cos(a) * rr2, py = oy - Math.sin(a) * rr2;
      if (i) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
  }
  return cv;
}

// Tapis d'Orient de `d.w` × `d.h` mètres : champ semé de rosaces, médaillon lobé, écoinçons, bordures
// à frises, laine nouée (grain), usure et franges.
export function rugTexture(d) {
  const P = 160, W = d.w * P, H = d.h * P;
  const [cv, c] = canvas(W, H, true);
  const rnd = mulberry32(hash(`${d.c}${d.x},${d.y}`));
  const dark = shade(d.c, -0.5), deep = shade(d.c, -0.28), ivory = blend(shade(d.c, 0.3), '#8a7656'), gold = blend(d.c, '#7a5a2a');
  const diamond = (x, y, r) => { c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); };
  const rosette = (x, y, r, n, col, core) => {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      c.beginPath();
      c.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.45, r * 0.2, a, 0, TAU);
      c.fill();
    }
    circle(c, x, y, r * 0.25, core);
  };
  const lobed = (x, y, rx, ry, n, col) => {
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i <= n * 8; i++) {
      const a = (i / (n * 8)) * TAU, k = 1 + 0.12 * Math.cos(a * n);
      c.lineTo(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k);
    }
    c.fill();
  };
  c.fillStyle = d.c;
  c.fillRect(0, 0, W, H);
  // champ : treillis de rosaces et de losanges
  for (let y = 0, row = 0; y < H + 16; y += 16, row++) {
    for (let x = row % 2 ? 8 : 0; x < W + 16; x += 16) {
      if ((row + Math.round(x / 16)) % 2) rosette(x, y, 5, 8, deep, gold);
      else { c.fillStyle = dark; diamond(x, y, 2.5); }
    }
  }
  const fr = 10, b = Math.min(W, H) * 0.14, inner = fr + b;
  // médaillon et écoinçons
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.24, ex = Math.max(1, W / H) * 0.8 + 0.2, ey = Math.max(1, H / W) * 0.8 + 0.2;
  lobed(cx, cy, r * ex * 1.08, r * ey * 1.08, 8, gold);
  lobed(cx, cy, r * ex, r * ey, 8, dark);
  lobed(cx, cy, r * ex * 0.62, r * ey * 0.62, 8, deep);
  rosette(cx, cy, r * 0.22, 12, gold, ivory);
  for (const [qx, qy] of [[inner, inner], [W - inner, inner], [inner, H - inner], [W - inner, H - inner]]) {
    c.fillStyle = dark;
    c.beginPath(); c.ellipse(qx, qy, r * 0.9, r * 0.9, 0, 0, TAU); c.fill();
    rosette(qx + Math.sign(cx - qx) * r * 0.35, qy + Math.sign(cy - qy) * r * 0.35, r * 0.14, 8, gold, ivory);
  }
  // bordures : filets et frise de rosaces sur fond sombre
  c.fillStyle = dark;
  c.fillRect(fr, fr, W - 2 * fr, b);
  c.fillRect(fr, H - fr - b, W - 2 * fr, b);
  c.fillRect(fr, fr, b, H - 2 * fr);
  c.fillRect(W - fr - b, fr, b, H - 2 * fr);
  c.strokeStyle = ivory;
  c.lineWidth = 2.5;
  c.strokeRect(fr + 4, fr + 4, W - 2 * fr - 8, H - 2 * fr - 8);
  c.strokeStyle = gold;
  c.strokeRect(inner - 4, inner - 4, W - 2 * (inner - 4), H - 2 * (inner - 4));
  for (let x = inner, i = 0; x < W - inner; x += 15, i++) {
    rosette(x, fr + b / 2, b * 0.2, 6, i % 2 ? gold : deep, ivory);
    rosette(x, H - fr - b / 2, b * 0.2, 6, i % 2 ? gold : deep, ivory);
  }
  for (let y = inner, i = 0; y < H - inner; y += 15, i++) {
    rosette(fr + b / 2, y, b * 0.2, 6, i % 2 ? gold : deep, ivory);
    rosette(W - fr - b / 2, y, b * 0.2, 6, i % 2 ? gold : deep, ivory);
  }
  // usure : laine écrasée et décolorée au passage, taches sombres
  for (let i = 0; i < 30; i++) {
    const x = rnd() * W, y = rnd() * H, rr = 12 + rnd() * 50;
    const g = c.createRadialGradient(x, y, 0, x, y, rr);
    const col = rnd() < 0.6 ? '150,130,105' : '8,4,2';
    g.addColorStop(0, `rgba(${col},${(0.1 + rnd() * 0.12).toFixed(2)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = g;
    c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // laine : les motifs bavent un peu, puis le grain des nœuds
  const [soft, sc] = canvas(cv.width, cv.height, true);
  sc.filter = 'blur(1.3px)';
  sc.drawImage(cv, 0, 0);
  c.drawImage(soft, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (rnd() - 0.5) * 26 + (((i >> 2) % cv.width) % 3 === 0 ? -6 : 0);
    px[i] += n;
    px[i + 1] += n;
    px[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  // franges sur les petits côtés
  c.strokeStyle = 'rgba(200,185,150,0.95)';
  c.lineWidth = 1.5;
  const fringe = W >= H;
  for (let p = 2; p < (fringe ? H : W); p += 4) {
    c.beginPath();
    if (fringe) { c.moveTo(0, p); c.lineTo(fr, p); c.moveTo(W - fr, p); c.lineTo(W, p); } else { c.moveTo(p, 0); c.lineTo(p, fr); c.moveTo(p, H - fr); c.lineTo(p, H); }
    c.stroke();
  }
  return cv;
}

// Ce que projette une vraie lampe torche : un point chaud, l'anneau plus vif du réflecteur, un halo
// plus faible qui s'éteint au bord, et les petits défauts du verre. Intensités linéaires (la texture
// n'est pas convertie), un peu plus chaudes vers le bord.
export function flashlightCookie() {
  const S = 256, m = S / 2;
  const [cv, c] = canvas(S, S);
  c.fillStyle = '#000';
  c.fillRect(0, 0, S, S);
  const g = c.createRadialGradient(m, m, 0, m, m, m);
  for (const [t, v] of [[0, 0.95], [0.1, 0.93], [0.18, 0.74], [0.25, 1], [0.31, 0.62], [0.42, 0.4], [0.56, 0.27], [0.72, 0.15], [0.86, 0.06], [0.95, 0.015], [1, 0]]) {
    g.addColorStop(t, `rgb(${Math.round(v * 255)},${Math.round(v * 247)},${Math.round(v * 232)})`);
  }
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const rnd = mulberry32(42);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * TAU, d = rnd() * m * 0.6, r = 4 + rnd() * 14;
    const x = m + Math.cos(a) * d, y = m + Math.sin(a) * d;
    const s = c.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, `rgba(0,0,0,${(0.03 + rnd() * 0.05).toFixed(2)})`);
    s.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = s;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return cv;
}

// ---------------------------------------------------------------------------
// Effets et personnages
// ---------------------------------------------------------------------------

export function glowTexture() {
  const [cv, c] = fine(64, 64, 2);
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return cv;
}

export function smokeTexture() {
  const [cv, c] = fine(64, 64, 2);
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(2,0,4,0.95)');
  g.addColorStop(0.5, 'rgba(2,0,4,0.6)');
  g.addColorStop(1, 'rgba(2,0,4,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return cv;
}

export function flameTexture() {
  const [cv, c] = fine(32, 64, 3);
  const g = c.createRadialGradient(16, 46, 1, 16, 40, 26);
  g.addColorStop(0, 'rgba(255,250,225,1)');
  g.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  g.addColorStop(0.7, 'rgba(255,110,20,0.35)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(16, 0);
  c.quadraticCurveTo(30, 34, 26, 48);
  c.quadraticCurveTo(16, 66, 6, 48);
  c.quadraticCurveTo(2, 34, 16, 0);
  c.fill();
  return cv;
}

// Faisceau d'une lampe : intense près de la lampe, puis s'éteint.
export function beamTexture() {
  const [cv, c] = canvas(8, 128);
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,240,210,1)');
  g.addColorStop(0.3, 'rgba(255,240,210,0.35)');
  g.addColorStop(1, 'rgba(255,240,210,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 8, 128);
  return cv;
}

// Masque de porcelaine de la créature.
export function maskTexture() {
  const [cv, c] = fine(128, 160, 3);
  const g = c.createRadialGradient(64, 60, 10, 64, 80, 80);
  g.addColorStop(0, '#e2dacb');
  g.addColorStop(0.7, '#b8b0a2');
  g.addColorStop(1, '#6a6458');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(64, 80, 52, 74, 0, 0, TAU); c.fill();
  // yeux percés : la lueur des pupilles passe au travers
  c.globalCompositeOperation = 'destination-out';
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(64 + s * 22, 66, 13, 17, s * 0.35, 0, TAU); c.fill(); }
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.lineWidth = 3;
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(64 + s * 22, 66, 14.5, 18.5, s * 0.35, 0, TAU); c.stroke(); }
  c.fillStyle = '#000';
  c.beginPath(); c.ellipse(64, 92, 3, 9, 0, 0, TAU); c.fill();
  c.strokeStyle = '#1a0a0a';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(34, 118); c.quadraticCurveTo(64, 134, 94, 116); c.stroke();
  c.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { const x = 38 + i * 6.5; c.beginPath(); c.moveTo(x, 118 + Math.sin(i / 8 * Math.PI) * 9 - 5); c.lineTo(x, 118 + Math.sin(i / 8 * Math.PI) * 9 + 5); c.stroke(); }
  c.strokeStyle = 'rgba(30,10,10,0.7)';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(76, 8); c.lineTo(82, 34); c.lineTo(74, 50); c.moveTo(30, 92); c.lineTo(22, 112); c.stroke();
  c.fillStyle = 'rgba(90,0,10,0.75)';
  c.fillRect(40, 80, 3, 26);
  c.fillRect(86, 80, 2, 18);
  return cv;
}

// Sceau maudit sur la grande porte.
export function sealTexture() {
  const [cv, c] = canvas(256, 256);
  c.translate(128, 128);
  c.strokeStyle = 'rgba(190,110,255,1)';
  c.shadowColor = 'rgba(170,90,255,1)';
  c.shadowBlur = 14;
  c.lineWidth = 7;
  c.beginPath(); c.arc(0, 0, 100, 0, TAU); c.stroke();
  c.lineWidth = 3;
  c.beginPath(); c.arc(0, 0, 84, 0, TAU); c.stroke();
  c.lineWidth = 6;
  c.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + ((i * 2) % 5) * (TAU / 5);
    if (i) c.lineTo(Math.cos(a) * 84, Math.sin(a) * 84); else c.moveTo(Math.cos(a) * 84, Math.sin(a) * 84);
  }
  c.stroke();
  return cv;
}

// Ce qu'on voit par la grande porte ouverte : le parc sous la lune.
export function nightTexture() {
  const [cv, c] = fine(512, 256, 2);
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0c1430');
  g.addColorStop(0.65, '#2a3c6a');
  g.addColorStop(1, '#1a2a3a');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 256);
  const m = c.createRadialGradient(330, 60, 0, 330, 60, 90);
  m.addColorStop(0, 'rgba(230,240,255,0.55)');
  m.addColorStop(1, 'rgba(230,240,255,0)');
  c.fillStyle = m;
  c.fillRect(200, 0, 260, 180);
  circle(c, 330, 60, 22, '#eef2ff');
  const rnd = mulberry32(9);
  for (let i = 0; i < 60; i++) circle(c, rnd() * 512, rnd() * 120, rnd() * 1.2, 'rgba(255,255,255,0.7)');
  c.fillStyle = '#05070c';
  c.beginPath();
  c.moveTo(0, 256);
  for (let x = 0; x <= 512; x += 32) c.lineTo(x, 196 + Math.sin(x * 0.02) * 10 + rnd() * 8);
  c.lineTo(512, 256);
  c.fill();
  c.strokeStyle = '#05070c';
  for (const tx of [70, 150, 420, 480]) {
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(tx, 210); c.lineTo(tx + 4, 120); c.stroke();
    c.lineWidth = 2;
    for (let i = 0; i < 5; i++) { const y = 130 + i * 14; c.beginPath(); c.moveTo(tx + 3, y); c.lineTo(tx + (i % 2 ? 30 : -28), y - 20); c.stroke(); }
  }
  // grille du parc
  c.fillStyle = '#05070c';
  c.fillRect(0, 214, 512, 4);
  for (let x = 4; x < 512; x += 14) { c.fillRect(x, 190, 3, 50); c.beginPath(); c.moveTo(x - 2, 192); c.lineTo(x + 1.5, 182); c.lineTo(x + 5, 192); c.fill(); }
  return cv;
}

// Citrouille : écorce (texture) et visage sculpté qui brille (lumière propre).
export function pumpkinTextures() {
  const [cv, c] = fine(256, 128, 2);
  for (let x = 0; x < 256; x += 32) {
    const g = c.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, '#7a3008');
    g.addColorStop(0.5, '#c8560e');
    g.addColorStop(1, '#7a3008');
    c.fillStyle = g;
    c.fillRect(x, 0, 32, 128);
  }
  const [ev, e] = fine(256, 128, 2);
  e.fillStyle = '#000';
  e.fillRect(0, 0, 256, 128);
  // visage centré en u = 0,5 (face +X de la sphère)
  const face = ctx => {
    ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(128 + s * 10, 50); ctx.lineTo(128 + s * 24, 64); ctx.lineTo(128 + s * 4, 64); ctx.closePath(); }
    ctx.moveTo(110, 76); ctx.lineTo(146, 76); ctx.lineTo(138, 90); ctx.lineTo(128, 84); ctx.lineTo(118, 90); ctx.closePath();
  };
  face(c);
  c.fillStyle = '#1a0800';
  c.fill();
  face(e);
  e.fillStyle = '#ffb030';
  e.fill();
  return [cv, ev];
}

export function bloodTexture() {
  const [cv, c] = fine(128, 128, 2);
  splat(c, 64, 64, 30, mulberry32(3), 'rgba(90,0,8,0.85)');
  return cv;
}

// Mèches de cheveux, de haut en bas et raccordables : nuances pour la couleur, relief pour la lumière.
export function hairTexture() {
  const W = 256, [cv, c] = canvas(W, W), rnd = mulberry32(77);
  c.fillStyle = '#a8a8a8';
  c.fillRect(0, 0, W, W);
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * W, v = Math.floor(90 + rnd() * 165), bend = (rnd() - 0.5) * 10;
    c.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.45})`;
    c.lineWidth = 0.5 + rnd() * 1.6;
    for (const dx of [-W, 0, W]) {
      c.beginPath();
      c.moveTo(x + dx, -4);
      c.bezierCurveTo(x + dx + bend, W * 0.33, x + dx - bend, W * 0.66, x + dx, W + 4);
      c.stroke();
    }
  }
  return cv;
}

// Livres reliés : 32 dos côte à côte sur les trois quarts du haut (cuir à nerfs, pièce de titre et
// fers dorés, ou toile à étiquette de papier), puis en bas à gauche la tranche des pages et à droite
// le cuir uni des plats de chaque dos. Couleur, relief (clair = bosse) et rugosité/métal (vert/bleu :
// la dorure brille).
export const BOOK_COLS = 32;
const LEATHERS = ['#4a1612', '#5a2014', '#2a3a22', '#1c2a3a', '#3a2414', '#5a3a1c', '#1a1412', '#3a1020', '#6a4a2a', '#2a1a10'];
const CLOTHS = ['#3a4a3a', '#4a2a2a', '#2a3448', '#5a5040', '#3a3030', '#463a2a'];
const LABELS = ['#5a0e0e', '#121010', '#123018', '#3a0c18'];
export function bookAtlas() {
  const W = 2048, H = 1024, SH = 768, CW = W / BOOK_COLS, rnd = mulberry32(1897);
  const [cv, c] = canvas(W, H), [hv, h] = canvas(W, H), [av, a] = canvas(W, H);
  h.fillStyle = '#404040';
  h.fillRect(0, 0, W, H);
  a.fillStyle = 'rgb(255,150,0)';
  a.fillRect(0, 0, W, H);
  const gold = (x, y, w, hh) => {
    c.fillStyle = '#c8a050';
    c.fillRect(x, y, w, hh);
    a.fillStyle = 'rgb(255,80,255)';
    a.fillRect(x, y, w, hh);
    h.fillStyle = '#505050';
    h.fillRect(x, y, w, hh);
  };
  const bases = [];
  for (let i = 0; i < BOOK_COLS; i++) {
    const x = i * CW, cloth = rnd() < 0.3;
    const base = cloth ? CLOTHS[Math.floor(rnd() * CLOTHS.length)] : LEATHERS[Math.floor(rnd() * LEATHERS.length)];
    bases.push(base);
    c.fillStyle = shade(base, (rnd() - 0.5) * 0.3);
    c.fillRect(x, 0, CW, SH);
    // marbrures du cuir, grain de la toile
    for (let k = 0; k < (cloth ? 260 : 180); k++) {
      c.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.12})` : `rgba(255,230,200,${0.03 + rnd() * 0.06})`;
      c.fillRect(x + rnd() * CW, rnd() * SH, cloth ? 1 : 2 + rnd() * 5, cloth ? 1 + rnd() * 3 : 2 + rnd() * 8);
    }
    a.fillStyle = cloth ? 'rgb(255,225,0)' : `rgb(255,${120 + Math.floor(rnd() * 40)},0)`;
    a.fillRect(x, 0, CW, SH);
    // coiffes élimées en haut et en bas
    for (const [y0, y1] of [[0, 26], [SH, SH - 26]]) {
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(220,190,150,0.35)');
      g.addColorStop(1, 'rgba(220,190,150,0)');
      c.fillStyle = g;
      c.fillRect(x, Math.min(y0, y1), CW, 26);
    }
    if (cloth) {
      // étiquette de papier, titre à l'encre, deux filets frappés
      const ly = SH * (0.12 + rnd() * 0.06), lh = SH * 0.13;
      c.fillStyle = shade('#d8cba8', -rnd() * 0.25);
      c.fillRect(x + 8, ly, CW - 16, lh);
      a.fillStyle = 'rgb(255,210,0)';
      a.fillRect(x + 8, ly, CW - 16, lh);
      c.fillStyle = 'rgba(40,30,20,0.75)';
      for (let k = 0; k < 3; k++) c.fillRect(x + 14 + rnd() * 4, ly + 14 + k * 22, CW - 30 - rnd() * 10, 5);
      for (const y of [SH * 0.05, SH * 0.95]) {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(x, y, CW, 3);
        h.fillStyle = '#303030';
        h.fillRect(x, y, CW, 3);
      }
      continue;
    }
    // cinq ou six nerfs en relief, chacun bordé de deux filets dorés
    const nb = 4 + Math.floor(rnd() * 2), top = SH * 0.07, step = (SH * 0.93 - top) / (nb + 1);
    const ys = Array.from({ length: nb }, (_, k) => top + step * (k + 1));
    for (const y of ys) {
      const g = h.createLinearGradient(0, y - 9, 0, y + 9);
      g.addColorStop(0, '#404040');
      g.addColorStop(0.5, '#e0e0e0');
      g.addColorStop(1, '#404040');
      h.fillStyle = g;
      h.fillRect(x, y - 9, CW, 18);
      c.fillStyle = 'rgba(255,220,180,0.12)';
      c.fillRect(x, y - 5, CW, 4);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(x, y + 5, CW, 4);
      gold(x, y - 13, CW, 2);
      gold(x, y + 11, CW, 2);
    }
    // pièce de titre dans le deuxième entre-nerf, fleurons dans les autres
    const t0 = top + step + 16, t1 = top + step * 2 - 16;
    c.fillStyle = LABELS[Math.floor(rnd() * LABELS.length)];
    c.fillRect(x + 4, t0, CW - 8, t1 - t0);
    gold(x + 7, t0 + 3, CW - 14, 2);
    gold(x + 7, t1 - 5, CW - 14, 2);
    for (let k = 0, n = 2 + Math.floor(rnd() * 2); k < n; k++) gold(x + 12 + rnd() * 4, t0 + 14 + k * ((t1 - t0 - 28) / n), CW - 26 - rnd() * 10, 6);
    for (let k = 0; k <= nb; k++) {
      if (k === 1) continue;
      const cy = top + step * (k + 0.5), cx = x + CW / 2;
      if (rnd() < 0.3) continue;
      for (const [dx, dy, s] of [[0, 0, 5], [0, -12, 3], [0, 12, 3], [-10, 0, 3], [10, 0, 3]]) gold(cx + dx - s / 2, cy + dy - s / 2, s, s);
    }
  }
  // tranche des pages : papier jauni, feuillets serrés
  const [py, ph] = [SH, H - SH];
  c.fillStyle = '#cdbf9c';
  c.fillRect(0, py, W / 2, ph);
  for (let x = 0; x < W / 2; x++) {
    c.fillStyle = `rgba(${rnd() < 0.5 ? '60,45,25' : '255,250,230'},${rnd() * 0.18})`;
    c.fillRect(x, py, 1, ph);
  }
  for (let k = 0; k < 60; k++) {
    c.fillStyle = `rgba(90,60,30,${rnd() * 0.12})`;
    c.fillRect(rnd() * W / 2, py + rnd() * ph, 4 + rnd() * 30, 2 + rnd() * 20);
  }
  a.fillStyle = 'rgb(255,215,0)';
  a.fillRect(0, py, W / 2, ph);
  // plats : le cuir de chaque dos, uni
  const pw = W / 2 / BOOK_COLS;
  bases.forEach((b, i) => {
    c.fillStyle = shade(b, -0.1);
    c.fillRect(W / 2 + i * pw, py, pw, ph);
  });
  return { color: cv, height: hv, arm: av };
}
