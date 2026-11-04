// Cachettes : leur place sur la carte, y entrer et en sortir, et ce que la créature peut y faire.
// Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, CFG } from '../shared/config.js';
import { generateMap, cellOf } from '../shared/map.js';
import { distanceField, lineOfSight, floorAt } from '../shared/physics.js';
import { HIDES, hideAt, hideEntry } from '../shared/hide.js';
import { Game } from '../server/game.js';

const SEEDS = [1, 7, 42, 999, 2024];

test('chaque étage a des cachettes dans au moins une cellule sur deux, toutes accessibles', () => {
  for (const n of [1, 3, 5]) {
    for (const seed of SEEDS) {
      const map = generateMap(seed, n);
      const dist = distanceField(map, map.spawn.x, map.spawn.y);
      for (let f = 0; f < map.floors.length; f++) {
        const cells = map.cells.filter(c => c.f === f);
        const used = new Set(map.hides.filter(s => floorAt(map, s.x) === f).map(s => cellOf(map, s.x, s.y).id));
        assert.ok(used.size >= Math.ceil(cells.length / CFG.hide.spread), `étage ${f} (n=${n}, graine ${seed}) : ${used.size} cellules`);
      }
      for (const s of map.hides) {
        assert.ok(s.k in HIDES);
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) assert.equal(hideAt(map, x + 0.5, y + 0.5), s);
        // on peut s'y glisser depuis une case libre, que l'on atteint depuis le hall
        const from = entryTile(map, s);
        assert.ok(from, `cachette ${s.id} (${s.k}) fermée de tous côtés`);
        assert.ok(dist[Math.floor(from.ey) * map.w + Math.floor(from.ex)] >= 0, `cachette ${s.id} inaccessible`);
      }
    }
  }
});

// Une case libre d'où l'on peut entrer dans la cachette s (avec où l'on s'y tient et où l'on ressort).
function entryTile(map, s) {
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      if (map.tiles[y * map.w + x] !== TILE.FLOOR) continue;
      const at = hideEntry(map, s, x + 0.5, y + 0.5);
      if (at) return { ...at, px: x + 0.5, py: y + 0.5 };
    }
  }
  return null;
}

// Une partie à deux, une armoire, la créature réveillée mais loin ; Alice se tient devant l'armoire.
function setup() {
  const map = generateMap(42, 2);
  const players = ['Alice', 'Bob'].map((name, i) => ({ id: i + 1, name, connected: true, inGame: true, ws: null }));
  const events = [];
  const game = new Game(map, players, 'normal', (k, data) => events.push({ k, ...data }));
  const s = map.hides.find(h => h.k === 'wardrobe' && entryTile(map, h));
  const e = entryTile(map, s);
  const [a, b] = players;
  Object.assign(a, { x: e.px, y: e.py });
  Object.assign(b, { x: map.spawn.x, y: map.spawn.y });
  game.time = CFG.monster.dormant + 1;
  game.monsters.length = 1;
  const m = game.monsters[0];
  // la créature dans une case dégagée, à `d` cases de l'endroit (x, y), en vue ou non
  m.place = (x, y, d0, d1, seen) => {
    for (let ty = 1; ty < map.h - 1; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const cx = tx + 0.5, cy = ty + 0.5, d = Math.hypot(cx - x, cy - y);
        if (map.tiles[ty * map.w + tx] !== TILE.FLOOR || d < d0 || d > d1 || floorAt(map, cx) !== floorAt(map, x)) continue;
        if (seen !== undefined && lineOfSight(map, cx, cy, x, y) !== seen) continue;
        Object.assign(m, { x: cx, y: cy, path: [], goal: null, bored: 0, fetch: null, target: null, cooldown: 0, exposure: 0 });
        m.setState('wander');
        return true;
      }
    }
    return false;
  };
  m.place(map.spawn.x, map.spawn.y, 30, 1e9);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) game.update(1 / 30); };
  return { map, game, events, s, e, a, b, m, tick };
}

test('se cacher, ne plus bouger, puis ressortir devant la porte', () => {
  const { game, events, s, e, a, b, tick } = setup();
  a.light = true;
  game.hide(a, s.id);
  assert.ok(a.hide, 'Alice est cachée');
  assert.equal(a.hide.s, s.id);
  assert.deepEqual([a.x, a.y], [e.x, e.y], 'dans l’armoire, juste derrière la porte');
  assert.equal(a.light, false, 'lampe éteinte');
  assert.equal(events.at(-1).k, 'hide');

  // la page envoie encore sa position d'avant, ou essaie de bouger : rien n'y fait
  game.input(a, { x: e.px + 2, y: e.py, a: 1, l: 1, r: 1, m: 1 });
  assert.deepEqual([a.x, a.y, a.light, a.moving], [e.x, e.y, false, false]);
  assert.equal(a.a, 1, 'elle peut tourner la tête');

  // une seule personne par cachette, et pas de loin
  Object.assign(b, { x: e.px, y: e.py });
  game.hide(b, s.id);
  assert.equal(b.hide, null, 'déjà occupée');
  const other = game.map.hides.find(h => h !== s && entryTile(game.map, h));
  Object.assign(b, { x: game.map.spawn.x, y: game.map.spawn.y });
  game.hide(b, other.id);
  assert.equal(b.hide, null, 'trop loin');

  tick(30);
  assert.equal(a.state, 'alive');
  game.hide(a, -1);
  assert.equal(a.hide, null);
  assert.deepEqual([a.x, a.y], [e.ex, e.ey], 'elle ressort devant la porte');
  assert.equal(events.at(-1).k, 'unhide');
  // une position dans un meuble (envoyée avant d'avoir appris la sortie) est ignorée
  game.input(a, { x: e.x, y: e.y, a: 0 });
  assert.deepEqual([a.x, a.y], [e.ex, e.ey]);
});

