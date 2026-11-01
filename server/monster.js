// La créature : elle erre, entend les bruits, voit les lampes allumées, poursuit,
// et recule quand on lui braque assez longtemps de la lumière dessus.
import { CFG, batteryFactor } from '../shared/config.js';
import { moveBox, lineOfSight, clearPath, angDiff, solidAt, distanceField, floorAt, crossStairs, levelDist, stairLinks, linksOf } from '../shared/physics.js';
import { cellOf } from '../shared/map.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const canStep = (map, cx, cy, dx, dy) =>
  !solidAt(map, cx + dx, cy + dy) && !(dx && dy && (solidAt(map, cx + dx, cy) || solidAt(map, cx, cy + dy)));

// Plus court chemin entre deux cases (parcours en largeur, 8 directions, sans couper les coins, escaliers compris).
export function findPath(map, sx, sy, gx, gy) {
  const { w, h } = map;
  if (gx < 0 || gy < 0 || gx >= w || gy >= h || solidAt(map, gx, gy)) return null;
  const start = sy * w + sx, goal = gy * w + gx;
  if (start === goal) return [];
  const links = stairLinks(map);
  const prev = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  prev[start] = start;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cx = cur % w, cy = (cur - cx) / w;
    for (const [dx, dy] of DIRS) {
      if (!canStep(map, cx, cy, dx, dy)) continue;
      const ni = (cy + dy) * w + cx + dx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
    for (const ni of linksOf(links, cur)) {
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let i = goal; i !== start; i = prev[i]) path.push([(i % w) + 0.5, Math.floor(i / w) + 0.5]);
  return path.reverse();
}

export class Monster {
  constructor(id, x, y) {
    this.id = id;
    this.x = x; this.y = y; this.a = Math.PI / 2;
    this.state = 'dormant'; this.stateT = 0;
    this.path = []; this.goal = null; this.repath = 0;
    this.target = null; this.lastSeen = null; this.lostT = 0;
    this.exposure = 0; this.cooldown = 0; this.lit = false;
    this.bored = 0; this.stuck = 0; this.fleeFrom = null;
  }

  setState(s, t = 0) { this.state = s; this.stateT = t; }

  goTo(map, x, y, exact = false) {
    const p = findPath(map, Math.floor(this.x), Math.floor(this.y), Math.floor(x), Math.floor(y));
    if (!p) { this.path = []; return false; }
    if (exact) p.push([x, y]);
    this.path = p;
    this.goal = { x, y };
    return true;
  }

  // S'éloigner d'un point en remontant son champ de distance.
  runFrom(map, fx, fy, steps) {
    const dist = distanceField(map, fx, fy);
    const { w } = map;
    let cx = Math.floor(this.x), cy = Math.floor(this.y);
    const path = [];
    for (let s = 0; s < steps; s++) {
      let best = null, bd = dist[cy * w + cx];
      for (const [dx, dy] of DIRS) {
        if (!canStep(map, cx, cy, dx, dy)) continue;
        const d = dist[(cy + dy) * w + cx + dx];
        if (d > bd) { bd = d; best = [cx + dx, cy + dy]; }
      }
      if (!best) break;
      [cx, cy] = best;
      path.push([cx + 0.5, cy + 0.5]);
    }
    this.path = path;
    this.goal = path.length ? { x: path[path.length - 1][0], y: path[path.length - 1][1] } : null;
  }

  // Choisit une destination d'errance, souvent près d'un joueur pour garder la pression.
  wander(g) {
    const map = g.map;
    const alive = g.players.filter(p => p.state === 'alive');
    let cell;
    if (alive.length && Math.random() < 0.55) {
      const p = alive[Math.floor(Math.random() * alive.length)];
      const pc = cellOf(map, p.x, p.y);
      const near = map.cells.filter(c => c.f === pc.f && Math.abs(c.c - pc.c) + Math.abs(c.r - pc.r) <= 1);
      cell = near[Math.floor(Math.random() * near.length)];
    } else {
      cell = map.cells[Math.floor(Math.random() * map.cells.length)];
    }
    const spots = map.spots[cell.id];
    if (!spots.length) return;
    const [x, y] = spots[Math.floor(Math.random() * spots.length)];
    this.goTo(map, x + 0.5, y + 0.5);
  }

  update(dt, g) {
    const M = CFG.monster, map = g.map;
    if (this.state === 'dormant') {
      if (g.time >= M.dormant) { this.setState('wander'); g.emit('wake', { id: this.id }); }
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.stateT -= dt;
    const alive = g.players.filter(p => p.state === 'alive');

    // Lampes braquées sur elle
    let beams = 0, scarer = null, scarerD = Infinity;
    if (this.state !== 'flee') {
      for (const p of alive) {
        if (!p.light || p.battery <= 0) continue;
        const d = Math.hypot(this.x - p.x, this.y - p.y);
        if (d > CFG.light.range * batteryFactor(p.battery) + 0.3) continue;
        const off = Math.abs(angDiff(Math.atan2(this.y - p.y, this.x - p.x), p.a));
        if (off > CFG.light.cone + Math.atan2(0.45, Math.max(d, 0.1))) continue;
        if (!lineOfSight(map, p.x, p.y, this.x, this.y)) continue;
        beams++;
        if (d < scarerD) { scarerD = d; scarer = p; }
      }
    }
    this.lit = beams > 0 && this.cooldown <= 0;
    if (this.lit) this.exposure += dt * (1 + 0.6 * (beams - 1));
    else this.exposure = Math.max(0, this.exposure - dt * 0.5);
    if (this.lit && this.exposure >= M.stunNeed) {
      this.exposure = 0;
      this.lit = false;
      this.cooldown = M.stunCooldown;
      this.setState('flee', M.fleeTime);
      this.target = null;
      this.fleeFrom = { x: scarer.x, y: scarer.y };
      this.runFrom(map, scarer.x, scarer.y, 14);
      scarer.stats.stuns++;
      g.emit('stun', { id: this.id, by: scarer.id });
    }

    if (this.state !== 'flee' && this.state !== 'retreat') this.perceive(dt, g, alive);

    let speed = M.speed[this.state] ?? M.speed.wander;
    switch (this.state) {
      case 'wander':
        this.bored += dt;
        if (alive.length && this.bored > M.boredom * (g.exitOpen ? 0.35 : 1)) {
          this.bored = 0;
          const p = alive[Math.floor(Math.random() * alive.length)];
          this.setState('investigate');
          this.goTo(map, p.x, p.y);
        } else if (!this.path.length) this.wander(g);
        break;
      case 'investigate':
        if (!this.path.length) this.setState('search', 2 + Math.random() * 2);
        break;
      case 'search':
        this.a += dt * 2.2;
        if (this.stateT <= 0) this.setState('wander');
        break;
      case 'chase':
        this.repath -= dt;
        if (this.repath <= 0 || !this.path.length) {
          this.repath = 0.25;
          this.goTo(map, this.lastSeen.x, this.lastSeen.y, true);
        }
        break;
      case 'flee':
        if (this.stateT <= 0) this.setState('wander');
        else if (!this.path.length && this.fleeFrom) this.runFrom(map, this.fleeFrom.x, this.fleeFrom.y, 10);
        break;
      case 'retreat':
        if (this.stateT <= 0) this.setState('wander');
        break;
    }
    speed *= g.diff.speed * (1 + M.perSkull * g.skullsFound + (g.exitOpen ? M.exitBonus : 0));
    if (this.lit) speed *= M.litSlow;
    this.move(map, speed, dt);

    // Attrape les joueurs à portée
    if (this.state !== 'flee' && this.state !== 'retreat') {
      for (const p of alive) {
        if (g.time < p.immune || Math.hypot(p.x - this.x, p.y - this.y) > M.catchDist) continue;
        g.down(p, this);
        this.setState('retreat', 4);
        this.target = null;
        this.runFrom(map, p.x, p.y, 12);
        break;
      }
    }
  }

  perceive(dt, g, alive) {
    const M = CFG.monster, map = g.map;
    let seen = null, sd = Infinity;
    for (const p of alive) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      const range = (p.light && p.battery > 0 ? M.sightLit : M.sightDark) * g.diff.sight;
      if (d < range && d < sd && lineOfSight(map, this.x, this.y, p.x, p.y)) { seen = p; sd = d; }
    }
    if (seen) {
      if (this.state !== 'chase' || this.target !== seen) {
        g.emit('spot', { id: this.id, target: seen.id });
        this.repath = 0;
      }
      this.setState('chase');
      this.target = seen;
      this.lostT = 0;
      this.bored = 0;
      this.lastSeen = { x: seen.x, y: seen.y };
      return;
    }
    if (this.state === 'chase') {
      this.lostT += dt;
      const t = this.target;
      if (t && t.state === 'alive' && this.lostT < M.memory) { this.lastSeen = { x: t.x, y: t.y }; return; }
      this.setState('investigate');
      this.target = null;
      this.goTo(map, this.lastSeen.x, this.lastSeen.y);
      return;
    }
    // Bruits : courir, ramasser un crâne, relever un ami… (les plus forts s'entendent d'un étage à l'autre)
    let best = null, score = 0;
    for (const n of g.noises) {
      const d = levelDist(map, this.x, this.y, n.x, n.y);
      const r = n.loud || lineOfSight(map, this.x, this.y, n.x, n.y) ? n.r : n.r * 0.6;
      if (d < r && r - d > score) { best = n; score = r - d; }
    }
    if (!best) return;
    const goal = this.goal;
    if (this.state !== 'investigate' || !goal || best.loud || Math.hypot(best.x - goal.x, best.y - goal.y) > 2) {
      this.setState('investigate');
      this.goTo(map, best.x, best.y);
      this.bored = 0;
    }
  }

  move(map, speed, dt) {
    if (speed <= 0 || !this.path.length) { this.stuck = 0; return; }
    const half = CFG.monster.half;
    while (this.path.length >= 2 && clearPath(map, this.x, this.y, this.path[1][0], this.path[1][1], half)) this.path.shift();
    let rem = speed * dt;
    for (let guard = 0; guard < 4 && rem > 1e-4 && this.path.length; guard++) {
      // étape suivante à l'étage d'à côté : on monte (ou descend) l'escalier vers le même endroit
      const tx = this.path[0][0] - (floorAt(map, this.path[0][0]) - floorAt(map, this.x)) * map.stride, ty = this.path[0][1];
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      if (d < 0.05) { this.path.shift(); continue; }
      const step = Math.min(rem, d);
      const [nx, ny] = moveBox(map, this.x, this.y, (dx / d) * step, (dy / d) * step, half);
      const moved = Math.hypot(nx - this.x, ny - this.y);
      [this.x, this.y] = crossStairs(map, nx, ny);
      rem -= step;
      this.turnTo(Math.atan2(dy, dx), dt);
      if (moved < step * 0.25) {
        this.stuck += dt;
        if (this.stuck > 0.6) { this.path = []; this.stuck = 0; }
        break;
      }
      this.stuck = 0;
    }
  }

  turnTo(target, dt) {
    const d = angDiff(target, this.a), max = 9 * dt;
    this.a += Math.max(-max, Math.min(max, d));
  }
}
