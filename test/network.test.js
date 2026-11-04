// Réseau Steam simulé : quelques comptes qui s'échangent des paquets, pour tester electron/network.js
// et la salle de jeu sans Steam ni second ordinateur. Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Network, PlayerSocket, lobbyCode, parseCode } from '../electron/network.js';
import { Room } from '../server/room.js';
import { generateMap } from '../shared/map.js';
import { CFG, TILE, voiceNoise } from '../shared/config.js';
import { lineOfSight } from '../shared/physics.js';
import { Game } from '../server/game.js';

const SteamCallback = { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8 };
const FAST = { poll: 2, beat: 25, connect: 500, lost: 150, giveUp: 900, peer: 250 };
const VERSION = '2.0.0';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function until(cond, what, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`délai dépassé : ${what}`);
    await wait(5);
  }
}

// Comme Steam : les paquets d'un inconnu attendent qu'on accepte sa session, et chacun apprend
// les arrivées et départs du salon avec un peu de retard.
class FakeSteam {
  constructor() {
    this.users = new Map();
    this.lobbies = new Map();
    this.nextLobby = 1;
    this.nextUser = 1;
    this.latency = 3;
    this.memberDelay = 40;
    this.cut = new Set(); // comptes dont le réseau est coupé
    this.sent = [];
  }

  user(name) {
    const id = 76561198000000000n + BigInt(this.nextUser++);
    const handlers = new Map();
    const inbox = [];
    const accepted = new Set();
    const held = new Map();
    const hub = this;
    const user = {
      id,
      fire(cb, value) { for (const fn of handlers.get(cb) || []) fn(value); },
      deliver(from, data) {
        if (accepted.has(from)) return inbox.push({ from, data });
        if (!held.has(from)) {
          held.set(from, []);
          user.fire(SteamCallback.P2PSessionRequest, { remote: from });
        }
        held.get(from)?.push(data);
      },
    };
    user.client = {
      localplayer: { getSteamId: () => ({ steamId64: id }), getName: () => name },
      callback: {
        register(cb, fn) {
          if (!handlers.has(cb)) handlers.set(cb, []);
          handlers.get(cb).push(fn);
          return { disconnect() {} };
        },
      },
      matchmaking: {
        createLobby: async (_type, max) => hub.createLobby(user, max),
        joinLobby: async lobbyId => hub.joinLobby(user, lobbyId),
      },
      networking: {
        sendP2PPacket(to, mode, data) {
          if (mode === 0 && data.length > 1200) return false;
          const target = hub.users.get(to);
          if (!target) return false;
          accepted.add(to); // ouvrir une session vaut acceptation des réponses
          hub.sent.push({ from: id, to, mode, type: String.fromCharCode(data[0]), size: data.length });
          if (hub.cut.has(id) || hub.cut.has(to)) return true;
          const copy = Buffer.from(data);
          setTimeout(() => target.deliver(id, copy), hub.latency);
          return true;
        },
        isP2PPacketAvailable: () => (inbox.length ? inbox[0].data.length : 0),
        readP2PPacket() {
          const p = inbox.shift();
          if (!p) throw new Error('No packet available');
          return { data: p.data, size: p.data.length, steamId: { steamId64: p.from } };
        },
        acceptP2PSession(remote) {
          accepted.add(remote);
          for (const data of held.get(remote) || []) inbox.push({ from: remote, data });
          held.delete(remote);
        },
      },
      overlay: { activateInviteDialog() {} },
    };
    this.users.set(id, user);
    return user;
  }

  createLobby(owner, max) {
    const L = { id: (0x01860000n << 32n) | BigInt(this.nextLobby++), owner: owner.id, max, members: [owner.id], views: new Map(), data: {} };
    L.views.set(owner.id, new Set([owner.id]));
    this.lobbies.set(L.id, L);
    return this.handle(L, owner);
  }