test('cachée, la créature passe devant sans la voir ni l’attraper', () => {
  const { game, s, e, a, m, tick } = setup();
  m.setState('dormant');
  game.hide(a, s.id);
  tick(); // la porte a grincé : de là où elle était, elle ne l'a pas entendue
  // réveillée juste devant l'armoire
  Object.assign(m, { x: e.ex, y: e.ey });
  m.setState('wander');
  for (let i = 0; i < 90; i++) {
    tick();
    assert.notEqual(m.state, 'chase', 'elle ne la voit pas');
  }
  assert.equal(a.state, 'alive');
  assert.ok(a.hide);
});

test('vue en train de se cacher, la créature vient l’en tirer', () => {
  const { game, events, s, e, a, m, tick } = setup();
  a.light = true; a.battery = 100;
  assert.ok(m.place(e.px, e.py, 4, 6, true), 'une case en vue, à quelques pas');
  game.hide(a, s.id);
  assert.equal(m.fetch?.p, a, 'elle l’a vue entrer');
  assert.equal(m.state, 'chase');
  for (let i = 0; i < 30 * 8 && a.state === 'alive'; i++) tick();
  assert.equal(a.state, 'down', 'tirée de l’armoire');
  assert.equal(a.hide, null);
  assert.deepEqual([a.x, a.y], [e.ex, e.ey]);
  const down = events.find(ev => ev.k === 'down');
  assert.equal(down.why, 'seen');
  assert.ok(events.some(ev => ev.k === 'unhide' && ev.pulled));
});

test('cachée, parler la trahit de près ; un murmure, non', () => {
  const { game, events, s, a, m, tick } = setup();
  m.setState('dormant');
  game.hide(a, s.id);
  tick();
  // la créature à deux pas de l'armoire (elle ne voit pas à l'intérieur)
  assert.ok(m.place(a.x, a.y, 1.6, CFG.hide.hear - 0.2));

  game.voice(a, -45); // murmure
  tick(10);
  assert.equal(m.fetch, null);
  assert.equal(a.state, 'alive');

  game.voice(a, CFG.noise.voice.db); // voix normale, étouffée par l'armoire
  tick();
  assert.equal(m.fetch?.p, a, 'elle l’a entendue');
  for (let i = 0; i < 30 * 6 && a.state === 'alive'; i++) tick();
  assert.equal(a.state, 'down');
  assert.equal(events.find(ev => ev.k === 'down').why, 'heard');
});

test('de plus loin, elle vient voir devant la cachette, et repart si tout se tait', () => {
  const { game, s, e, a, m, tick } = setup();
  m.setState('dormant');
  game.hide(a, s.id);
  tick();
  assert.ok(m.place(a.x, a.y, 5, 7));
  game.voice(a, -6); // un cri : traverse les murs
  tick();
  assert.equal(m.fetch, null, 'trop loin pour savoir qu’elle est dedans');
  assert.equal(m.state, 'investigate');
  assert.ok(Math.hypot(m.goal.x - e.ex, m.goal.y - e.ey) < 0.01, 'elle va devant la porte');
  for (let i = 0; i < 30 * 15; i++) tick();
  assert.equal(a.state, 'alive', 'silencieuse, elle n’a rien trouvé');
});

test('un ami qui braque sa lampe sur la créature sauve celle qui est cachée', () => {
  const { game, s, e, a, b, m, tick } = setup();
  a.light = true;
  assert.ok(m.place(e.px, e.py, 4, 6, true));
  game.hide(a, s.id);
  assert.equal(m.fetch?.p, a);
  // Bob tout près de la créature, lampe braquée sur elle
  Object.assign(b, { light: true, battery: 100 });
  for (let i = 0; i < 30 * 3 && m.state !== 'flee'; i++) {
    // il la suit à un pas et demi, lampe braquée sur elle
    for (let k = 0; k < 8; k++) {
      const x = m.x + 1.5 * Math.cos(k * Math.PI / 4), y = m.y + 1.5 * Math.sin(k * Math.PI / 4);
      if (game.map.tiles[Math.floor(y) * game.map.w + Math.floor(x)] !== TILE.FLOOR || !lineOfSight(game.map, x, y, m.x, m.y)) continue;
      Object.assign(b, { x, y, a: Math.atan2(m.y - y, m.x - x) });
      break;
    }
    tick();
  }
  assert.equal(m.state, 'flee');
  assert.equal(m.fetch, null);
});
