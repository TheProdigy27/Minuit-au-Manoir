// Côté page : écrans, réseau (relayé par l'application, via Steam), déplacement du joueur local et boucle de rendu.
import { CFG, COLORS, DIFFICULTY, PLAYER_STATES } from '/shared/config.js';
import { moveBox, angDiff, crossStairs, floorAt, levelDist } from '/shared/physics.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';

const $ = sel => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const testWindow = params.has('test');
const mam = window.mam; // pont vers l'application (electron/preload.cjs)
const canvas = $('#game');
const renderer = new Renderer(canvas, $('#hud'));
const input = new Input(canvas);
const sound = new Sound();

const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const G = {
  screen: 'title', myId: null, lobby: null, code: '', hosting: false,
  map: null, players: new Map(), order: [], monsters: [], items: new Map(),
  skullsFound: 0, skullsTotal: 0, exitOpen: false, time: 0, snapT: -1,
  me: null,
  // a : direction du regard (cap), p : regard vers le haut ou le bas, bob : distance parcourue (balancement de la vue)
  local: { x: 0, y: 0, a: 0, p: 0, stamina: CFG.player.stamina, exhausted: false, light: true, moving: false, running: false, act: false, step: 0, bob: 0 },
  // view : les yeux par lesquels on voit (les siens, ceux d'un ami suivi après la fuite, ou la porte)
  view: { x: 0, y: 0, a: 0, p: 0, state: 'alive', bob: 0, moving: false, running: false, who: null },
  focusRoom: '', spectating: null, reviveTarget: null, needClick: false, showPlan: false, minimap: true,
  messages: [], pings: [], extinguished: new Map(),
  fear: 0, flash: 0, shake: 0, jumpscare: 0,
};

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

function show(id) {
  G.screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('menu', id !== 'game');
  input.active = id === 'game';
  if (id === 'game') document.activeElement?.blur();
  else input.unlock();
}
show('loading');
// La musique des menus démarre dès le choix du pseudo (l'application autorise le son sans clic).
sound.init();
sound.music(true);

// Écran de chargement : les photos des matières et un manoir d'essai dont tous les shaders sont compilés
// (voir Renderer.warmUp) ; les parties démarrent ensuite sans attendre la carte graphique.
// Part de la barre de chaque étape : à peu près sa durée sur une petite carte graphique, entre premier
// lancement et suivants (le reste : l'image d'essai). Le texte montre la première étape pas encore finie.
const LOAD = [
  ['manor', 0.35, 'Construction du manoir…'],
  ['shaders', 0.3, 'Compilation des shaders…'],
  ['textures', 0.1, 'Chargement des textures…'],
  ['image', 0.15, 'Dernières préparations…'],
];
const warm = renderer.warmUp(done => {
  const v = LOAD.reduce((sum, [step, part]) => sum + part * done[step], 0);
  const [, , text] = LOAD.find(([step]) => done[step] < 1) ?? LOAD.at(-1);
  $('#loadText').textContent = `${text} ${Math.round(v * 100)} %`;
  $('#loadBar').value = v;
}).catch(err => console.error(err));
warm.then(() => {
  if (G.screen === 'loading') show(G.myId ? 'lobby' : 'title'); // fenêtre de test : déjà reliée au salon
  if (invite) acceptInvite(invite);
});

let chosenColor = store.get('mam-color');
if (!COLORS.includes(chosenColor)) chosenColor = COLORS[Math.floor(Math.random() * COLORS.length)];
function buildColors() {
  const box = $('#colors');
  box.replaceChildren();
  for (const col of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (col === chosenColor ? ' on' : '');
    b.style.background = col;
    b.setAttribute('aria-label', 'Couleur ' + col);
    b.onclick = () => { chosenColor = col; store.set('mam-color', col); buildColors(); };
    box.appendChild(b);
  }
}
buildColors();

let steamOk = false;
let busy = false; // création ou connexion en cours
let hello = null; // présentation renvoyée à la partie à chaque (re)connexion
let linked = false; // l'application nous a reliés à une partie

function setStatus(text, kind = '') {
  $('#status').textContent = text;
  $('#status').className = 'status' + (kind ? ' ' + kind : '');
}

function setBusy(on, cancellable = false) {
  busy = on;
  $('#name').disabled = on;
  for (const el of document.querySelectorAll('#hostBtn, #code, #joinForm button')) el.disabled = on || !steamOk;
  $('#cancelBtn').hidden = !cancellable;
}

async function checkSteam(retry = false) {
  const info = await (retry ? mam.retrySteam() : mam.info());
  steamOk = info.ok;
  $('#steamError').hidden = info.ok || testWindow;
  $('#steamDetail').textContent = info.error;
  $('#appVersion').textContent = info.version;
  // Le pseudo Steam par défaut, sauf si le joueur a déjà tapé le sien (fenêtre de test : « Test n »)
  if (info.ok && !$('#name').value) $('#name').value = info.name.slice(0, 16);
  setBusy(busy, !$('#cancelBtn').hidden);
}
setBusy(false);
checkSteam();
$('#retryBtn').onclick = () => checkSteam(true);

