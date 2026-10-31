// Le salon : connexions, reconnexions (coupure réseau, jeu relancé…), lancement et fin des parties.
// Tourne chez l'hôte ; chaque joueur est une « socket » fournie par electron/network.js.
import { CFG, COLORS, DIFFICULTY } from '../shared/config.js';
import { generateMap } from '../shared/map.js';
import { Game } from './game.js';

function clientMap(map) {
  const { spots, tiles, roomIdx, ...rest } = map;
  return { ...rest, tiles: Array.from(tiles).join(''), roomIdx: Array.from(roomIdx) };
}

export class Room {
  constructor() {
    this.players = [];
    this.phase = 'lobby'; // lobby → countdown → playing → lobby
    this.countdown = 0;
    this.difficulty = 'normal';
    this.game = null;
    this.mapPayload = null;
    this.nextId = 1;
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / CFG.tickRate);
  }

  dispose() {
    clearInterval(this.timer);
  }

  connect(ws) {
    let player = null;
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') { player = this.hello(ws, msg); return; }
      if (player && player.ws === ws) this.onMessage(player, msg);
    });
    ws.on('close', () => { if (player && player.ws === ws) this.disconnect(player); });
    ws.on('error', () => {});
  }

  pickColor(wanted, self) {
    const taken = new Set(this.players.filter(p => p !== self && p.connected).map(p => p.color));
    if (COLORS.includes(wanted) && !taken.has(wanted)) return wanted;
    return COLORS.find(c => !taken.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  // `ws.identity` (le SteamID du joueur) reconnaît celui qui revient après une coupure.
  hello(ws, msg) {
    const name = String(msg.name || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Anonyme';
    const token = ws.identity;
    let p = this.players.find(q => q.token === token);
    if (p) {
      if (p.ws && p.ws !== ws) try { p.ws.close(); } catch {}
      p.ws = ws;
      p.connected = true;
      if (this.phase !== 'playing') { p.name = name; p.color = this.pickColor(msg.color, p); }
    } else {
      p = { id: this.nextId++, token, host: ws.host, name, color: null, ws, connected: true, ready: false, inGame: false };
      p.color = this.pickColor(msg.color, p);
      this.players.push(p);
    }
    this.send(p, { t: 'welcome', id: p.id, color: p.color });
    if (this.phase === 'playing') {
      // Reconnexion en cours de partie, ou arrivée en spectateur jusqu'à la prochaine manche
      this.send(p, this.startPayload());
      if (p.inGame) this.game.emit('back', { id: p.id });
    }
    this.broadcastLobby();
    return p;
  }

  disconnect(p) {
    p.connected = false;
    p.ws = null;
    if (this.phase === 'playing' && p.inGame) {
      p.discAt = this.game.time;
      this.game.emit('disc', { id: p.id });
    } else if (this.phase !== 'playing') {
      this.players = this.players.filter(q => q !== p);
    }
    if (this.phase === 'playing' && !this.players.some(q => q.connected)) this.endGame();
    else { this.checkStart(); this.broadcastLobby(); }
  }

  onMessage(p, m) {
    switch (m.t) {
      case 'ready':
        if (this.phase === 'lobby' || this.phase === 'countdown') { p.ready = !!m.v; this.checkStart(); this.broadcastLobby(); }
        break;
      case 'diff':
        if (DIFFICULTY[m.v] && this.phase !== 'playing') { this.difficulty = m.v; this.broadcastLobby(); }
        break;
      case 'in':
        if (this.phase === 'playing' && p.inGame) this.game.input(p, m);
        break;
      case 'ping':
        if (this.phase === 'playing' && p.inGame) this.game.ping(p, m);
        break;
    }
  }

  checkStart() {
    const present = this.players.filter(q => q.connected);
    const allReady = present.length > 0 && present.every(q => q.ready);
    if (this.phase === 'lobby' && allReady) {
      this.phase = 'countdown';
      this.countdown = 3.2;
      this.broadcast({ t: 'countdown', s: 3 });
    } else if (this.phase === 'countdown' && !allReady) {
      this.phase = 'lobby';
      this.broadcast({ t: 'countdown', s: -1 });
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) this.broadcast({ t: 'countdown', s: after });
      if (this.countdown <= 0) this.startGame();
    } else if (this.phase === 'playing') {
      this.game.update(dt);
      this.broadcast(this.game.snapshot(), true);
      if (this.game.over) this.endGame();
    }
  }

  startGame() {
    const players = this.players.filter(q => q.connected);
    if (!players.length) { this.phase = 'lobby'; return; }
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const map = generateMap(seed, players.length);
    for (const p of this.players) { p.inGame = players.includes(p); p.ready = false; }
    this.game = new Game(map, players, this.difficulty, (k, data) => this.broadcast({ t: 'ev', k, ...data }));
    this.mapPayload = clientMap(map);
    this.phase = 'playing';
    this.broadcast(this.startPayload());
    this.broadcastLobby();
    console.log(`  Partie lancée : ${players.length} joueur(s), difficulté ${this.difficulty}`);
  }

  startPayload() {
    const g = this.game;
    return {
      t: 'start',
      map: this.mapPayload,
      difficulty: g.difficulty,
      time: g.time,
      players: g.players.map(p => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, a: p.a })),
      items: g.items,
      monsters: g.monsters.map(m => ({ x: m.x, y: m.y, a: m.a })),
      skullsFound: g.skullsFound,
      skullsTotal: g.skullsTotal,
      exitOpen: g.exitOpen,
    };
  }

  endGame() {
    const g = this.game;
    if (g) {
      const results = g.results();
      this.broadcast({
        t: 'end',
        win: results.some(r => r.outcome === 'escaped'),
        results,
        time: Math.round(g.time),
        skulls: g.skullsFound,
        skullsTotal: g.skullsTotal,
      });
      console.log(`  Fin de partie : ${results.filter(r => r.outcome === 'escaped').length}/${results.length} survivant(s)`);
    }
    this.phase = 'lobby';
    this.game = null;
    this.mapPayload = null;
    this.players = this.players.filter(p => p.connected);
    for (const p of this.players) { p.ready = false; p.inGame = false; }
    this.broadcastLobby();
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby',
      phase: this.phase,
      difficulty: this.difficulty,
      players: this.players.filter(p => p.connected).map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready, host: p.host })),
    });
  }

  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  // `droppable` : un message d'état peut se perdre en route, le suivant le remplace (envoi non fiable).
  broadcast(msg, droppable = false) {
    const data = JSON.stringify(msg);
    for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(data, droppable);
  }
}
