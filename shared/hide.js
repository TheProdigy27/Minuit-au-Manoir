// Cachettes : des meubles où l'on se glisse (map.hides, posés par map.js). Partagé par le serveur, qui
// fait les règles, et les pages, qui visent le meuble et montrent la vue de l'intérieur.
import { CFG, TILE } from './config.js';
import { tileAt } from './physics.js';

// Meubles qui servent de cachette, et comment on en parle.
export const HIDES = {
  wardrobe: { name: 'l’armoire', into: 'dans l’armoire' },
  cabinet: { name: 'le buffet', into: 'dans le buffet' },
  bed: { name: 'le lit', into: 'sous le lit' },
  coffin: { name: 'le cercueil', into: 'dans le cercueil' },
};

// Distance d'un point au meuble d'une cachette (0 dedans).
export function hideDist(s, x, y) {
  return Math.hypot(Math.max(s.x - x, 0, x - s.x - s.w), Math.max(s.y - y, 0, y - s.y - s.h));
}

// Cases libres autour du meuble, où l'on peut ressortir, chacune avec le côté du meuble qu'elle touche.
// Sous un lit ou dans un cercueil, on se glisse par un grand côté (au pied du lit, il y a le cadre).
function around(map, s) {
  const out = [], long = s.k === 'bed' || s.k === 'coffin';
  const add = (x, y, nx, ny) => { if (tileAt(map, x, y) === TILE.FLOOR) out.push({ x, y, nx, ny }); };
  if (!long || s.w > s.h) for (let x = s.x; x < s.x + s.w; x++) { add(x, s.y - 1, 0, -1); add(x, s.y + s.h, 0, 1); }
  if (!long || s.h > s.w) for (let y = s.y; y < s.y + s.h; y++) { add(s.x - 1, y, -1, 0); add(s.x + s.w, y, 1, 0); }
  return out;
}

export const hideOpen = (map, s) => around(map, s).length > 0;

// Où aller chercher un joueur (côté serveur) : devant la porte de sa cachette, ou là où il est.
export const front = p => (p.hide ? [p.hide.ex, p.hide.ey] : [p.x, p.y]);

const AT = new WeakMap();

// La cachette dont le meuble occupe le point (x, y), ou null.
export function hideAt(map, x, y) {
  let at = AT.get(map);
  if (!at) {
    at = new Map();
    for (const s of map.hides || []) for (let j = s.y; j < s.y + s.h; j++) for (let i = s.x; i < s.x + s.w; i++) at.set(j * map.w + i, s);
    AT.set(map, at);
  }
  return at.get(Math.floor(y) * map.w + Math.floor(x)) ?? null;
}

// Se glisser dans la cachette `s` depuis (px, py) : par le côté du meuble qui donne sur la case libre la
// plus proche. Rend où l'on se tient caché·e (juste derrière la porte, au milieu de ce côté), le regard
// (vers la porte), et le centre de la case par où l'on ressortira ; null si l'on est trop loin.
export function hideEntry(map, s, px, py, reach = CFG.hide.reach) {
  if (!s || hideDist(s, px, py) > reach) return null;
  let best = null, bd = Infinity;
  for (const c of around(map, s)) {
    const d = Math.hypot(c.x + 0.5 - px, c.y + 0.5 - py);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return null;
  const { nx, ny } = best, IN = 0.22;
  return {
    x: nx ? (nx > 0 ? s.x + s.w - IN : s.x + IN) : s.x + s.w / 2,
    y: ny ? (ny > 0 ? s.y + s.h - IN : s.y + IN) : s.y + s.h / 2,
    a: Math.atan2(ny, nx),
    ex: best.x + 0.5,
    ey: best.y + 0.5,
  };
}