function prepareHello() {
  const name = $('#name').value.replace(/\s+/g, ' ').trim().slice(0, 16) || 'Anonyme';
  $('#name').value = name;
  hello = { t: 'hello', name, color: chosenColor };
  sound.init();
  sound.music(true);
}

function failed(error) {
  hello = null;
  setBusy(false);
  setStatus(error || '', 'error');
}

$('#hostBtn').onclick = async () => {
  if (busy) return;
  prepareHello();
  setBusy(true);
  setStatus('Création de la partie sur Steam…');
  const r = await mam.host();
  if (!r.code) return failed(r.error);
  G.code = r.code;
  G.hosting = true;
  renderInvite();
};

$('#joinForm').onsubmit = async e => {
  e.preventDefault();
  if (busy) return;
  if (!$('#code').value.trim()) { setStatus('Saisissez le code donné par l’hôte.', 'error'); $('#code').focus(); return; }
  prepareHello();
  setBusy(true, true);
  setStatus('Entrée dans le salon Steam…');
  const r = await mam.join($('#code').value);
  if (!r.code) return failed(r.error);
  G.code = r.code;
  G.hosting = false;
  renderInvite();
  if (!linked) setStatus('Connexion à l’hôte…');
};

$('#cancelBtn').onclick = () => { mam.leave(); backToTitle(); };

const CLOSED = {
  'host-left': 'L’hôte a fermé la partie.',
  timeout: 'La connexion avec l’hôte a été perdue.',
  unreachable: 'Impossible de joindre l’hôte. Réessayez dans un instant.',
};

function backToTitle(message = '', kind = '') {
  linked = false;
  hello = null;
  Object.assign(G, { myId: null, lobby: null, map: null, me: null, code: '', hosting: false });
  $('#offline').classList.remove('show');
  $('#countdown').textContent = '';
  closeMenu();
  sound.stopGame();
  sound.music(true);
  keepAwake(false);
  show('title');
  setBusy(false);
  setStatus(message, kind);
}

function renderLobby() {
  const L = G.lobby;
  if (!L) return;
  const ul = $('#playerList');
  ul.replaceChildren();
  for (const p of L.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    dot.style.color = p.color;
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name + (p.id === G.myId ? ' (toi)' : '');
    li.append(dot, name);
    if (p.host) {
      const tag = document.createElement('span');
      tag.className = 'phost';
      tag.textContent = 'hôte';
      li.append(tag);
    }
    const st = document.createElement('span');
    st.className = 'pstate' + (p.ready ? ' ok' : '');
    st.textContent = p.ready ? 'prêt·e' : 'en attente';
    li.append(st);
    ul.appendChild(li);
  }
  const me = L.players.find(p => p.id === G.myId);
  $('#readyBtn').textContent = me?.ready ? 'Attendez-moi !' : 'Je suis prêt·e';
  $('#readyBtn').classList.toggle('on', !!me?.ready);
  const box = $('#diffBtns');
  box.replaceChildren();
  for (const [k, d] of Object.entries(DIFFICULTY)) {
    const b = document.createElement('button');
    b.className = 'chip' + (L.difficulty === k ? ' on' : '');
    b.textContent = d.label;
    b.onclick = () => send({ t: 'diff', v: k });
    box.appendChild(b);
  }
  $('#lobbyNote').textContent = G.map ? '' // le manoir se prépare : on entre dans cette partie-là
    : L.phase === 'playing' ? 'Une partie est en cours… vous rejoindrez la suivante.'
    : 'La partie démarre quand tout le monde est prêt.';
  // Les fenêtres de test sont toujours prêtes : l'hôte décide du départ.
  if (testWindow && me && !me.ready && L.phase === 'lobby') send({ t: 'ready', v: true });
}

$('#readyBtn').onclick = () => {
  const me = G.lobby?.players.find(p => p.id === G.myId);
  send({ t: 'ready', v: !me?.ready });
  sound.click();
};
$('#backBtn').onclick = () => { show('lobby'); renderLobby(); };

function renderInvite() {
  $('#codeBox').textContent = G.code || '…';
}

let copyTimer = 0;
$('#copyBtn').onclick = () => {
  mam.copy(G.code);
  $('#copyBtn').textContent = 'Code copié !';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $('#copyBtn').textContent = 'Copier le code'; }, 1800);
  sound.click();
};
$('#inviteBtn').onclick = () => { mam.invite(); sound.click(); };
$('#leaveBtn').onclick = () => openMenu();

