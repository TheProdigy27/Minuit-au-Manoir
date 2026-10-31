// Génération procédurale du manoir : une grille de pièces reliées par des portes,
// meublées selon leur thème. Le serveur génère, les navigateurs reçoivent le résultat.
import { TILE } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROOM_NAMES = {
  foyer: 'Grand hall', library: 'Bibliothèque', dining: 'Salle à manger', bedroom: 'Chambre',
  kitchen: 'Cuisine', chapel: 'Chapelle', crypt: 'Crypte', salon: 'Salon', gallery: 'Galerie',
  storage: 'Débarras', bath: 'Salle de bain', conservatory: "Jardin d'hiver", nursery: "Chambre d'enfant",
  lab: 'Laboratoire',
};
const THEMES = Object.keys(ROOM_NAMES).filter(t => t !== 'foyer');

export const CELL = { w: 10, h: 8 }; // intérieur d'une pièce élémentaire, en cases

const CANDLE = [255, 160, 70], FIRE = [255, 105, 35], MOON = [110, 140, 255];
const GREEN = [80, 255, 120], PUMPKIN = [255, 120, 20], PINK = [255, 140, 200];

export function generateMap(seed, nPlayers = 4) {
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = p => rnd() < p;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const CW = CELL.w, CH = CELL.h;
  const cols = nPlayers <= 2 ? 4 : nPlayers <= 4 ? 5 : 6;
  const rows = nPlayers <= 2 ? 3 : 4;
  const w = cols * (CW + 1) + 1, h = rows * (CH + 1) + 1;
  const tiles = new Uint8Array(w * h).fill(TILE.WALL);
  const I = (x, y) => y * w + x;
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? TILE.VOID : tiles[I(x, y)]);

  // --- Cellules ---
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { id: cells.length, c, r, x: c * (CW + 1) + 1, y: r * (CH + 1) + 1, room: -1 };
    cells.push(cell);
    for (let y = cell.y; y < cell.y + CH; y++) for (let x = cell.x; x < cell.x + CW; x++) tiles[I(x, y)] = TILE.FLOOR;
  }
  const cellAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? null : cells[r * cols + c]);
  const foyer = cellAt(Math.floor(cols / 2), rows - 1);
  const neighbours = cell =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => cellAt(cell.c + dc, cell.r + dr)).filter(Boolean);

  // --- Plan : arbre couvrant aléatoire + boucles (indispensables pour semer la créature) ---
  const links = new Map();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const seen = new Set([foyer.id]);
  const stack = [foyer];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const next = neighbours(cur).filter(n => !seen.has(n.id));
    if (!next.length) { stack.pop(); continue; }
    const n = pick(next);
    seen.add(n.id);
    links.set(key(cur.id, n.id), 'door');
    stack.push(n);
  }
  for (const cell of cells) {
    for (const n of neighbours(cell)) {
      if (n.id > cell.id && !links.has(key(cell.id, n.id)) && chance(0.32)) links.set(key(cell.id, n.id), 'door');
    }
  }

  // Quelques paires de cellules fusionnées en grandes salles
  const roots = cells.map(c => c.id);
  const merged = new Set();
  for (const k of shuffle([...links.keys()])) {
    const [a, b] = k.split('-').map(Number);
    if (a === foyer.id || b === foyer.id || merged.has(a) || merged.has(b) || !chance(0.2)) continue;
    links.set(k, 'merge');
    merged.add(a); merged.add(b);
    roots[b] = a;
  }
  const rooms = [];
  const roomByRoot = new Map();
  for (const cell of cells) {
    const root = roots[cell.id];
    if (!roomByRoot.has(root)) {
      roomByRoot.set(root, rooms.length);
      rooms.push({ id: rooms.length, cells: [], theme: '', name: '' });
    }
    const room = rooms[roomByRoot.get(root)];
    room.cells.push(cell.id);
    cell.room = room.id;
  }
  let pool = [];
  for (const room of rooms) {
    if (room.cells.includes(foyer.id)) room.theme = 'foyer';
    else {
      if (!pool.length) pool = shuffle(THEMES.slice());
      room.theme = pool.pop();
    }
    room.name = ROOM_NAMES[room.theme];
  }

  // --- Percement des portes ---
  const roomIdx = new Int8Array(w * h).fill(-1);
  for (const cell of cells) {
    for (let y = cell.y; y < cell.y + CH; y++) for (let x = cell.x; x < cell.x + CW; x++) roomIdx[I(x, y)] = cell.room;
  }
  const doors = []; // [x, y, vertical]
  for (const [k, kind] of links) {
    const [a, b] = k.split('-').map(Number);
    const A = cells[a], B = cells[b];
    const size = chance(0.3) ? 3 : 2;
    if (A.r === B.r) {
      const L = A.c < B.c ? A : B, x = L.x + CW;
      if (kind === 'merge') {
        for (let y = L.y; y < L.y + CH; y++) { tiles[I(x, y)] = TILE.FLOOR; roomIdx[I(x, y)] = L.room; }
      } else {
        const y0 = ri(L.y + 1, L.y + CH - 1 - size);
        for (let i = 0; i < size; i++) { tiles[I(x, y0 + i)] = TILE.FLOOR; doors.push([x, y0 + i, true]); }
      }
    } else {
      const T = A.r < B.r ? A : B, y = T.y + CH;
      if (kind === 'merge') {
        for (let x = T.x; x < T.x + CW; x++) { tiles[I(x, y)] = TILE.FLOOR; roomIdx[I(x, y)] = T.room; }
      } else {
        const x0 = ri(T.x + 1, T.x + CW - 1 - size);
        for (let i = 0; i < size; i++) { tiles[I(x0 + i, y)] = TILE.FLOOR; doors.push([x0 + i, y, false]); }
      }
    }
  }

  // Grande porte de sortie, dans le mur sud du hall
  const exit = { x: foyer.x + CW / 2 - 1, y: h - 1, w: 2, h: 1 };
  tiles[I(exit.x, exit.y)] = TILE.EXIT;
  tiles[I(exit.x + 1, exit.y)] = TILE.EXIT;
  const spawn = { x: foyer.x + CW / 2, y: foyer.y + CH / 2 };

  // Cases à garder libres : passages des portes, devant la sortie, point de départ
  const reserved = new Uint8Array(w * h);
  const reserve = (x, y) => { if (get(x, y) === TILE.FLOOR) reserved[I(x, y)] = 1; };
  for (const [x, y, vertical] of doors) {
    for (const d of [1, 2]) {
      if (vertical) { reserve(x - d, y); reserve(x + d, y); } else { reserve(x, y - d); reserve(x, y + d); }
    }
  }
  for (let y = exit.y - 3; y < exit.y; y++) for (let x = exit.x - 1; x <= exit.x + 2; x++) reserve(x, y);
  for (let y = spawn.y - 2; y < spawn.y + 2; y++) for (let x = spawn.x - 2; x < spawn.x + 2; x++) reserve(x, y);

  // --- Mobilier : chaque meuble n'est gardé que si tout le sol reste accessible ---
  let floorCount = 0;
  for (const t of tiles) if (t === TILE.FLOOR) floorCount++;
  const startIdx = I(spawn.x, spawn.y);
  const mark = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  function connected() {
    mark.fill(0);
    let head = 0, tail = 0, count = 0;
    queue[tail++] = startIdx;
    mark[startIdx] = 1;
    while (head < tail) {
      const i = queue[head++];
      count++;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (!mark[j] && tiles[j] === TILE.FLOOR) { mark[j] = 1; queue[tail++] = j; }
      }
    }
    return count === floorCount;
  }

  const furniture = [], decals = [], lights = [], wallDeco = [];
  const light = (x, y, r, c, k = 'candle') => lights.push({ x: +x.toFixed(2), y: +y.toFixed(2), r, c, k });

  function place(k, x, y, fw, fh, tall = false, extra = {}) {
    for (let j = y; j < y + fh; j++) {
      for (let i = x; i < x + fw; i++) if (get(i, j) !== TILE.FLOOR || reserved[I(i, j)]) return null;
    }
    const v = tall ? TILE.TALL : TILE.LOW;
    for (let j = y; j < y + fh; j++) for (let i = x; i < x + fw; i++) tiles[I(i, j)] = v;
    floorCount -= fw * fh;
    if (!connected()) {
      for (let j = y; j < y + fh; j++) for (let i = x; i < x + fw; i++) tiles[I(i, j)] = TILE.FLOOR;
      floorCount += fw * fh;
      return null;
    }
    const f = { k, x, y, w: fw, h: fh, ...extra };
    furniture.push(f);
    return f;
  }

  function furnish(cell, theme) {
    const X = cell.x, Y = cell.y;
    const P = (k, lx, ly, fw, fh, tall, extra) => place(k, X + lx, Y + ly, fw, fh, tall, extra);
    const D = (k, lx, ly, extra = {}) => decals.push({ k, x: X + lx, y: Y + ly, ...extra });
    const Lt = (lx, ly, r, c, k) => light(X + lx, Y + ly, r, c, k);
    const free = (lx, ly) => get(X + Math.floor(lx), Y + Math.floor(ly)) === TILE.FLOOR;
    const candleOn = f => f && light(f.x + f.w / 2, f.y + f.h / 2, 2.6, CANDLE, 'candle');

    switch (theme) {
      case 'foyer': {
        D('rug', 2, 1, { w: 6, h: 6, c: '#5b1a1f' });
        P('statue', 1, 1, 1, 1, true); P('statue', 8, 1, 1, 1, true);
        P('clock', 4, 0, 1, 1, true);
        candleOn(P('sidetable', 0, 4, 1, 1)); candleOn(P('sidetable', 9, 4, 1, 1));
        Lt(5, 3.5, 4, CANDLE, 'chandelier');
        for (const lx of [1, 8]) { const pk = P('pumpkin', lx, 6, 1, 1); if (pk) light(pk.x + 0.5, pk.y + 0.5, 2, PUMPKIN, 'pumpkin'); }
        break;
      }
      case 'library': {
        if (chance(0.5)) D('rug', 2, 2, { w: 6, h: 4, c: '#3c1f3a' });
        for (let lx = 0; lx < CW; lx += 2) if (chance(0.8)) P('shelf', lx, 0, 2, 1, true);
        if (chance(0.5)) { for (const lx of [2, 5, 8]) P('shelf', lx, 3, 1, 3, true); }
        else { P('shelf', 1, 3, 3, 1, true); P('shelf', 6, 3, 3, 1, true); P('shelf', 3, 5, 4, 1, true); }
        candleOn(P('table', ri(1, 6), 6, 2, 1));
        P('armchair', ri(0, 9), 7, 1, 1);
        break;
      }
      case 'dining': {
        D('rug', 1, 2, { w: 8, h: 4, c: '#4a2418' });
        const t = P('longtable', 2, 3, 6, 2, false, { plates: true });
        if (t) {
          Lt(3.5, 4, 2.4, CANDLE); Lt(6.5, 4, 2.4, CANDLE);
          for (let i = 0; i < 6; i++) { D('chair', 2.5 + i, 2.6, { r: 0 }); D('chair', 2.5 + i, 5.4, { r: 1 }); }
        }
        P('cabinet', 0, 0, 2, 1, true); P('cabinet', 8, 0, 2, 1, true);
        break;
      }
      case 'bedroom': {
        const bx = ri(1, 6);
        D('rug', bx - 1, 3, { w: 4, h: 3, c: '#4a3a5a' });
        const bed = P('bed', bx, 0, 2, 3, false, { c: pick(['#5a1e2e', '#2e3a5a', '#3e4a2a']), blood: chance(0.5) });
        if (bed) candleOn(P('nightstand', bx + 2, 0, 1, 1));
        P('wardrobe', bx > 4 ? 0 : 8, 0, 2, 1, true);
        P('dresser', ri(1, 7), 7, 2, 1);
        break;
      }
      case 'kitchen': {
        P('counter', 0, 0, 4, 1); P('stove', 4, 0, 2, 1, true); P('counter', 6, 0, 4, 1);
        if (get(X + 4, Y) === TILE.TALL) Lt(5, 1.3, 2.2, FIRE, 'fire');
        P('island', 3, 3, 4, 2);
        for (let i = 0; i < 3; i++) P('barrel', pick([0, 9]), ri(2, 7), 1, 1);
        D('blood', ri(1, 8) + 0.5, ri(5, 7) + 0.5, { s: 1 });
        break;
      }
      case 'chapel': {
        D('runner', 4, 1, { w: 2, h: 7, c: '#5a1414' });
        if (P('altar', 4, 0, 2, 1)) { Lt(4.3, 0.6, 2.2, CANDLE); Lt(5.7, 0.6, 2.2, CANDLE); }
        P('statue', 0, 0, 1, 1, true); P('statue', 9, 0, 1, 1, true);
        for (const ly of [2, 4, 6]) { P('pew', 1, ly, 3, 1); P('pew', 6, ly, 3, 1); }
        break;
      }
      case 'crypt': {
        for (const [lx, ly] of [[1, 1], [3, 1], [6, 1], [8, 1], [1, 5], [3, 5], [6, 5], [8, 5]]) if (chance(0.7)) P('coffin', lx, ly, 1, 2);
        P('sarcophagus', 4, 3, 2, 2);
        for (let i = 0; i < 3; i++) {
          const lx = ri(0, CW - 1) + 0.5, ly = ri(0, CH - 1) + 0.5;
          if (free(lx, ly)) { D('candles', lx, ly); Lt(lx, ly, 1.9, CANDLE); }
        }
        for (let i = 0; i < 4; i++) { const lx = rnd() * CW, ly = rnd() * CH; if (free(lx, ly)) D('bones', lx, ly, { r: rnd() * 6.28 }); }
        break;
      }
      case 'salon': {
        D('rug', 2, 2, { w: 6, h: 4, c: '#5a2a1a' });
        if (P('fireplace', 4, 0, 2, 1, true)) Lt(5, 1.4, 3.2, FIRE, 'fire');
        P('sofa', 3, 3, 4, 1);
        P('lowtable', 4, 5, 2, 1);
        P('armchair', 1, 2, 1, 1); P('armchair', 8, 2, 1, 1);
        if (chance(0.5)) P('piano', 7, 5, 2, 2); else P('piano', 0, 5, 2, 2);
        break;
      }
      case 'gallery': {
        for (const [lx, ly] of [[2, 2], [7, 2], [2, 5], [7, 5]]) P('statue', lx, ly, 1, 1, true);
        P('bench', 4, 3, 2, 1); P('bench', 4, 5, 2, 1);
        P('pedestal', 0, 3, 1, 1); P('pedestal', 9, 4, 1, 1);
        const cb = P('candelabra', pick([0, 9]), 7, 1, 1);
        if (cb) light(cb.x + 0.5, cb.y + 0.5, 2.4, CANDLE, 'candle');
        break;
      }
      case 'storage': {
        for (let i = 0; i < 10; i++) {
          const tall = chance(0.4);
          P(tall ? 'crates' : pick(['crate', 'barrel', 'crate']), ri(0, 9), ri(0, 7), 1, 1, tall);
        }
        if (chance(0.6)) P('crate', ri(0, 8), ri(0, 7), 2, 1);
        break;
      }
      case 'bath': {
        const tx = ri(1, 6);
        P('bathtub', tx, 0, 2, 1, false, { blood: chance(0.65) });
        const sink = P('sink', tx > 4 ? 1 : 8, 0, 1, 1);
        if (sink) light(sink.x + 0.5, sink.y + 0.9, 1.8, CANDLE, 'candle');
        D('blood', tx + 1, 1.6, { s: 0.9 });
        let fx = tx + 1, fy = 2;
        for (let i = 0; i < 6; i++) {
          fx += (rnd() - 0.5) * 1.2; fy += 0.7;
          if (free(fx, fy)) D('steps', fx, fy, { r: Math.PI / 2 + (rnd() - 0.5) * 0.6 });
        }
        break;
      }
      case 'conservatory': {
        P('fountain', 4, 3, 2, 2);
        for (let i = 0; i < 4; i++) P('deadtree', ri(0, 9), ri(0, 7), 1, 1, true);
        for (let i = 0; i < 5; i++) P('plant', ri(0, 9), ri(0, 7), 1, 1);
        P('bench', ri(1, 7), 7, 2, 1);
        break;
      }
      case 'nursery': {
        D('rug', 3, 3, { w: 4, h: 3, c: '#3d4a5e' });
        const crib = P('crib', ri(1, 7), 0, 2, 1);
        if (crib) light(crib.x + 1, crib.y + 1.2, 1.8, PINK, 'candle');
        P('rockinghorse', ri(1, 8), ri(3, 6), 1, 1);
        P('toychest', ri(0, 8), 7, 2, 1);
        for (let i = 0; i < 5; i++) {
          const lx = rnd() * CW, ly = 1 + rnd() * (CH - 1);
          if (free(lx, ly)) D(pick(['doll', 'blocks', 'doll']), lx, ly, { r: rnd() * 6.28 });
        }
        break;
      }
      case 'lab': {
        D('circle', 3, 2, { w: 4, h: 4 });
        for (let lx = 0; lx < CW; lx += 3) P('potions', lx, 0, 2, 1, true);
        if (P('cauldron', 4, 3, 2, 2)) Lt(5, 4, 3, GREEN, 'cauldron');
        P('worktable', 0, 5, 2, 1, false, { flasks: true });
        P('worktable', 8, 5, 2, 1, false, { flasks: true });
        break;
      }
    }
  }

  for (const room of rooms) for (const id of room.cells) furnish(cells[id], room.theme);

  // Décor commun : toiles d'araignée, sang, griffures, citrouilles
  for (const cell of cells) {
    const X = cell.x, Y = cell.y;
    const free = (lx, ly) => get(X + Math.floor(lx), Y + Math.floor(ly)) === TILE.FLOOR;
    for (const [lx, ly, corner] of [[0, 0, 0], [CW - 1, 0, 1], [0, CH - 1, 2], [CW - 1, CH - 1, 3]]) {
      if (chance(0.35)) decals.push({ k: 'web', x: X + lx, y: Y + ly, corner });
    }
    if (chance(0.35)) { const lx = rnd() * CW, ly = rnd() * CH; if (free(lx, ly)) decals.push({ k: 'blood', x: X + lx, y: Y + ly, s: 0.5 + rnd() }); }
    if (chance(0.25)) { const lx = rnd() * CW, ly = rnd() * CH; if (free(lx, ly)) decals.push({ k: 'scratch', x: X + lx, y: Y + ly, r: rnd() * 6.28 }); }
    if (cell.id !== foyer.id && chance(0.3)) {
      const pk = place('pumpkin', X + ri(0, CW - 1), Y + ri(0, CH - 1), 1, 1);
      if (pk) light(pk.x + 0.5, pk.y + 0.5, 2, PUMPKIN, 'pumpkin');
    }
  }

  // Décor mural sur les faces visibles des murs (un mur dont la case du dessous n'est pas un mur)
  let lastWindow = -9;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (get(x, y) !== TILE.WALL) continue;
      const below = get(x, y + 1);
      if (below === TILE.WALL || below === TILE.VOID || below === TILE.EXIT) continue;
      const r = roomIdx[I(x, y + 1)];
      const theme = r >= 0 ? rooms[r].theme : '';
      const blocked = below === TILE.TALL;
      if (y === 0 && !blocked && x - lastWindow > 2 && chance(0.4)) {
        wallDeco.push({ k: 'window', x, y });
        light(x + 0.5, 1.9, 2.8, MOON, 'moon');
        lastWindow = x;
        continue;
      }
      const roll = rnd();
      if (theme === 'gallery' ? roll < 0.45 : roll < 0.08) wallDeco.push({ k: 'painting', x, y, v: ri(0, 3) });
      else if (roll < 0.12 && !blocked) { wallDeco.push({ k: 'sconce', x, y }); light(x + 0.5, y + 1.25, 2.2, CANDLE, 'candle'); }
      else if (theme === 'bath' && roll < 0.3) wallDeco.push({ k: 'mirror', x, y });
      else if (roll < 0.2) wallDeco.push({ k: 'torn', x, y });
    }
  }

  // Emplacements libres par cellule (pour les objets et la créature, côté serveur)
  const spots = cells.map(cell => {
    const list = [];
    for (let y = cell.y; y < cell.y + CH; y++) {
      for (let x = cell.x; x < cell.x + CW; x++) if (tiles[I(x, y)] === TILE.FLOOR && !reserved[I(x, y)]) list.push([x, y]);
    }
    return list;
  });

  return {
    seed, w, h, tiles,
    grid: { cols, rows, cw: CW, ch: CH },
    rooms: rooms.map(r => ({ id: r.id, theme: r.theme, name: r.name })),
    cells: cells.map(c => ({ id: c.id, c: c.c, r: c.r, x: c.x, y: c.y, room: c.room })),
    roomIdx, furniture, decals, lights, wallDeco, exit, spawn,
    foyerCell: foyer.id,
    spots,
  };
}

export function cellOf(map, x, y) {
  const { cols, rows, cw, ch } = map.grid;
  const c = Math.max(0, Math.min(cols - 1, Math.floor((x - 1) / (cw + 1))));
  const r = Math.max(0, Math.min(rows - 1, Math.floor((y - 1) / (ch + 1))));
  return map.cells[r * cols + c];
}