  joinLobby(user, id) {
    const L = this.lobbies.get(id);
    if (!L || L.members.length >= L.max) throw new Error('Failed to join lobby');
    L.members.push(user.id);
    L.views.set(user.id, new Set(L.members));
    this.notify(L, user.id, 'Entered');
    return this.handle(L, user);
  }

  notify(L, changed, change) {
    for (const m of L.members) {
      if (m === changed) continue;
      setTimeout(() => {
        const view = L.views.get(m);
        if (!view) return;
        if (change === 'Entered') view.add(changed); else view.delete(changed);
        this.users.get(m).fire(SteamCallback.LobbyChatUpdate, { lobby: L.id, user_changed: changed, making_change: changed, member_state_change: change });
      }, this.memberDelay);
    }
  }

  handle(L, user) {
    const hub = this;
    return {
      id: L.id,
      leave() {
        const i = L.members.indexOf(user.id);
        if (i < 0) return;
        L.members.splice(i, 1);
        L.views.delete(user.id);
        if (L.owner === user.id) L.owner = L.members[0] ?? 0n;
        hub.notify(L, user.id, 'Left');
      },
      getOwner: () => ({ steamId64: L.owner }),
      getMembers: () => [...(L.views.get(user.id) || [])].map(steamId64 => ({ steamId64 })),
      getData: k => L.data[k] ?? null,
      mergeFullData: data => { Object.assign(L.data, data); return true; },
    };
  }
}

// Ce que fait la page : se présenter à chaque nouvelle session, garder les messages reçus.
function player(hub, name, { version = VERSION } = {}) {
  const user = hub.user(name);
  const net = new Network({ steam: user.client, SteamCallback, version, createRoom: () => new Room(), timing: FAST });
  const p = { user, net, msgs: [], statuses: [] };
  net.on('message', data => p.msgs.push(JSON.parse(data)));
  net.on('status', s => {
    p.statuses.push(s.state + (s.reason ? ':' + s.reason : ''));
    if (s.state === 'connected') net.send(JSON.stringify({ t: 'hello', name, color: '' }));
  });
  p.last = t => p.msgs.findLast(m => m.t === t);
  p.send = (msg, unreliable) => net.send(JSON.stringify(msg), unreliable);
  return p;
}

async function hostAndJoin(hub) {
  const alice = player(hub, 'Alice'), bob = player(hub, 'Bob');
  const code = await alice.net.host();
  await until(() => alice.last('welcome'), 'Alice entre dans sa propre partie');
  assert.equal(await bob.net.join(code), code);
  await until(() => bob.last('welcome') && alice.last('lobby')?.players.length === 2, 'Bob rejoint Alice');
  return { alice, bob, code, room: alice.net.session.room };
}

async function startGame(alice, bob, room) {
  alice.send({ t: 'ready', v: true });
  bob.send({ t: 'ready', v: true });
  await until(() => room.phase === 'countdown', 'compte à rebours');
  room.countdown = 0.05;
  await until(() => bob.last('start') && bob.last('s'), 'Bob reçoit la partie');
}

test('code de partie : aller-retour et saisie approximative', () => {
  const id = 109775242985459303n; // identifiant réel d'un salon Spacewar
  const code = lobbyCode(id);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{3}$/);
  assert.equal(parseCode(code), id);
  assert.equal(parseCode(' ' + code.toLowerCase().replace('-', ' ') + ' '), id);
  assert.equal(parseCode(code.replaceAll('0', 'O').replaceAll('1', 'l')), id);
  assert.equal(parseCode(String(id)), id);
  assert.equal(lobbyCode(0x01860000n << 32n), '0000-000');
  for (const bad of ['', '   ', 'bonjour !', 'UUUU', 'Z'.repeat(14)]) assert.equal(parseCode(bad), null, bad);
  const odd = 0x0170000012345678n; // hors du format habituel : code long, mais réversible
  assert.equal(parseCode(lobbyCode(odd)), odd);
});