// Menu (Échap) : la partie continue pendant ce temps, le personnage reste immobile.
// En partie, il s'ouvre aussi dès que la souris est libérée (Échap, Alt+Tab…).
// Sur l'écran titre, il n'affiche que les options.
const menu = $('#menu');
let menuOpenedAt = -1e9;
let optionsOnly = false;
function openMenu() {
  if (!menu.hidden) return;
  const others = (G.lobby?.players.length ?? 1) - 1;
  const inGame = G.screen === 'game';
  $('#menuNote').textContent = (inGame ? 'La partie continue pendant ce temps : votre personnage reste immobile. ' : '')
    + (!G.hosting ? 'Vous pourrez revenir avec le même code tant que la partie continue.'
      : others > 0 ? 'Vous hébergez la partie : la quitter l’arrêtera pour tout le monde.'
      : 'Vous hébergez la partie : la quitter la fermera.');
  $('#stayBtn').textContent = inGame ? 'Reprendre' : 'Rester';
  $('#quitBtn').textContent = inGame ? 'Quitter la partie' : 'Quitter le salon';
  optionsOnly = G.screen === 'title' || G.screen === 'loading';
  showUpdate();
  menu.hidden = false;
  menuOpenedAt = performance.now();
  input.keys.clear();
  input.unlock();
  showOptions(optionsOnly);
}
function showOptions(on) {
  $('#menuMain').hidden = on;
  $('#options').hidden = !on;
  $('#optionsDone').textContent = optionsOnly ? 'Fermer' : 'Retour';
  (on ? $('#optionsDone') : $('#stayBtn')).focus();
}
function closeMenu() {
  menu.hidden = true;
  if (G.screen === 'game' && input.wantLock) input.lock();
}
$('#titleOptionsBtn').onclick = openMenu;
$('#optionsBtn').onclick = () => showOptions(true);
$('#optionsDone').onclick = () => (optionsOnly ? closeMenu() : showOptions(false));
$('#stayBtn').onclick = closeMenu;
$('#quitBtn').onclick = () => {
  if (testWindow) return window.close();
  mam.leave();
  backToTitle();
};
// Fermer l'application : chez l'hôte d'une partie, elle demande d'abord confirmation
$('#titleExitBtn').onclick = $('#exitBtn').onclick = () => (testWindow ? window.close() : mam.quit());
input.onUnlock = () => { if (G.screen === 'game' && input.wantLock) openMenu(); };

// Options : sensibilité de la souris et volumes, gardés d'une session à l'autre
let sensitivity = clamp(parseFloat(store.get('mam-sens', '1')) || 1, 0.3, 3);
$('#sens').value = sensitivity;
$('#sens').oninput = () => { sensitivity = parseFloat($('#sens').value); store.set('mam-sens', sensitivity); };
for (const el of document.querySelectorAll('[data-vol]')) {
  const kind = el.dataset.vol, key = 'mam-vol-' + kind;
  const v = parseFloat(store.get(key, '100'));
  el.value = Number.isFinite(v) ? clamp(v, 0, 100) : 100;
  sound.setVolume(kind, el.value / 100);
  el.oninput = () => { sound.setVolume(kind, el.value / 100); store.set(key, el.value); };
  // Un petit son pour entendre le nouveau volume des effets, même sur l'écran titre
  if (kind === 'sfx') el.onchange = () => sound.click();
}
// Mini-carte en bas à droite de l'écran, qu'on peut masquer
const minimapBtns = document.querySelectorAll('[data-minimap]');
const showMinimap = on => { G.minimap = on; for (const b of minimapBtns) b.classList.toggle('on', b.dataset.minimap === (on ? '1' : '0')); };
for (const b of minimapBtns) b.onclick = () => { showMinimap(b.dataset.minimap === '1'); store.set('mam-minimap', b.dataset.minimap); sound.click(); };
showMinimap(store.get('mam-minimap', '1') === '1');
// Affichage : c'est l'application qui le garde, pour ouvrir la fenêtre directement dans le bon mode (F11 le change aussi)
const displayBtns = document.querySelectorAll('[data-display]');
const showDisplay = mode => { for (const b of displayBtns) b.classList.toggle('on', b.dataset.display === mode); };
for (const b of displayBtns) b.onclick = () => { mam.setDisplay(b.dataset.display); showDisplay(b.dataset.display); sound.click(); };
$('#displaySetting').hidden = testWindow;
mam.display().then(showDisplay);
mam.on('display', showDisplay);

