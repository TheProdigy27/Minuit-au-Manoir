// Une partie : placement des objets, règles (ramassage, réanimation, sortie) et fin de partie.
import { CFG, DIFFICULTY, PLAYER_STATES, MONSTER_STATES } from '../shared/config.js';
import { distanceField } from '../shared/physics.js';
import { Monster } from './monster.js';

const r2 = v => Math.round(v * 100) / 100;
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export class Game {
  constructor(map, players, difficulty, emit) {
    this.map = map;
    this.players = players;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.emit = emit;
    this.time = 0;
    this.items = [];
    this.monsters = [];
    this.noises = [];
    this.skullsFound = 0;
    this.skullsTotal = 0;
    this.exitOpen = false;
    this.over = false;
    this.nextThunder = 20 + Math.random() * 25;
    this.setup();
  }

  setup() {
    const { map } = this;
    const n = this.players.length;
    const dist = distanceField(map, map.spawn.x, map.spawn.y);
    const rooms = map.cells
      .filter(c => c.id !== map.foyerCell && map.spots[c.id].length)
      .map(c => {
        const spots = map.spots[c.id].slice();
        const d = spots.reduce((s, [x, y]) => s + Math.max(0, dist[y * map.w + x]), 0) / spots.length;
        return { spots, d };
      })
      .sort((a, b) => b.d - a.d);
    const takeSpot = list => {
      const info = list.find(r => r.spots.length);
      if (!info) return [map.spawn.x + 0.5, map.spawn.y + 0.5];
      const [x, y] = info.spots.splice(Math.floor(Math.random() * info.spots.length), 1)[0];
      return [x + 0.5, y + 0.5];
    };
    let id = 1;

    // Crânes : un par pièce, dans les pièces les plus éloignées du hall
    this.skullsTotal = 4 + Math.floor(n / 3) + this.diff.skulls;
    const far = shuffle(rooms.slice(0, Math.max(this.skullsTotal, Math.ceil(rooms.length * 0.75))));
    for (let i = 0; i < this.skullsTotal; i++) {
      const [x, y] = takeSpot([far[i % far.length], ...far]);
      this.items.push({ id: id++, type: 'skull', x, y, taken: false });
    }
    // Piles pour les lampes, n'importe où
    for (let i = 0; i < 5 + 2 * n; i++) {
      const [x, y] = takeSpot([rooms[Math.floor(Math.random() * rooms.length)], ...rooms]);
      this.items.push({ id: id++, type: 'battery', x, y, taken: false });
    }
    // Créatures, dans les pièces les plus lointaines
    const count = (n >= 5 ? 2 : 1) + this.diff.monsters;
    for (let i = 0; i < count; i++) {
      const [x, y] = takeSpot([rooms[i % Math.min(3, rooms.length)], ...rooms]);
      this.monsters.push(new Monster(i, x, y));
    }
    // Joueurs, groupés au centre du hall
    const offsets = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]];
    this.players.forEach((p, i) => {
      const [ox, oy] = offsets[i % offsets.length];
      Object.assign(p, {
        x: map.spawn.x + ox, y: map.spawn.y + oy, a: -Math.PI / 2,
        state: 'alive', light: true, running: false, moving: false, act: false,
        battery: 100, downT: 0, revive: 0, immune: 0, endTime: 0, left: false, discAt: 0, lastPing: -99,
        stats: { skulls: 0, revives: 0, downs: 0, stuns: 0 },
      });
    });
  }

  input(p, m) {
    if (p.state === 'escaped' || p.state === 'spectator') return;
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) {
      p.x = Math.max(0, Math.min(this.map.w, m.x));
      p.y = Math.max(0, Math.min(this.map.h, m.y));
    }
    if (Number.isFinite(m.a)) p.a = m.a;
    p.light = !!m.l;
    p.running = !!m.r;
    p.moving = !!m.m;
    p.act = !!m.e;
  }

  ping(p, m) {
    if (p.state !== 'dead' || this.time - p.lastPing < CFG.rules.pingCooldown) return;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    p.lastPing = this.time;
    this.emit('ping', { id: p.id, x: r2(m.x), y: r2(m.y) });
  }

  down(p, monster) {
    p.state = 'down';
    p.downT = CFG.rules.bleedOut * this.diff.bleed;
    p.revive = 0;
    p.stats.downs++;
    this.emit('down', { id: p.id, by: monster.id });
  }

  take(it, p) {
    it.taken = true;
    if (it.type === 'skull') {
      this.skullsFound++;
      p.stats.skulls++;
      this.noises.push({ x: it.x, y: it.y, r: CFG.noise.skull, loud: true });
      this.emit('take', { item: it.id, by: p.id, kind: 'skull', n: this.skullsFound, total: this.skullsTotal });
      if (this.skullsFound >= this.skullsTotal && !this.exitOpen) {
        this.exitOpen = true;
        this.emit('exit', {});
        for (const m of this.monsters) m.bored = 1e9; // elle flaire aussitôt quelqu'un
      }
    } else {
      p.battery = Math.min(100, p.battery + CFG.light.pickup);
      this.noises.push({ x: it.x, y: it.y, r: CFG.noise.battery });
      this.emit('take', { item: it.id, by: p.id, kind: 'battery' });
    }
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    const R = CFG.rules;
    this.noises.length = 0;

    for (const p of this.players) {
      // Déconnecté trop longtemps : considéré comme perdu
      if (!p.connected && (p.state === 'alive' || p.state === 'down') && this.time - p.discAt > R.disconnectGrace) {
        p.state = 'dead';
        p.left = true;
        p.endTime = this.time;
        this.emit('dead', { id: p.id, left: true });
      }
      if (p.state !== 'alive') continue;
      if (p.light && p.battery > 0) p.battery = Math.max(0, p.battery - CFG.light.drain * this.diff.drain * dt);
      if (p.moving) this.noises.push({ x: p.x, y: p.y, r: p.running ? CFG.noise.run : CFG.noise.walk });
      for (const it of this.items) {
        if (it.taken || Math.abs(it.x - p.x) > R.pickupDist || Math.abs(it.y - p.y) > R.pickupDist) continue;
        if (it.type === 'battery' && p.battery > 95) continue; // laissée aux autres
        this.take(it, p);
      }
      const ex = this.map.exit;
      if (this.exitOpen && p.y > ex.y - 0.15 && p.x > ex.x - 0.1 && p.x < ex.x + ex.w + 0.1) {
        p.state = 'escaped';
        p.endTime = this.time;
        this.emit('escape', { id: p.id });
      }
    }

    // Réanimation : rester près d'un ami à terre en maintenant l'action
    const helped = new Set();
    for (const p of this.players) {
      if (p.state !== 'alive' || !p.act) continue;
      let best = null, bd = R.reviveDist;
      for (const q of this.players) {
        if (q.state !== 'down' || helped.has(q.id)) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) continue;
      helped.add(best.id);
      best.revive += dt;
      this.noises.push({ x: p.x, y: p.y, r: CFG.noise.revive });
      if (best.revive >= R.reviveTime) {
        best.state = 'alive';
        best.revive = 0;
        best.immune = this.time + R.reviveImmunity;
        p.stats.revives++;
        this.emit('revive', { id: best.id, by: p.id });
      }
    }
    for (const p of this.players) {
      if (p.state !== 'down' || helped.has(p.id)) continue;
      p.revive = Math.max(0, p.revive - dt * 1.5);
      p.downT -= dt;
      if (p.downT <= 0) {
        p.state = 'dead';
        p.endTime = this.time;
        this.emit('dead', { id: p.id });
      }
    }

    for (const m of this.monsters) m.update(dt, this);

    if (this.time > this.nextThunder) {
      this.nextThunder = this.time + 35 + Math.random() * 50;
      this.emit('thunder', { d: r2(0.4 + Math.random() * 1.6) });
    }

    // Fin : plus personne debout dans le manoir
    if (!this.players.some(p => p.state === 'alive')) this.over = true;
  }

  snapshot() {
    return {
      t: 's',
      T: r2(this.time),
      p: this.players.map(p => [
        p.id, r2(p.x), r2(p.y), r2(p.a),
        PLAYER_STATES.indexOf(p.state),
        (p.state === 'alive' && p.light && p.battery > 0 ? 1 : 0) | (p.running ? 2 : 0) | (p.moving ? 4 : 0) | (p.connected ? 0 : 8),
        Math.ceil(p.battery),
        p.state === 'down' ? Math.ceil(p.downT) : 0,
        p.state === 'down' ? r2(p.revive / CFG.rules.reviveTime) : 0,
      ]),
      m: this.monsters.map(m => [r2(m.x), r2(m.y), r2(m.a), MONSTER_STATES.indexOf(m.state), m.lit ? 1 : 0]),
    };
  }

  results() {
    const outcome = p => (p.state === 'escaped' ? 'escaped' : p.left ? 'left' : p.state === 'down' ? 'lost' : 'dead');
    return this.players.map(p => ({ id: p.id, name: p.name, color: p.color, outcome: outcome(p), ...p.stats }));
  }
}