test('fermeture différée, comme un WebSocket', async () => {
  const sock = new PlayerSocket('x', () => {});
  let closed = false;
  sock.on('close', () => { closed = true; });
  sock.close();
  assert.equal(closed, false);
  assert.equal(sock.readyState, 3);
  await new Promise(r => setImmediate(r));
  assert.equal(closed, true);
});

test('un invité rejoint, joue, et ses messages passent dans les deux sens', async () => {
  const hub = new FakeSteam();
  const { alice, bob, code, room } = await hostAndJoin(hub);
  try {
    assert.equal(hub.lobbies.get(parseCode(code)).data.game, 'minuit-au-manoir');
    const lobby = bob.last('lobby');
    assert.deepEqual(lobby.players.map(p => [p.name, p.host]), [['Alice', true], ['Bob', false]]);
    assert.deepEqual(bob.statuses, ['connecting', 'connected']);

    await startGame(alice, bob, room);
    const start = bob.last('start');
    assert.equal(start.players.length, 2);
    assert.ok(hub.sent.some(s => s.type === 'G' && s.to === bob.user.id && s.size > 1200 && s.mode === 2), 'gros message en fiable');
    assert.ok(hub.sent.some(s => s.type === 'G' && s.to === bob.user.id && s.mode === 0), 'état du jeu en non fiable');

    const me = room.game.players.find(p => p.name === 'Bob');
    bob.send({ t: 'in', x: me.x + 1, y: me.y, a: 0, l: 1, r: 0, m: 1, e: 0 }, true);
    await until(() => Math.abs(me.x - (start.players[1].x + 1)) < 0.01, "l'hôte applique le déplacement de Bob");
    assert.ok(hub.sent.some(s => s.type === 'G' && s.from === bob.user.id && s.mode === 0), 'commandes en non fiable');
  } finally {
    alice.net.dispose();
    bob.net.dispose();
  }
});

test("le départ d'un invité libère sa place, celui de l'hôte renvoie les invités au titre", async () => {
  const hub = new FakeSteam();
  const { alice, bob } = await hostAndJoin(hub);
  const carol = player(hub, 'Carol');
  try {
    await carol.net.join(lobbyCode(alice.net.session.lobby.id));
    await until(() => alice.last('lobby')?.players.length === 3, 'Carol arrive');
    bob.net.leave();
    await until(() => alice.last('lobby')?.players.length === 2, 'Bob est parti');
    assert.deepEqual(alice.last('lobby').players.map(p => p.name), ['Alice', 'Carol']);
    alice.net.leave();
    await until(() => carol.statuses.includes('closed:host-left'), 'Carol apprend le départ de l’hôte');
  } finally {
    for (const p of [alice, bob, carol]) p.net.dispose();
  }
});

test('coupure réseau en pleine partie : le joueur retrouve sa place', async () => {
  const hub = new FakeSteam();
  const { alice, bob, room } = await hostAndJoin(hub);
  try {
    await startGame(alice, bob, room);
    const id = bob.last('welcome').id;
    const before = bob.msgs.filter(m => m.t === 'start').length;
    hub.cut.add(bob.user.id);
    await until(() => bob.statuses.includes('lost'), 'Bob voit la coupure');
    await until(() => !room.players.find(p => p.id === id).connected, "l'hôte libère la connexion de Bob");
    hub.cut.delete(bob.user.id);
    await until(() => bob.msgs.filter(m => m.t === 'start').length > before, 'Bob revient dans la partie');
    assert.equal(bob.last('welcome').id, id);
    assert.ok(room.players.find(p => p.id === id).connected);
    assert.deepEqual(bob.statuses.slice(-2), ['ok', 'connected']);
  } finally {
    alice.net.dispose();
    bob.net.dispose();
  }
});

