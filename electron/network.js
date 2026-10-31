// Jeu en ligne par Steam, avec l'appli de test « Spacewar » (480) que tout compte Steam peut utiliser.
// L'hôte crée un salon Steam et fait tourner la partie (server/room.js) ; les invités entrent dans
// le salon grâce à son code, puis échangent avec l'hôte en P2P. Steam traverse les box et les
// pare-feu, ou relaie les paquets : aucun port à ouvrir.
import { EventEmitter } from 'node:events';

export const SPACEWAR = 480;
export const GAME_KEY = 'minuit-au-manoir';
export const MAX_PLAYERS = 8;

const LOBBY_PUBLIC = 2; // matchmaking.LobbyType.Public : toute personne qui a le code peut entrer
const SEND_UNRELIABLE = 0, SEND_RELIABLE = 2; // networking.SendType
const MAX_UNRELIABLE = 1200; // au-delà, Steam refuse l'envoi non fiable

// Premier octet de chaque paquet
const PKT = {
  CONNECT: 0x43, // « C » invité → hôte : je veux entrer
  WELCOME: 0x57, // « W » hôte → invité : session ouverte, suivi de son numéro
  GAME: 0x47, // « G » message du jeu, en JSON
  BEAT: 0x4b, // « K » toujours là
  BYE: 0x42, // « B » je m'en vais
};

// Durées en millisecondes
export const TIMING = {
  poll: 4, // relève des paquets reçus
  beat: 1000, // signe de vie
  connect: 20000, // l'hôte ne répond pas : abandon
  lost: 5000, // l'invité n'entend plus l'hôte : « connexion perdue… »
  giveUp: 60000, // …et abandonne au bout d'une minute
  peer: 15000, // l'hôte libère la place d'un invité muet (il pourra revenir)
};

// Les identifiants de salon Steam ne varient que sur leurs 32 bits bas : seuls ceux-là forment le
// code, en base 32 sans lettres ambiguës (ni I, L, O ou U), par exemple « 3G7K-M2Q ».
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOBBY_HIGH = 0x01860000n; // univers public, compte de type « chat », salon de matchmaking

export function lobbyCode(id) {
  let n = id >> 32n === LOBBY_HIGH ? id & 0xffffffffn : id;
  let s = '';
  do { s = ALPHABET[Number(n % 32n)] + s; n /= 32n; } while (n > 0n);
  if (s.length > 7) return s;
  s = s.padStart(7, '0');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function parseCode(text) {
  const s = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (/^\d{16,20}$/.test(s)) return BigInt(s); // identifiant de salon complet, collé tel quel
  if (!/^[0-9A-HJKMNP-TV-Z]{1,13}$/.test(s)) return null;
  let n = 0n;
  for (const ch of s) n = n * 32n + BigInt(ALPHABET.indexOf(ch));
  if (n >= 1n << 64n) return null;
  return n <= 0xffffffffn ? (LOBBY_HIGH << 32n) | n : n;
}

// steamworks.js transmet le nom de la variante (« Entered », « Left »…), même si ses types annoncent un nombre.
const entered = change => change === 'Entered' || change === 0;

// Ce que la salle voit d'un joueur : l'essentiel d'un WebSocket. `identity` sert de jeton de
// reconnexion (le SteamID, garanti par Steam) ; `transmit` achemine les messages jusqu'à lui.
export class PlayerSocket extends EventEmitter {
  constructor(identity, transmit, host = false) {
    super();
    this.identity = identity;
    this.transmit = transmit;
    this.host = host;
    this.readyState = 1;
  }

  send(data, droppable = false) {
    if (this.readyState === 1) this.transmit(data, droppable);
  }

  receive(data) {
    if (this.readyState === 1) this.emit('message', data);
  }

  // Comme pour un WebSocket, « close » arrive après coup : la salle peut remplacer la connexion
  // d'un joueur qui revient sans le croire parti entre-temps.
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    setImmediate(() => this.emit('close'));
  }
}

// Émet 'message' (JSON destiné à la page), 'status' ({ state, reason }) et 'join-request' (code).
export class Network extends EventEmitter {
  constructor({ steam, SteamCallback, version, createRoom, timing = {} }) {
    super();
    this.steam = steam;
    this.version = version;
    this.createRoom = createRoom;
    this.timing = { ...TIMING, ...timing };
    this.me = steam.localplayer.getSteamId().steamId64;
    this.session = null;
    this.attempt = 0; // périme une création ou une connexion en cours si le joueur change d'avis
    const on = (name, fn) => steam.callback.register(SteamCallback[name], v => {
      try { fn(v); } catch (err) { console.error(err); }
    });
    on('LobbyChatUpdate', v => {
      if (this.session?.lobby.id === BigInt(v.lobby)) this.session.onMember(BigInt(v.user_changed), entered(v.member_state_change));
    });
    on('P2PSessionRequest', v => this.session?.onSessionRequest(BigInt(v.remote)));
    on('GameLobbyJoinRequested', v => this.emit('join-request', lobbyCode(BigInt(v.lobby_steam_id))));
    this.timers = [
      setInterval(() => this.poll(), this.timing.poll),
      setInterval(() => this.session?.beat(Date.now()), this.timing.beat),
    ];
  }

