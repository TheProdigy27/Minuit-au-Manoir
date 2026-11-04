// Une partie : placement des objets, règles (ramassage, réanimation, sortie) et fin de partie.
import { CFG, DIFFICULTY, PLAYER_STATES, MONSTER_STATES, voiceNoise } from '../shared/config.js';
import { distanceField, solidAt } from '../shared/physics.js';
import { hideEntry, front } from '../shared/hide.js';
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
        return { spots, d, f: c.f };
      })
      .sort((a, b) => b.d - a.d);
    const takeSpot = list => {
      const info = list.find(r => r.spots.length);
      if (!info) return [map.spawn.x + 0.5, map.spawn.y + 0.5];
      const [x, y] = info.spots.splice(Math.floor(Math.random() * info.spots.length), 1)[0];
      return [x + 0.5, y + 0.5];
    };
    let id = 1;

    // Crânes : un par pièce, dans les pièces les plus éloignées du hall, pris à tour de rôle sur
    // chaque étage (il faut tous les visiter)
    this.skullsTotal = 4 + Math.floor(n / 3) + this.diff.skulls;
    const far = rooms.slice(0, Math.max(this.skullsTotal, Math.ceil(rooms.length * 0.75)));
    const byFloor = shuffle(map.floors.map((_, f) => shuffle(far.filter(r => r.f === f))));
    const order = [];
    for (let i = 0; order.length < far.length; i++) for (const list of byFloor) if (list[i]) order.push(list[i]);
    for (let i = 0; i < this.skullsTotal; i++) {
      const [x, y] = takeSpot([order[i % order.length], ...order]);
      this.items.push({ id: id++, type: 'skull', x, y, taken: false });
    }
    // Piles pour les lampes, n'importe où
    for (let i = 0; i < 4 + 2 * n + 3 * map.floors.length; i++) {
      const [x, y] = takeSpot([rooms[Math.floor(Math.random() * rooms.length)], ...rooms]);
      this.items.push({ id: id++, type: 'battery', x, y, taken: false });
    }
    // Créatures, chacune dans la pièce la plus lointaine d'un étage différent
    const lairs = map.floors.map((_, f) => rooms.find(r => r.f === f)).filter(Boolean).sort((a, b) => b.d - a.d);
    const count = (n >= 3 ? 2 : 1) + this.diff.monsters;
    for (let i = 0; i < count; i++) {
      const [x, y] = takeSpot([lairs[i % lairs.length], ...rooms]);
      this.monsters.push(new Monster(i, x, y));
    }
    // Joueurs, groupés au centre du hall
    const offsets = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]];
    this.players.forEach((p, i) => {
      const [ox, oy] = offsets[i % offsets.length];
      Object.assign(p, {
        x: map.spawn.x + ox, y: map.spawn.y + oy, a: -Math.PI / 2,
        state: 'alive', light: true, running: false, moving: false, act: false,
        battery: 100, downT: 0, revive: 0, immune: 0, endTime: 0, left: false, discAt: 0, lastPing: -99, voice: 0, hide: null, creak: 0,
        stats: { skulls: 0, revives: 0, downs: 0, stuns: 0 },
      });
    });
  }

  input(p, m) {
    if (p.state === 'escaped' || p.state === 'spectator') return;
    if (Number.isFinite(m.a)) p.a = m.a;
    // Caché·e : immobile, lampe éteinte (la page envoie encore un instant sa position d'avant)
    if (p.hide) return;
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) {
      const x = Math.max(0, Math.min(this.map.w, m.x)), y = Math.max(0, Math.min(this.map.h, m.y));
      // jamais dans un meuble ou un mur (sauf un fantôme) : une position d'avant la sortie d'une cachette
      if (p.state === 'dead' || !solidAt(this.map, Math.floor(x), Math.floor(y), this.exitOpen)) { p.x = x; p.y = y; }
    }
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

  // Une trame du chat vocal de `p` (`db` : son niveau) : la créature l'entend comme un bruit, d'autant plus
  // loin qu'on parle fort. Les fantômes et ceux qui ont fui ne sont plus dans le manoir.
  voice(p, db) {
    if (p.state === 'alive' || p.state === 'down') p.voice = Math.max(p.voice, voiceNoise(db));
  }

  // Se cacher dans la cachette n° `s` du manoir (s < 0 : en sortir). Refusé si l'on n'est pas debout, trop
  // loin du meuble, ou que quelqu'un s'y cache déjà. La créature qui vous voit y entrer vient vous en tirer.
  hide(p, s) {
    if (!Number.isInteger(s)) return;
    if (s < 0) { if (p.hide) this.leave(p); return; }
    const spot = this.map.hides[s];
    const at = spot && p.state === 'alive' && !p.hide && !this.players.some(q => q.hide?.s === s)
      && hideEntry(this.map, spot, p.x, p.y, CFG.hide.reach + 0.6); // un peu de marge : la page a bougé depuis
    if (!at) { if (!p.hide) this.emit('unhide', { id: p.id, no: 1 }); return; }
    const seenBy = CFG.hide.seen ? this.monsters.filter(m => m.sees(this, p)) : []; // avant que sa lampe ne s'éteigne
    p.hide = { s, ...at };
    Object.assign(p, { x: at.x, y: at.y, a: at.a, light: false, running: false, moving: false, act: false, creak: CFG.noise.hide });
    this.emit('hide', { id: p.id, s, x: r2(at.x), y: r2(at.y), a: r2(at.a), ex: at.ex, ey: at.ey });
    for (const m of seenBy) m.hunt(this, p, 'seen');
  }

  // Sortir de sa cachette, devant sa porte (`pulled` : tiré·e dehors par la créature).
  leave(p, pulled = false) {
    const h = p.hide;
    p.hide = null;
    p.x = h.ex;
    p.y = h.ey;
    if (!pulled) p.creak = CFG.noise.hide;
    this.emit('unhide', { id: p.id, x: h.ex, y: h.ey, ...(pulled && { pulled: 1 }) });
  }

  // `why` : la créature l'a tiré·e de sa cachette, après l'y avoir vu entrer (seen) ou l'avoir entendu (heard).
  down(p, monster, why) {
    p.state = 'down';
    p.downT = CFG.rules.bleedOut * this.diff.bleed;
    p.revive = 0;
    p.stats.downs++;
    this.emit('down', { id: p.id, by: monster.id, ...(why && { why }) });
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
      if (p.hide && p.state !== 'alive') p.hide = null; // mort d'avoir quitté la partie
      // Les bruits d'un joueur caché (`who`) disent à la créature où il est ; elle irait voir devant sa porte (gx, gy).
      const who = p.hide ? p : null, [gx, gy] = front(p);
      // Sa voix, debout ou à terre : un bruit qui suit le joueur tant qu'il parle (étouffé par une armoire)
      if (p.voice > 0) {
        const V = CFG.noise.voice;
        if (p.state === 'alive' || p.state === 'down') this.noises.push({ x: p.x, y: p.y, r: p.voice, loud: p.voice >= V.shout, who, gx, gy });
        p.voice = Math.max(0, p.voice - V.fade * dt);
      }
      // La porte de sa cachette qui grince
      if (p.creak) {
        this.noises.push({ x: gx, y: gy, r: p.creak, who });
        p.creak = 0;
      }
      if (p.state !== 'alive' || p.hide) continue;
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
      if (p.state !== 'alive' || !p.act || p.hide) continue;
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
        (p.state === 'alive' && p.light && p.battery > 0 ? 1 : 0) | (p.running ? 2 : 0) | (p.moving ? 4 : 0) | (p.connected ? 0 : 8) | (p.hide ? 16 : 0),
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