test("un hôte injoignable, un mauvais code ou une autre version sont signalés", async () => {
  const hub = new FakeSteam();
  const alice = player(hub, 'Alice'), bob = player(hub, 'Bob'), old = player(hub, 'Vieux', { version: '1.0.0' });
  try {
    await assert.rejects(bob.net.join('pas un code'), /ne ressemble pas/);
    await assert.rejects(bob.net.join('ZZZZ-ZZZ'), /Impossible de rejoindre/);
    const code = await alice.net.host();
    await assert.rejects(old.net.join(code), /version 2\.0\.0.*la 1\.0\.0/);
    assert.equal(hub.lobbies.get(parseCode(code)).members.length, 1, 'le joueur refusé est ressorti du salon');

    const other = hub.user('Autre jeu');
    const foreign = await other.client.matchmaking.createLobby(2, 8);
    foreign.mergeFullData({ game: 'spacewar' });
    await assert.rejects(bob.net.join(lobbyCode(foreign.id)), /aucune partie de Minuit/);

    hub.cut.add(alice.user.id);
    await bob.net.join(code);
    await until(() => bob.statuses.includes('closed:unreachable'), 'abandon faute de réponse');
  } finally {
    for (const p of [alice, bob, old]) p.net.dispose();
  }
});

test("les paquets d'un compte hors du salon sont ignorés", async () => {
  const hub = new FakeSteam();
  const { alice, bob } = await hostAndJoin(hub);
  const mallory = hub.user('Mallory');
  try {
    mallory.client.networking.sendP2PPacket(alice.user.id, 2, Buffer.from('G' + JSON.stringify({ t: 'hello', name: 'Intrus' })));
    mallory.client.networking.sendP2PPacket(alice.user.id, 2, Buffer.from('C'));
    await wait(150);
    assert.equal(alice.net.session.peers.size, 1);
    assert.deepEqual(alice.last('lobby').players.map(p => p.name), ['Alice', 'Bob']);
  } finally {
    alice.net.dispose();
    bob.net.dispose();
  }
});

test('invitation Steam acceptée : le code du salon est transmis à la page', () => {
  const hub = new FakeSteam();
  const bob = player(hub, 'Bob');
  let code = null;
  bob.net.on('join-request', c => { code = c; });
  const lobby = (0x01860000n << 32n) | 42n;
  bob.user.fire(SteamCallback.GameLobbyJoinRequested, { lobby_steam_id: lobby, friend_steam_id: 1n });
  assert.equal(code, lobbyCode(lobby));
  bob.net.dispose();
});

// La page reçoit la voix des autres : numéro du joueur qui parle, puis la trame telle qu'envoyée.
function listen(p) {
  p.voices = [];
  p.net.on('voice', (from, data) => p.voices.push([from, [...data]]));
}

test("la voix passe par l'hôte, en non fiable, vers tous les autres au salon", async () => {
  const hub = new FakeSteam();
  const { alice, bob, room } = await hostAndJoin(hub);
  const carol = player(hub, 'Carol');
  [alice, bob, carol].forEach(listen);
  try {
    await carol.net.join(lobbyCode(alice.net.session.lobby.id));
    await until(() => alice.last('lobby')?.players.length === 3 && carol.last('welcome'), 'Carol arrive');
    const id = name => room.players.find(p => p.name === name).id;
    bob.net.sendVoice(Buffer.from([1, 0, 9, 8, 7]));
    await until(() => alice.voices.length && carol.voices.length, 'Alice et Carol entendent Bob');
    assert.deepEqual(alice.voices[0], [id('Bob'), [1, 0, 9, 8, 7]]);
    assert.deepEqual(carol.voices[0], [id('Bob'), [1, 0, 9, 8, 7]]);
    alice.net.sendVoice(Buffer.from([2, 0, 6]));
    await until(() => bob.voices.length && carol.voices.length === 2, "Bob et Carol entendent l'hôte");
    assert.deepEqual(bob.voices[0], [id('Alice'), [2, 0, 6]]);
    await wait(30);
    assert.equal(bob.voices.length, 1, 'on ne s’entend pas soi-même');
    assert.equal(alice.voices.length, 1);
    const voice = hub.sent.filter(s => s.type === 'V');
    assert.equal(voice.length, 4);
    assert.ok(voice.every(s => s.mode === 0), 'voix en non fiable');

    // Garde-fou : un joueur qui inonde la salle n'est relayé que jusqu'à 50 trames par seconde
    for (let i = 0; i < 80; i++) bob.net.sendVoice(Buffer.from([i, 0, 1]));
    await until(() => carol.voices.length >= 51, 'les trames de Bob arrivent');
    await wait(50);
    assert.equal(carol.voices.length, 51);
  } finally {
    for (const p of [alice, bob, carol]) p.net.dispose();
  }
});

