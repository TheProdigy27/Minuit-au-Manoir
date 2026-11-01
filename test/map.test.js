// Manoir à étages : génération, escaliers, chemins de la créature d'un étage à l'autre.
// Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, CFG } from '../shared/config.js';
import { generateMap, cellOf } from '../shared/map.js';
import { distanceField, moveBox, crossStairs, floorAt, stairAt, levelDist } from '../shared/physics.js';
import { Monster, findPath } from '../server/monster.js';
import { Game } from '../server/game.js';

const SEEDS = [1, 7, 42, 999, 2024, 31337, 123456];
const COUNTS = [1, 2, 3, 4, 5, 8];

test('chaque étage est entièrement accessible depuis le hall, escaliers compris', () => {
  for (const n of COUNTS) {
    for (const seed of SEEDS) {
      const map = generateMap(seed, n);
      assert.equal(map.floors.length, n <= 2 ? 2 : 3);
      assert.equal(floorAt(map, map.spawn.x), map.ground);
      for (let f = 0; f < map.floors.length - 1; f++) assert.ok(map.stairs.some(s => s.f === f), `escalier ${f} → ${f + 1}`);
      const dist = distanceField(map, map.spawn.x, map.spawn.y);
      for (let i = 0; i < map.w * map.h; i++) {
        if (map.tiles[i] === TILE.FLOOR || map.tiles[i] === TILE.STAIR) assert.ok(dist[i] >= 0, `case ${i % map.w},${Math.floor(i / map.w)} isolée (n=${n}, graine ${seed})`);
      }
      for (const cell of map.cells) assert.ok(map.spots[cell.id].length > 0, `cellule ${cell.id} sans place libre`);
    }
  }
});

test('le manoir est plus grand qu’avant (au moins deux fois plus de pièces élémentaires)', () => {
  const before = { 2: 12, 4: 20, 8: 24 };
  for (const [n, cells] of Object.entries(before)) assert.ok(generateMap(5, +n).cells.length >= 2 * cells * 0.9);
});

// Monte (puis redescend) chaque escalier en marchant droit devant, comme un joueur.
test('on monte et on descend les escaliers en marchant', () => {
  const map = generateMap(42, 4);
  for (const s of map.stairs) {
    const lo = map.floors[s.f].ox, hi = map.floors[s.f + 1].ox, y = s.y + s.wid / 2;
    // deux cases avant le pied de l'escalier, sur l'étage du bas
    let x = lo + (s.dx > 0 ? s.x - 1.5 : s.x + s.len + 1.5);
    for (let i = 0; i < 400; i++) {
      [x] = moveBox(map, x, y, s.dx * 0.05, 0, CFG.player.half);
      [x] = crossStairs(map, x, y);
    }
    assert.equal(floorAt(map, x), s.f + 1, 'arrivé à l’étage du dessus');
    assert.equal(stairAt(map, x, y), null, 'sorti de l’escalier, sur le palier');
    assert.ok(Math.abs(x - hi - (s.dx > 0 ? s.x + s.len : s.x)) < 6);
    for (let i = 0; i < 400; i++) {
      [x] = moveBox(map, x, y, -s.dx * 0.05, 0, CFG.player.half);
      [x] = crossStairs(map, x, y);
    }
    assert.equal(floorAt(map, x), s.f, 'redescendu');
    assert.equal(stairAt(map, x, y), null);
  }
});

test('la créature suit un chemin jusqu’à un autre étage', () => {
  const map = generateMap(2024, 5);
  const top = map.floors.length - 1;
  const goal = map.spots[map.cells.filter(c => c.f === top).at(-1).id][0];
  const path = findPath(map, Math.floor(map.spawn.x), Math.floor(map.spawn.y), goal[0], goal[1]);
  assert.ok(path && path.length > 10);
  const m = new Monster(0, map.spawn.x + 0.5, map.spawn.y + 0.5);
  m.goTo(map, goal[0] + 0.5, goal[1] + 0.5);
  for (let i = 0; i < 4000 && m.path.length; i++) m.move(map, CFG.monster.speed.chase, 1 / 30);
  assert.equal(m.path.length, 0, 'chemin terminé');
  assert.equal(floorAt(map, m.x), top);
  assert.ok(Math.hypot(m.x - goal[0] - 0.5, m.y - goal[1] - 0.5) < 0.2);
  assert.equal(cellOf(map, m.x, m.y).f, top);
});

test('un étage d’écart compte dans les distances pour entendre', () => {
  const map = generateMap(7, 4);
  const x = map.spawn.x, y = map.spawn.y;
  assert.equal(levelDist(map, x, y, x + 3, y), 3);
  assert.equal(levelDist(map, x, y, x + map.stride, y), 8);
});

test('les crânes sont répartis sur tous les étages', () => {
  for (const seed of SEEDS) {
    const map = generateMap(seed, 6);
    const players = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: 'J' + i, connected: true }));
    const game = new Game(map, players, 'normal', () => {});
    const floors = new Set(game.items.filter(it => it.type === 'skull').map(it => floorAt(map, it.x)));
    assert.equal(floors.size, map.floors.length, `graine ${seed}`);
    assert.equal(game.monsters.length, 2);
  }
});