// Mise à jour : l'application télécharge la nouvelle version en arrière-plan, le bouton la lance.
// L'écran titre l'annonce ; les options montrent aussi la version du jeu et cherchent à la demande.
const UPDATE = {
  downloading: s => `Nouvelle version ${s.version} : téléchargement… ${Math.round(s.progress * 100)} %`,
  ready: s => `La version ${s.version} est prête. Tout le monde doit avoir la même pour jouer ensemble.`,
  failed: s => `La version ${s.version} n’a pas pu être téléchargée.`,
  manual: s => `La version ${s.version} est sortie : téléchargez-la sur GitHub.`,
};
const UPDATE_OPTION = {
  checking: () => 'Recherche d’une mise à jour…',
  latest: () => 'Le jeu est à jour.',
  unreachable: () => 'Impossible de joindre GitHub : vérifiez la connexion à internet.',
  ready: s => `La version ${s.version} est prête. Revenez à l’écran titre pour redémarrer.`, // en salon ou en partie
};
const UPDATE_BTN = { ready: 'Redémarrer et mettre à jour', failed: 'Réessayer', manual: 'Ouvrir la page de téléchargement' };
let update = { state: 'none' };
function showUpdate(s = update) {
  update = s;
  $('#update').hidden = !UPDATE[s.state];
  if (UPDATE[s.state]) {
    $('#updateText').textContent = UPDATE[s.state](s);
    $('#updateBar').hidden = s.state !== 'downloading';
    $('#updateBar').value = s.progress || 0;
    $('#updateBtn').hidden = !UPDATE_BTN[s.state];
    $('#updateBtn').textContent = UPDATE_BTN[s.state] || '';
  }
  // Options : redémarrer depuis le salon ou une partie ferait quitter les autres joueurs
  const away = s.state === 'ready' && G.screen !== 'title';
  $('#updateInfo').textContent = ((!away && UPDATE[s.state]) || UPDATE_OPTION[s.state])?.(s) ?? '';
  $('#updateCheck').hidden = away || s.state === 'downloading';
  $('#updateCheck').disabled = s.state === 'checking';
  $('#updateCheck').textContent = UPDATE_BTN[s.state] || 'Rechercher une mise à jour';
}
mam.update().then(showUpdate);
mam.on('update', showUpdate);
$('#updateBtn').onclick = () => { mam.updateGo(); sound.click(); };
$('#updateCheck').onclick = () => {
  if (UPDATE_BTN[update.state]) mam.updateGo();
  else mam.checkUpdate();
  sound.click();
};
$('#updateSetting').hidden = testWindow;

addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    // La touche qui vient de libérer la souris a déjà ouvert le menu.
    if (performance.now() - menuOpenedAt < 300) return;
    if (menu.hidden) openMenu();
    else if (!$('#options').hidden && !optionsOnly) showOptions(false);
    else closeMenu();
  } else if (e.code === 'KeyN' && e.ctrlKey && e.shiftKey && G.hosting) {
    mam.testWindow();
  }
});

addEventListener('pointermove', e => {
  if (G.screen === 'game') return;
  document.documentElement.style.setProperty('--mx', e.clientX + 'px');
  document.documentElement.style.setProperty('--my', e.clientY + 'px');
});

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    sound.init();
    if (G.screen === 'game') keepAwake(true);
  }
});

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

mam.on('status', s => {
  if (s.state === 'connected') {
    linked = true;
    $('#offline').classList.remove('show');
    if (hello) send(hello);
  } else if (s.state === 'lost') {
    $('#offline').classList.add('show');
  } else if (s.state === 'ok') {
    $('#offline').classList.remove('show');
  } else if (s.state === 'closed') {
    backToTitle(CLOSED[s.reason] || 'La partie est terminée.', 'error');
  }
});

mam.on('message', data => {
  let m;
  try { m = JSON.parse(data); } catch { return; }
  onMessage(m);
});

// Invitation Steam acceptée pendant que le jeu tourne (pendant le chargement : suivie à l'écran titre)
let invite = '';
mam.on('join-request', code => {
  if (G.screen === 'loading') invite = code;
  else acceptInvite(code);
});

function acceptInvite(code) {
  if (G.screen !== 'title' || busy) return;
  $('#code').value = code;
  $('#joinForm').requestSubmit();
}

// `unreliable` : message d'état, le suivant le remplace s'il se perd en route.
function send(m, unreliable = false) {
  if (linked) mam.send(JSON.stringify(m), unreliable);
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      G.myId = m.id;
      if (G.screen === 'title') {
        show('lobby');
        setBusy(false);
        setStatus('');
      }
      break;
    case 'lobby':
      G.lobby = m;
      renderLobby();
      break;
    case 'countdown':
      $('#countdown').textContent = m.s > 0 ? `La nuit tombe dans ${m.s}…` : '';
      if (m.s > 0) sound.tick(m.s === 1);
      break;
    case 'start':
      startGame(m);
      break;
    case 's':
      applySnapshot(m);
      break;
    case 'ev':
      onEvent(m);
      break;
    case 'end':
      endGame(m);
      break;
  }
}

let loading = 0; // numéro de la partie en préparation (une plus récente, ou un retour au salon, l'annule)
const nextPaint = () => new Promise(ok => requestAnimationFrame(() => setTimeout(ok)));