test("en partie, un mort n'est entendu que des morts", async () => {
  const hub = new FakeSteam();
  const { alice, bob, room } = await hostAndJoin(hub);
  [alice, bob].forEach(listen);
  try {
    await startGame(alice, bob, room);
    const [a, b] = ['Alice', 'Bob'].map(n => room.game.players.find(p => p.name === n));
    b.state = 'dead';
    bob.net.sendVoice(Buffer.from([1, 0, 5]));
    alice.net.sendVoice(Buffer.from([1, 0, 4]));
    await until(() => bob.voices.length, 'le fantôme de Bob entend Alice, juste à côté');
    await wait(50);
    assert.equal(alice.voices.length, 0, 'Alice, vivante, n’entend pas le fantôme');
    assert.deepEqual(bob.voices[0], [a.id, [1, 0, 4]]);
  } finally {
    alice.net.dispose();
    bob.net.dispose();
  }
});

test('qui entend qui : de près dans le manoir, partout entre morts et dehors', () => {
  const room = new Room();
  room.dispose();
  const map = generateMap(7, 3);
  const R = CFG.voice.range;
  const at = (x, y, state = 'alive', inGame = true) => ({ x, y, state, inGame });
  const p = at(2, 2);
  assert.equal(room.hears(at(2, 2 + R * 3), p), true, 'au salon, tout le monde s’entend');
  room.phase = 'playing';
  room.game = { map };
  assert.equal(room.hears(at(2, 2 + R - 1), p), true, 'à portée de voix');
  assert.equal(room.hears(at(2, 2 + R + 5), p), false, 'trop loin');
  assert.equal(room.hears(at(2 + map.stride, 2 + R - 10), p), true, 'juste au-dessus, à travers le plancher');
  assert.equal(room.hears(at(2 + map.stride, 2 + R - 4), p), false, 'loin, à un autre étage');
  assert.equal(room.hears(at(2, 2 + R - 1), at(2, 2, 'down')), true, 'à terre, on appelle encore à l’aide');
  assert.equal(room.hears(at(2, 2 + R - 1, 'dead'), p), true, 'un fantôme proche entend les vivants');
  assert.equal(room.hears(at(2, 2 + R + 5, 'dead'), p), false, '…mais pas de loin');
  assert.equal(room.hears(at(2, 2 + R * 3, 'escaped'), p), true, 'dehors, on entend par les oreilles de l’ami suivi');
  assert.equal(room.hears(at(0, 0, undefined, false), p), true, 'le spectateur aussi');
  const ghost = at(2, 2, 'dead');
  assert.equal(room.hears(at(2, 2.5), ghost), false, 'les vivants n’entendent pas les morts');
  assert.equal(room.hears(at(2, 2 + R * 3, 'dead'), ghost), true, 'les morts s’entendent partout');
  assert.equal(room.hears(at(0, 0, 'escaped'), ghost), true);
  assert.equal(room.hears(at(2, 2.5), at(2, 2, 'escaped')), false, 'ceux qui ont fui ne sont plus dans le manoir');
  assert.equal(room.hears(at(2, 2.5, 'dead'), at(0, 0, undefined, false)), true, 'spectateurs et fantômes se parlent');
});

