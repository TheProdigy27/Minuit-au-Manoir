// Collisions, lignes de vue et distances sur la grille de cases.
import { TILE, SOLID, OPAQUE } from './config.js';

// ---------------------------------------------------------------------------
// Étages : ils sont posés côte à côte sur la grille (map.floors[f].ox, décalage en x de l'étage f,
// soit f × map.stride), séparés par du vide. Un escalier s relie l'étage s.f à celui du dessus : son
// emprise (s.x, s.y, s.len × s.wid, en cases de l'étage, montée vers s.dx) existe sur les deux
// grilles, et l'on passe de l'une à l'autre à mi-montée. Le reste (collisions, vues, chemins) ne
// connaît que deux dimensions.
// ---------------------------------------------------------------------------

const FLOOR_SOUND = 8; // un étage d'écart compte comme 8 cases de plus pour les bruits

export function floorAt(map, x) {
  return Math.max(0, Math.min(map.floors.length - 1, Math.floor(x / map.stride)));
}

// Avancée dans l'emprise d'un escalier (0 en bas, 1 en haut), ou -1 en dehors.
export function stairAlong(s, lx, y) {
  if (lx < s.x || lx >= s.x + s.len || y < s.y || y >= s.y + s.wid) return -1;
  return s.dx > 0 ? (lx - s.x) / s.len : (s.x + s.len - lx) / s.len;
}

// L'escalier où se trouve un point, sur la grille de son étage du bas (`lower`) ou du haut.
export function stairAt(map, x, y) {
  const f = floorAt(map, x), lx = x - map.floors[f].ox;
  for (const s of map.stairs) {
    if (s.f !== f && s.f + 1 !== f) continue;
    const t = stairAlong(s, lx, y);
    if (t >= 0) return { s, t, lower: s.f === f };
  }
  return null;
}

// Passé le milieu d'un escalier, on continue sur la grille de l'autre étage, au même endroit du manoir.
export function crossStairs(map, x, y) {
  const at = stairAt(map, x, y);
  if (at?.lower && at.t > 0.5) return [x + map.stride, y];
  if (at && !at.lower && at.t < 0.5) return [x - map.stride, y];
  return [x, y];
}

// Distance pour entendre : à vol d'oiseau sur le même étage, plus une pénalité par étage d'écart.
export function levelDist(map, x0, y0, x1, y1) {
  const df = floorAt(map, x1) - floorAt(map, x0);
  return Math.hypot(x1 - x0 - df * map.stride, y1 - y0) + Math.abs(df) * FLOOR_SOUND;
}

// Cases reliées d'une grille à l'autre par un escalier : la dernière avant le milieu sur l'étage du
// bas, la première après sur celui du haut (une paire par case de largeur).
export function stairPairs(map, s) {
  const k = s.len / 2 - 1, lx = s.dx > 0 ? s.x + k : s.x + s.len - 1 - k;
  const lo = map.floors[s.f].ox + lx, hi = map.floors[s.f + 1].ox + lx + s.dx;
  return Array.from({ length: s.wid }, (_, j) => [(s.y + j) * map.w + lo, (s.y + j) * map.w + hi]);
}

const LINKS = new WeakMap();
const NONE = [];

// Pour les parcours en largeur : case → cases de l'autre étage où l'escalier mène.
export function stairLinks(map) {
  let links = LINKS.get(map);
  if (!links) {
    links = new Map();
    const add = (a, b) => links.set(a, [...(links.get(a) || NONE), b]);
    for (const s of map.stairs) for (const [a, b] of stairPairs(map, s)) { add(a, b); add(b, a); }
    LINKS.set(map, links);
  }
  return links;
}

export const linksOf = (links, i) => links.get(i) || NONE;

export function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return TILE.VOID;
  return map.tiles[ty * map.w + tx];
}

export function solidAt(map, tx, ty, exitOpen = false) {
  const t = tileAt(map, tx, ty);
  return t === TILE.EXIT ? !exitOpen : SOLID[t];
}

export function opaqueAt(map, tx, ty) {
  return OPAQUE[tileAt(map, tx, ty)];
}

// Déplace une boîte de demi-côté `half` en glissant le long des obstacles.
export function moveBox(map, x, y, dx, dy, half, exitOpen = false) {
  const E = 1e-4;
  let nx = x + dx;
  if (dx) {
    const y0 = Math.floor(y - half + E), y1 = Math.floor(y + half - E);
    const tx = Math.floor(dx > 0 ? nx + half : nx - half);
    for (let ty = y0; ty <= y1; ty++) {
      if (solidAt(map, tx, ty, exitOpen)) { nx = dx > 0 ? tx - half - E : tx + 1 + half + E; break; }
    }
  }
  let ny = y + dy;
  if (dy) {
    const x0 = Math.floor(nx - half + E), x1 = Math.floor(nx + half - E);
    const ty = Math.floor(dy > 0 ? ny + half : ny - half);
    for (let tx = x0; tx <= x1; tx++) {
      if (solidAt(map, tx, ty, exitOpen)) { ny = dy > 0 ? ty - half - E : ty + 1 + half + E; break; }
    }
  }
  return [nx, ny];
}

export function boxFree(map, x, y, half, exitOpen = false) {
  const x0 = Math.floor(x - half), x1 = Math.floor(x + half);
  const y0 = Math.floor(y - half), y1 = Math.floor(y + half);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(map, tx, ty, exitOpen)) return false;
  return true;
}

// Une boîte peut-elle aller en ligne droite de A à B ?
export function clearPath(map, x0, y0, x1, y1, half) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.2);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!boxFree(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, half)) return false;
  }
  return true;
}

// Distance parcourue par un rayon avant de toucher une case opaque (parcours DDA).
export function castRay(map, x, y, ang, maxDist) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let tx = Math.floor(x), ty = Math.floor(y);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = Math.abs(dx) < 1e-9 ? 1e9 : Math.abs(1 / dx);
  const ddy = Math.abs(dy) < 1e-9 ? 1e9 : Math.abs(1 / dy);
  let mx = (dx > 0 ? tx + 1 - x : x - tx) * ddx;
  let my = (dy > 0 ? ty + 1 - y : y - ty) * ddy;
  for (;;) {
    let t;
    if (mx < my) { t = mx; mx += ddx; tx += sx; } else { t = my; my += ddy; ty += sy; }
    if (t >= maxDist) return maxDist;
    if (opaqueAt(map, tx, ty)) return t;
  }
}

export function lineOfSight(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1e-6) return true;
  return castRay(map, x0, y0, Math.atan2(y1 - y0, x1 - x0), d) >= d - 1e-6;
}

// Distance de marche (en cases, 4 directions, escaliers compris) depuis un point vers toutes les cases.
export function distanceField(map, sx, sy, exitOpen = false) {
  const { w, h } = map;
  const links = stairLinks(map);
  const dist = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  const start = Math.floor(sy) * w + Math.floor(sx);
  let head = 0, tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (solidAt(map, nx, ny, exitOpen)) continue;
      const j = ny * w + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue[tail++] = j;
    }
    for (const j of linksOf(links, i)) {
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

export function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
