// Réseau Steam simulé : quelques comptes qui s'échangent des paquets, pour tester electron/network.js
// et la salle de jeu sans Steam ni second ordinateur. Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Network, PlayerSocket, lobbyCode, parseCode } from '../electron/network.js';
import { Room } from '../server/room.js';

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