async function startGame(m) {
  const map = m.map;
  map.tiles = Uint8Array.from(map.tiles, ch => ch.charCodeAt(0) - 48);
  G.map = map;
  G.players.clear();
  G.order = m.players.map(p => p.id);
  for (const p of m.players) {
    G.players.set(p.id, { ...p, tx: p.x, ty: p.y, ta: p.a, state: 'alive', light: true, running: false, moving: false, disc: false, battery: 100, downT: 0, revive: 0, room: '' });
  }
  G.items = new Map(m.items.map(it => [it.id, { ...it }]));
  G.monsters = m.monsters.map(mo => ({ ...mo, tx: mo.x, ty: mo.y, ta: mo.a, state: 0, lit: 0 }));
  G.skullsFound = m.skullsFound;
  G.skullsTotal = m.skullsTotal;
  G.exitOpen = m.exitOpen;
  G.time = m.time;
  G.snapT = -1;
  G.me = G.players.get(G.myId) || null;
  if (G.me) Object.assign(G.local, { x: G.me.x, y: G.me.y, a: G.me.a, p: 0, bob: 0, stamina: CFG.player.stamina, exhausted: false, light: true });
  G.messages = [];
  G.pings = [];
  G.extinguished.clear();
  G.fear = G.flash = G.shake = G.jumpscare = 0;
  G.spectating = null;
  Object.assign(G.view, { x: map.spawn.x, y: map.spawn.y, a: -Math.PI / 2, p: 0, who: null });
  // Construction du manoir et image d'essai, le salon restant affiché : la créature dort encore, et le
  // jeu ne se fige plus ensuite à chaque nouveauté (shaders compilés pendant l'écran de chargement).
  const token = ++loading, t0 = performance.now();
  $('#countdown').textContent = 'Le manoir se prépare…';
  renderLobby();
  await Promise.all([warm, nextPaint()]);
  if (token !== loading || G.map !== map) return;
  renderer.setMap(map);
  await renderer.prepare(G).catch(err => console.error(err));
  if (token !== loading || G.map !== map) return;
  G.time += (performance.now() - t0) / 1000;
  $('#countdown').textContent = '';
  show('game');
  if (G.me) input.lock();
  sound.init();
  sound.startGame();
  keepAwake(true);
  if (m.time < 1) say('Trouvez les crânes maudits… sans faire de bruit.', 'big');
  else if (G.me) say('De retour dans le manoir…', 'dim');
}

function applySnapshot(m) {
  if (!G.map || m.T < G.snapT) return; // doublé en route par un état plus récent (envoi non fiable)
  G.snapT = m.T;
  for (const [id, x, y, a, st, flags, battery, downT, revive] of m.p) {
    const p = G.players.get(id);
    if (!p) continue;
    const prev = p.state;
    p.state = PLAYER_STATES[st];
    p.running = !!(flags & 2);
    p.moving = !!(flags & 4);
    p.disc = !!(flags & 8);
    p.battery = battery;
    p.downT = downT;
    p.revive = revive;
    if (p === G.me) {
      if (prev !== p.state && p.state === 'alive' && prev === 'down') say('Vous êtes de nouveau debout !', 'green');
      continue;
    }
    p.tx = x;
    p.ty = y;
    p.ta = a;
    p.light = !!(flags & 1);
  }
  m.m.forEach(([x, y, a, st, lit], i) => {
    const mo = G.monsters[i] || (G.monsters[i] = { x, y, a });
    mo.tx = x;
    mo.ty = y;
    mo.ta = a;
    mo.state = st;
    mo.lit = lit;
  });
}

function say(text, kind = '') {
  G.messages.push({ text, kind, t: kind === 'big' ? 6 : 4.5 });
  if (G.messages.length > 5) G.messages.shift();
}

// Stéréo d'un son selon qu'il vient de la gauche ou de la droite du regard (à un autre étage : du même
// endroit du manoir, au-dessus ou en dessous)
function pan(x, y) {
  const v = G.view, dx = x - v.x - (floorAt(G.map, x) - floorAt(G.map, v.x)) * G.map.stride, dy = y - v.y;
  return clamp((dy * Math.cos(v.a) - dx * Math.sin(v.a)) / Math.max(Math.hypot(dx, dy), 1.5), -1, 1);
}

// Volume et stéréo d'un son selon sa position par rapport à celui qui l'entend
function spatial(x, y, base = 1) {
  const d = levelDist(G.map, G.view.x, G.view.y, x, y);
  return [pan(x, y), base * Math.max(0.12, 1 - d / 28)];
}