  get hosting() { return this.session instanceof HostSession; }
  get guests() { return this.hosting ? this.session.peers.size : 0; }

  // Renvoie le code à partager, ou null si le joueur a annulé entre-temps.
  async host() {
    const attempt = this.restart();
    const lobby = await this.steam.matchmaking.createLobby(LOBBY_PUBLIC, MAX_PLAYERS);
    if (attempt !== this.attempt) { lobby.leave(); return null; }
    lobby.mergeFullData({ game: GAME_KEY, version: this.version });
    this.session = new HostSession(this, lobby);
    this.emit('status', { state: 'connected' });
    return lobbyCode(lobby.id);
  }

  async join(text) {
    const id = parseCode(text);
    if (id === null) throw new Error('Ce code ne ressemble pas à un code de partie.');
    const attempt = this.restart();
    let lobby;
    try {
      lobby = await this.steam.matchmaking.joinLobby(id);
    } catch {
      throw new Error('Impossible de rejoindre cette partie. Vérifiez le code : elle est peut-être pleine ou terminée.');
    }
    const problem = attempt === this.attempt ? await this.check(lobby) : '';
    if (attempt !== this.attempt) { lobby.leave(); return null; }
    if (problem) { lobby.leave(); throw new Error(problem); }
    this.session = new GuestSession(this, lobby, lobby.getOwner().steamId64);
    this.emit('status', { state: 'connecting' });
    return lobbyCode(lobby.id);
  }

  // Spacewar est partagé par tous les développeurs : on vérifie que le salon est bien une partie
  // de ce jeu, dans la même version. Ses données arrivent avec l'entrée, on leur laisse un instant.
  async check(lobby) {
    for (let i = 0; i < 10 && !lobby.getData('game'); i++) await new Promise(r => setTimeout(r, 150));
    if (lobby.getData('game') !== GAME_KEY) return 'Ce code ne correspond à aucune partie de Minuit au Manoir.';
    const version = lobby.getData('version') || '?';
    if (version !== this.version) return `L’hôte a la version ${version} du jeu et vous la ${this.version} : utilisez le même fichier que lui.`;
    if (lobby.getOwner().steamId64 === this.me) return 'C’est votre propre partie !';
    return '';
  }

  restart() {
    this.leave();
    return this.attempt;
  }

  leave() {
    this.attempt++;
    const s = this.session;
    this.session = null;
    s?.close();
  }

  end(reason) {
    this.leave();
    this.emit('status', { state: 'closed', reason });
  }

  send(data, unreliable = false) { this.session?.send(data, unreliable); }

  invite() {
    if (this.session) this.steam.overlay.activateInviteDialog(this.session.lobby.id);
  }

  // Joueur supplémentaire sur ce PC (fenêtre de test), branché directement sur la partie hébergée.
  addLocalPlayer(identity, deliver) {
    return this.hosting ? this.session.addLocal(new PlayerSocket(identity, deliver)) : null;
  }

  packet(to, type, text = '', unreliable = false) {
    const buf = Buffer.alloc(1 + Buffer.byteLength(text));
    buf[0] = type;
    buf.write(text, 1);
    const mode = unreliable && buf.length <= MAX_UNRELIABLE ? SEND_UNRELIABLE : SEND_RELIABLE;
    return this.steam.networking.sendP2PPacket(to, mode, buf);
  }

  poll() {
    const net = this.steam.networking;
    for (let i = 0; i < 500; i++) {
      const size = net.isP2PPacketAvailable();
      if (!size) return;
      let p;
      try { p = net.readP2PPacket(size); } catch { return; }
      if (p.size > 0) this.session?.onPacket(p.steamId.steamId64, p.data.subarray(0, p.size));
    }
  }

  dispose() {
    this.leave();
    this.timers.forEach(clearInterval);
  }
}