test('la créature entend la voix : deux fois plus loin tous les 6 dB, rien pour un murmure', () => {
  const V = CFG.noise.voice;
  assert.equal(voiceNoise(V.db), V.r, 'voix normale');
  assert.ok(Math.abs(voiceNoise(V.db + 6) - 2 * V.r) < 1e-9);
  assert.ok(Math.abs(voiceNoise(V.db - 6) - V.r / 2) < 1e-9);
  assert.equal(voiceNoise(-45), 0, 'murmure');
  assert.equal(voiceNoise(0), V.max, 'un cri ne porte pas à l’infini');
  assert.ok(voiceNoise(-6) >= V.shout, 'un cri traverse les murs');
  assert.ok(voiceNoise(V.db) < CFG.noise.run, 'parler normalement s’entend moins que courir');
});

test('parler attire la créature, crier plus encore ; ni les murmures ni les fantômes', () => {
  const room = new Room();
  room.dispose();
  const map = generateMap(7, 2);
  const players = ['Alice', 'Bob'].map((name, i) => ({ id: i + 1, name, connected: true, inGame: true, ws: null }));
  const game = new Game(map, players, 'normal', () => {});
  Object.assign(room, { players, game, phase: 'playing' });
  const [a, b] = players;
  b.state = 'dead';
  a.light = false; // dans le noir, elle ne la voit pas à 4 cases : elle ne peut que l'entendre
  const m = game.monsters[0];
  // La créature réveillée, à 4 cases d'Alice, en vue (rien entre elles)
  let spot = null;
  for (let y = 1; y < map.h - 1 && !spot; y++) for (let x = 1; x < map.fw - 1; x++) {
    const d = Math.hypot(x + 0.5 - a.x, y + 0.5 - a.y);
    if (map.tiles[y * map.w + x] === TILE.FLOOR && d > 3.8 && d < 4.4 && lineOfSight(map, x + 0.5, y + 0.5, a.x, a.y)) { spot = [x + 0.5, y + 0.5]; break; }
  }
  assert.ok(spot, 'une case dégagée à 4 cases du hall');
  const reset = () => { Object.assign(m, { x: spot[0], y: spot[1], path: [], goal: null, bored: 0 }); m.setState('wander'); };
  game.time = CFG.monster.dormant + 1;
  const frame = db => Buffer.from([0, 0, db + 100, 1, 2, 3]); // numéro, niveau (dB + 100), Opus
  const tick = () => game.update(1 / 30);
  const voiceNoises = () => game.noises.filter(n => n.x === a.x && n.y === a.y);

  reset();
  room.onVoice(a, frame(-40));
  room.onVoice(b, frame(-5));
  tick();
  assert.equal(game.noises.length, 0, 'un murmure, et la voix d’un fantôme : rien');
  assert.equal(m.state, 'wander');

  reset();
  room.onVoice(a, frame(CFG.noise.voice.db));
  tick();
  assert.equal(voiceNoises().length, 1);
  assert.equal(voiceNoises()[0].loud, false);
  assert.equal(m.state, 'investigate', 'une voix normale s’entend à 4 cases');
  assert.ok(Math.hypot(m.goal.x - a.x, m.goal.y - a.y) < 1, 'elle va voir d’où vient la voix');

  // Entre deux syllabes, le bruit retombe ; une seconde de silence, et plus rien
  for (let i = 0; i < 30; i++) tick();
  assert.equal(voiceNoises().length, 0);
  assert.equal(a.voice, 0);

  room.onVoice(a, frame(-6));
  tick();
  assert.ok(voiceNoises()[0].r >= CFG.noise.voice.shout && voiceNoises()[0].loud, 'un cri porte loin, à travers les murs');

  // Hors partie, la voix ne fait aucun bruit dans le manoir
  room.phase = 'lobby';
  room.game = null;
  room.onVoice(a, frame(-6));
});