function onEvent(e) {
  const name = id => G.players.get(id)?.name ?? '???';
  const mine = id => id === G.myId;
  switch (e.k) {
    case 'wake': {
      say('Quelque chose s’est réveillé dans le manoir…', 'red');
      const mo = G.monsters[e.id];
      if (mo) sound.roar(...spatial(mo.x, mo.y, 0.8));
      break;
    }
    case 'take': {
      const it = G.items.get(e.item);
      if (it) it.taken = true;
      if (e.kind === 'skull') {
        G.skullsFound = e.n;
        say(`💀 ${mine(e.by) ? 'Vous avez' : name(e.by) + ' a'} trouvé un crâne maudit (${e.n}/${e.total})`, 'green');
        sound.skull();
        setTimeout(() => { for (const mo of G.monsters) sound.roar(...spatial(mo.x, mo.y, 0.7)); }, 1300);
        if (mine(e.by) && e.n < e.total) setTimeout(() => say('Elle a entendu… elle arrive.', 'red'), 1300);
      } else if (mine(e.by)) {
        sound.battery();
        say('🔋 Piles récupérées', 'dim');
      }
      break;
    }
    case 'exit':
      G.exitOpen = true;
      say('La grande porte du hall s’est ouverte ! FUYEZ !', 'big');
      sound.gong();
      G.flash = 0.4;
      break;
    case 'down':
      if (mine(e.id)) {
        G.jumpscare = 1;
        G.shake = 1.2;
        sound.jumpscare();
      } else {
        const p = G.players.get(e.id);
        say(`✚ ${name(e.id)} est à terre ! Allez l’aider !`, 'red');
        if (p) sound.scream(spatial(p.x, p.y)[0]);
      }
      break;
    case 'revive':
      say(mine(e.id) ? `${name(e.by)} vous a relevé·e !` : `${mine(e.by) ? 'Vous avez' : name(e.by) + ' a'} relevé ${name(e.id)}`, 'green');
      if (mine(e.id) || mine(e.by)) sound.revive();
      break;
    case 'dead':
      if (e.left) say(`${name(e.id)} a quitté la partie`, 'dim');
      else say(`☠ ${mine(e.id) ? 'Vous avez' : name(e.id) + ' a'} succombé…`, 'red');
      if (mine(e.id)) {
        G.local.light = false;
        sound.death();
        setTimeout(() => say('Vous êtes un fantôme : guidez les vivants avec vos signes.', 'big'), 1500);
      }
      break;
    case 'escape':
      say(`🚪 ${mine(e.id) ? 'Vous avez' : name(e.id) + ' a'} fui le manoir !`, 'green');
      if (mine(e.id)) sound.escape();
      break;
    case 'stun': {
      say('La créature recule devant la lumière !', '');
      const mo = G.monsters[e.id];
      if (mo) sound.screech(spatial(mo.x, mo.y)[0]);
      break;
    }
    case 'spot':
      if (mine(e.target)) { sound.spotted(); G.shake = Math.max(G.shake, 0.35); }
      break;
    case 'thunder':
      G.flash = 1;
      setTimeout(() => { G.flash = Math.max(G.flash, 0.7); }, 170);
      setTimeout(() => sound.thunder(), e.d * 1000);
      break;
    case 'ping':
      G.pings.push({ x: e.x, y: e.y, t: 6 });
      if (G.me?.state !== 'dead' || mine(e.id)) sound.ping(spatial(e.x, e.y)[0]);
      break;
    case 'disc':
      say(`${name(e.id)} a perdu la connexion…`, 'dim');
      break;
    case 'back':
      if (!mine(e.id)) say(`${name(e.id)} est de retour`, 'dim');
      break;
  }
}

const OUTCOME = { escaped: '🚪 Survie', dead: '☠ Mort', lost: '✚ Laissé·e à terre', left: '📴 Partie quittée' };