// L'hôte : la partie tourne ici. Chaque invité devient une PlayerSocket dès son premier paquet.
class HostSession {
  constructor(net, lobby) {
    this.net = net;
    this.lobby = lobby;
    this.room = net.createRoom();
    this.peers = new Map(); // SteamID → PlayerSocket
    this.pending = new Set(); // demandes de session arrivées avant l'entrée du joueur dans le salon
    this.locals = new Set();
    this.tag = Math.random().toString(36).slice(2, 8);
    this.count = 0;
    this.local = this.addLocal(new PlayerSocket(String(net.me), data => net.emit('message', data), true));
  }

  addLocal(sock) {
    this.locals.add(sock);
    this.room.connect(sock);
    return sock;
  }

  isMember(id) {
    return this.lobby.getMembers().some(m => m.steamId64 === id);
  }

  onSessionRequest(id) {
    if (this.isMember(id)) this.net.steam.networking.acceptP2PSession(id);
    else this.pending.add(id);
  }

  onMember(id, isIn) {
    if (!isIn) {
      this.pending.delete(id);
      this.drop(id);
    } else if (this.pending.delete(id)) {
      this.net.steam.networking.acceptP2PSession(id);
    }
  }

  onPacket(from, buf) {
    const type = buf[0];
    let peer = this.peers.get(from);
    if (!peer) {
      if (type === PKT.BYE || from === this.net.me || !this.isMember(from)) return;
      peer = this.addPeer(from);
    } else if (type === PKT.CONNECT) {
      this.net.packet(from, PKT.WELCOME, peer.session);
    }
    peer.heard = Date.now();
    if (type === PKT.GAME) peer.receive(buf.toString('utf8', 1));
    else if (type === PKT.BYE) this.drop(from);
  }

  // Toute nouvelle session est annoncée à l'invité : il se présente alors (à nouveau) à la salle.
  addPeer(id) {
    const peer = new PlayerSocket(String(id), (data, droppable) => this.net.packet(id, PKT.GAME, data, droppable));
    peer.session = `${this.tag}${++this.count}`;
    peer.heard = Date.now();
    this.peers.set(id, peer);
    this.room.connect(peer);
    this.net.packet(id, PKT.WELCOME, peer.session);
    return peer;
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.close();
  }

  beat(now) {
    for (const [id, peer] of this.peers) {
      if (now - peer.heard > this.net.timing.peer) this.drop(id);
      else this.net.packet(id, PKT.BEAT, '', true);
    }
  }

  send(data) { this.local.receive(data); }

  close() {
    for (const id of this.peers.keys()) this.net.packet(id, PKT.BYE);
    for (const sock of [...this.peers.values(), ...this.locals]) sock.close();
    this.peers.clear();
    this.room.dispose();
    this.lobby.leave();
  }
}

// L'invité : il frappe chez l'hôte jusqu'à ce qu'il ouvre, puis relaie les messages du jeu.
class GuestSession {
  constructor(net, lobby, host) {
    this.net = net;
    this.lobby = lobby;
    this.host = host;
    this.session = null; // numéro de session donné par l'hôte
    this.since = Date.now();
    this.heard = 0;
    this.lost = false;
    net.packet(host, PKT.CONNECT);
  }

  onSessionRequest(id) {
    if (id === this.host) this.net.steam.networking.acceptP2PSession(id);
  }

  onMember(id, isIn) {
    if (id === this.host && !isIn) this.net.end('host-left');
  }

  onPacket(from, buf) {
    if (from !== this.host) return;
    this.heard = Date.now();
    if (this.lost) {
      this.lost = false;
      this.net.emit('status', { state: 'ok' });
    }
    const type = buf[0];
    if (type === PKT.WELCOME) {
      const session = buf.toString('utf8', 1);
      if (session !== this.session) {
        this.session = session;
        this.net.emit('status', { state: 'connected' });
      }
    } else if (type === PKT.GAME) {
      if (this.session) this.net.emit('message', buf.toString('utf8', 1));
    } else if (type === PKT.BYE) {
      this.net.end('host-left');
    }
  }

  beat(now) {
    const T = this.net.timing;
    if (!this.session) {
      if (now - this.since > T.connect) this.net.end('unreachable');
      else this.net.packet(this.host, PKT.CONNECT);
      return;
    }
    const silence = now - this.heard;
    if (silence > T.giveUp) return this.net.end('timeout');
    if (silence > T.lost && !this.lost) {
      this.lost = true;
      this.net.emit('status', { state: 'lost' });
    }
    this.net.packet(this.host, PKT.BEAT, '', true);
  }

  send(data, unreliable) {
    if (this.session) this.net.packet(this.host, PKT.GAME, data, unreliable);
  }

  close() {
    this.net.packet(this.host, PKT.BYE);
    this.lobby.leave();
  }
}