function endGame(m) {
  sound.stopGame();
  keepAwake(false);
  G.map = null;
  $('#countdown').textContent = '';
  const total = m.results.length, saved = m.results.filter(r => r.outcome === 'escaped').length;
  $('#resTitle').textContent = saved === total ? 'Vous avez survécu' : saved > 0 ? 'Une partie du groupe a survécu' : 'Le manoir a eu raison de vous';
  const mins = Math.floor(m.time / 60), secs = String(m.time % 60).padStart(2, '0');
  $('#resSub').textContent = `${saved} sur ${total} en vie · ${m.skulls}/${m.skullsTotal} crânes · ${mins} min ${secs}`;

  const table = $('#resTable');
  table.replaceChildren();
  const head = table.insertRow();
  for (const h of ['Joueur', 'Issue', '💀 Crânes', '✚ Relevés', '🔦 Repoussée', 'À terre']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  for (const r of m.results) {
    const row = table.insertRow();
    const cell = row.insertCell();
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = r.color;
    cell.append(dot, r.name);
    for (const v of [OUTCOME[r.outcome], r.skulls, r.revives, r.stuns, r.downs]) row.insertCell().textContent = v;
  }

  const awards = $('#awards');
  awards.replaceChildren();
  const best = (key, label, unit) => {
    const top = [...m.results].sort((a, b) => b[key] - a[key])[0];
    if (!top || top[key] <= 0) return;
    const div = document.createElement('div');
    div.className = 'award';
    const b = document.createElement('b');
    b.textContent = top.name;
    div.append(label + ' : ', b, ` (${top[key]} ${unit})`);
    awards.appendChild(div);
  };
  best('skulls', '💀 Le plus de crânes', 'trouvés');
  best('revives', '✚ Le plus de sauvetages', 'relevés');
  best('stuns', '🔦 A repoussé la créature', 'fois');

  show('results');
  sound.music(true);
}

// ---------------------------------------------------------------------------
// Boucle de jeu
// ---------------------------------------------------------------------------

const LOOK = 0.0022; // radians par pixel de souris, à sensibilité 1
const TURN = 2.4; // radians par seconde avec les flèches

function spectate(inp) {
  const alive = G.order.map(id => G.players.get(id)).filter(p => p && p !== G.me && (p.state === 'alive' || p.state === 'down'));
  if (!alive.length) { G.spectating = null; return; }
  if (!alive.includes(G.spectating)) G.spectating = alive[0];
  if (inp.next) G.spectating = alive[(alive.indexOf(G.spectating) + 1) % alive.length];
}

function updateLocal(dt, inp) {
  const me = G.me, L = G.local;
  if (!me || me.state === 'escaped') { spectate(inp); return; }
  // Regard : souris (capturée) et flèches gauche/droite
  const a = L.a + inp.look.x * LOOK * sensitivity + inp.turn * TURN * dt;
  L.a = Math.atan2(Math.sin(a), Math.cos(a));
  L.p = clamp(L.p - inp.look.y * LOOK * sensitivity, -1.3, 1.3);
  // Déplacement par rapport au regard : avancer/reculer, pas de côté
  let fwd = inp.fwd, side = inp.side;
  const len = Math.hypot(fwd, side);
  if (len > 1) { fwd /= len; side /= len; }
  const ca = Math.cos(L.a), sa = Math.sin(L.a);
  const mx = fwd * ca - side * sa, my = fwd * sa + side * ca;
  const moving = len > 0.1;
  let speed;
  if (me.state === 'dead') speed = CFG.player.ghost;
  else if (me.state === 'down') speed = CFG.player.crawl;
  else if (inp.run && moving && !L.exhausted && L.stamina > 0) {
    speed = CFG.player.run;
    L.stamina = Math.max(0, L.stamina - dt);
    if (L.stamina <= 0) L.exhausted = true;
  } else {
    speed = CFG.player.walk;
    L.stamina = Math.min(CFG.player.stamina, L.stamina + CFG.player.staminaRegen * dt);
    if (L.exhausted && L.stamina > CFG.player.stamina * 0.4) L.exhausted = false;
  }
  L.running = me.state === 'alive' && speed === CFG.player.run;
  L.moving = moving;
  if (moving) {
    const dx = mx * speed * dt, dy = my * speed * dt;
    if (me.state === 'dead') {
      // un fantôme traverse les murs, mais reste à son étage (il en change par les escaliers)
      const ox = G.map.floors[floorAt(G.map, L.x)].ox;
      L.x = clamp(L.x + dx, ox + 0.5, ox + G.map.fw - 0.5);
      L.y = clamp(L.y + dy, 0.5, G.map.h - 0.5);
    } else {
      [L.x, L.y] = moveBox(G.map, L.x, L.y, dx, dy, CFG.player.half, G.exitOpen);
    }
    [L.x, L.y] = crossStairs(G.map, L.x, L.y);
  }
  if (moving) L.bob += speed * dt;
  if (inp.toggleLight && me.state === 'alive') { L.light = !L.light; sound.click(); }
  if (moving && me.state !== 'dead') {
    L.step += speed * dt;
    if (L.step > (L.running ? 0.85 : 0.6)) {
      L.step = 0;
      sound.footstep(L.running ? 0.45 : me.state === 'down' ? 0.1 : 0.2, 0);
    }
  }
  L.act = inp.act;
  if (inp.actPressed && me.state === 'dead') send({ t: 'ping', x: r2(L.x), y: r2(L.y) });
  me.x = L.x;
  me.y = L.y;
  me.a = L.a;
  me.moving = moving;
  me.running = L.running;
  me.light = L.light && me.battery > 0 && me.state === 'alive';
}

// Les autres joueurs et la créature glissent vers leur dernière position connue.
function smooth(dt) {
  const k = 1 - Math.exp(-dt * 12);
  const follow = o => {
    if (Math.abs(o.tx - o.x) + Math.abs(o.ty - o.y) > 4) { o.x = o.tx; o.y = o.ty; }
    else { o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    o.a += angDiff(o.ta, o.a) * k;
  };
  for (const p of G.players.values()) if (p !== G.me) follow(p);
  for (const m of G.monsters) follow(m);
}

function updateWorld(dt) {
  for (const m of G.messages) m.t -= dt;
  G.messages = G.messages.filter(m => m.t > 0);
  for (const p of G.pings) p.t -= dt;
  G.pings = G.pings.filter(p => p.t > 0);
  G.flash = Math.max(0, G.flash - dt * 2.2);
  G.shake = Math.max(0, G.shake - dt * 1.6);
  G.jumpscare = Math.max(0, G.jumpscare - dt * 1.1);

  const map = G.map, me = G.me, L = G.local, v = G.view;
  if (me && me.state !== 'escaped') {
    Object.assign(v, { x: L.x, y: L.y, a: L.a, p: L.p, state: me.state, bob: L.bob, moving: L.moving, running: L.running, who: me });
  } else if (G.spectating) {
    // après la fuite : on voit par les yeux d'un ami
    const p = G.spectating;
    if (p.moving) v.bob += dt * (p.running ? CFG.player.run : CFG.player.walk);
    Object.assign(v, { x: p.x, y: p.y, a: p.a, p: 0, state: p.state, moving: p.moving, running: p.running, who: p });
  } else {
    Object.assign(v, { x: map.exit.x + 1, y: map.exit.y - 2.5, a: Math.PI / 2, p: 0, state: 'alive', moving: false, running: false, who: null });
  }
  const roomAt = (x, y) => {
    const r = map.roomIdx[Math.floor(y) * map.w + Math.floor(x)];
    return r >= 0 ? `${map.rooms[r].name} · ${map.floors[map.rooms[r].f].short}` : null;
  };
  for (const p of G.players.values()) { const r = roomAt(p.x, p.y); if (r) p.room = r; }
  const fr = roomAt(v.x, v.y);
  if (fr) G.focusRoom = fr;

  G.reviveTarget = null;
  if (me?.state === 'alive') {
    let bd = CFG.rules.reviveDist;
    for (const p of G.players.values()) {
      if (p === me || p.state !== 'down') continue;
      const d = Math.hypot(p.x - G.local.x, p.y - G.local.y);
      if (d < bd) { bd = d; G.reviveTarget = p; }
    }
  }

  // La créature souffle les bougies sur son passage
  for (const m of G.monsters) {
    if (m.state === 0) continue;
    map.lights.forEach((l, i) => {
      if ((l.k === 'candle' || l.k === 'pumpkin' || l.k === 'chandelier') && Math.abs(l.x - m.x) < 2.2 && Math.abs(l.y - m.y) < 2.2) G.extinguished.set(i, G.time + 12);
    });
  }

  let fear = 0;
  for (const m of G.monsters) {
    if (m.state === 0) continue;
    const d = levelDist(map, v.x, v.y, m.x, m.y);
    let k = Math.max(0, 1 - d / 11);
    if (m.state === 4) k = Math.min(1, k * 1.3 + (d < 14 ? 0.12 : 0));
    fear = Math.max(fear, k);
  }
  if (!me || me.state === 'escaped' || me.state === 'dead') fear *= 0.5;
  G.fear += (fear - G.fear) * Math.min(1, dt * 3);

  sound.update(dt, {
    fear: G.fear,
    ghost: me?.state === 'dead',
    monsters: G.monsters.map(m => {
      const d = levelDist(map, v.x, v.y, m.x, m.y);
      return { pan: pan(m.x, m.y), chase: m.state === 4, vol: m.state === 0 ? 0 : Math.max(0, 1 - d / 13) ** 2 * (m.state === 4 ? 0.55 : 0.28) };
    }),
  });
}

let lastSend = 0;
function sendInput(now) {
  const me = G.me;
  if (!me || me.state === 'escaped' || now - lastSend < 50) return;
  lastSend = now;
  const L = G.local;
  send({ t: 'in', x: r2(L.x), y: r2(L.y), a: r2(L.a), l: L.light ? 1 : 0, r: L.running ? 1 : 0, m: L.moving ? 1 : 0, e: L.act ? 1 : 0 }, true);
}

const IDLE = { fwd: 0, side: 0, turn: 0, look: { x: 0, y: 0 }, run: false, act: false, actPressed: false, toggleLight: false, next: false, plan: false };

// Sur un écran rapide (120 Hz, 144 Hz…), une image sur deux (ou plus) seulement : 60 à 80 images par
// seconde suffisent ici, et la carte graphique travaille deux fois moins. L'écran se mesure au plus
// court intervalle entre deux appels, les appels sautés comptant aussi.
let last = performance.now(), lastCall = last, refresh = 1000 / 60, fastest = Infinity, sampleUntil = 0, skipped = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const gap = now - lastCall;
  lastCall = now;
  if (gap > 2) fastest = Math.min(fastest, gap);
  if (now > sampleUntil) {
    if (fastest < Infinity) refresh = fastest;
    fastest = Infinity;
    sampleUntil = now + 2000;
  }
  if (++skipped < Math.floor(1000 / 60 / refresh + 0.1)) return;
  skipped = 0;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.screen === 'game' && G.map) {
    G.time += dt;
    // Dans le manoir (vivant, à terre ou fantôme), la souris sert à regarder : elle est capturée.
    input.wantLock = !!G.me && G.me.state !== 'escaped';
    if (!input.wantLock) input.unlock();
    const inp = menu.hidden ? input.state() : IDLE;
    updateLocal(dt, inp);
    smooth(dt);
    updateWorld(dt);
    sendInput(now);
    G.showPlan = inp.plan;
    G.needClick = input.wantLock && menu.hidden && !input.locked;
    renderer.frame(G);
  }
  input.endFrame();
}
requestAnimationFrame(loop);

if (params.has('debug')) Object.assign(window, { __G: G, __R: renderer });
// Fenêtre de test ouverte par l'hôte (Ctrl+Maj+N) : rejoint la partie de ce PC dès que l'application la relie.
if (testWindow) {
  $('#name').value = params.get('nom') || 'Test';
  $('.invite').hidden = true;
  prepareHello();
}
