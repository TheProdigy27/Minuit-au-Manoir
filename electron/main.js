// Application de bureau : la fenêtre du jeu, Steam et le pont entre la page et le réseau.
import { app, BrowserWindow, ipcMain, protocol, clipboard, dialog, Menu, net, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import steamworks from 'steamworks.js';
import { Room } from '../server/room.js';
import { Network, SPACEWAR } from './network.js';
import { Updater, readPending, install, cleanUp, relaunch } from './update.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};
const NO_STEAM = 'Steam n’est pas disponible : lancez Steam, connectez-vous, puis réessayez.';

// Affichage, gardé d'une session à l'autre : plein écran (par défaut), plein écran fenêtré ou fenêtré.
// Electron n'a pas de plein écran exclusif : « plein écran » s'en rapproche en se réduisant dès que le jeu
// perd la main (Alt+Tab, clic sur un autre écran), alors que le plein écran fenêtré reste affiché.
const DISPLAYS = ['fullscreen', 'borderless', 'windowed'];
let display = 'fullscreen', lastFull = 'fullscreen'; // lastFull : le plein écran que F11 rétablit
let confirming = false; // boîte « Vous hébergez la partie » ouverte : elle ne doit pas réduire le jeu

let mainWin = null;
let steam = null, steamError = '', network = null;
const tests = new Map(); // fenêtres de test : id de la page → { win, socket }
let testCount = 0;

// Mise à jour : de l'exe portable, ou du dossier du jeu dézippé (lancé depuis les sources, le jeu
// signale seulement la nouvelle version).
const PORTABLE = process.env.PORTABLE_EXECUTABLE_FILE;
const pendingFile = path.join(app.getPath('userData'), 'maj.json');
const pending = readPending(pendingFile);
const updater = new Updater({
  version: app.getVersion(),
  kind: PORTABLE ? 'exe' : app.isPackaged ? 'zip' : null,
  target: PORTABLE || path.dirname(process.execPath),
  exeName: path.basename(process.execPath),
  temp: path.join(app.getPath('temp'), 'Minuit-au-Manoir-maj'),
  pendingFile,
  fetch: (url, options) => net.fetch(url, options),
});
let updating = false; // la nouvelle version démarrera quand celle-ci se fermera

// Une seule instance : un double-clic de trop ramène simplement la fenêtre ouverte.
// Sauf la nouvelle version d'un jeu dézippé, qui vient se recopier à la place de l'ancienne.
const installed = install(pendingFile, pending);
if (installed) {
  relaunch(installed);
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) app.exit(0);
else launch();

function launch() {
  // L'overlay Steam (Maj+Tab) ne s'accroche que si Steam démarre avant la première fenêtre.
  // Sans overlay (--sans-overlay, ou s'il refuse de s'afficher), les invitations s'ouvrent dans Steam.
  if (!process.argv.includes('--sans-overlay')) steamworks.electronEnableSteamOverlay(true);
  startSteam();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    protocol.handle('app', serve);
    const saved = await fs.readFile(settingsFile(), 'utf8').then(JSON.parse).catch(() => ({}));
    if (DISPLAYS.includes(saved.display)) display = saved.display;
    if (display !== 'windowed') lastFull = display;
    openMain();
    cleanUp(pendingFile, pending, [process.execPath, PORTABLE]);
    // Après l'ouverture, pour ne pas la ralentir ; puis de temps en temps, pour ceux qui laissent le jeu ouvert.
    setTimeout(() => updater.check(), 3000);
    setInterval(() => updater.check(), 30 * 60e3);
  });
  app.on('second-instance', bringToFront);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    network?.dispose();
    if (!updating) return updater.dispose();
    app.releaseSingleInstanceLock();
    updater.start();
  });
  updater.on('state', s => toMain('update:state', s));

  ipcMain.handle('steam:info', e => info(e));
  ipcMain.handle('steam:retry', e => { startSteam(); return info(e); });
  ipcMain.handle('net:host', async e => {
    if (!isMain(e)) return {};
    if (!network) return { error: NO_STEAM };
    closeTests();
    try {
      return { code: await network.host() };
    } catch {
      return { error: 'Steam n’a pas pu créer la partie. Vérifiez que Steam est connecté, puis réessayez.' };
    }
  });
  ipcMain.handle('net:join', async (e, code) => {
    if (!isMain(e)) return {};
    if (!network) return { error: NO_STEAM };
    closeTests();
    try {
      return { code: await network.join(code) };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.on('net:leave', e => {
    if (!isMain(e)) return;
    closeTests();
    network?.leave();
  });
  ipcMain.on('net:send', (e, data, unreliable) => {
    if (typeof data !== 'string') return;
    const test = tests.get(e.sender.id);
    if (test) test.socket?.receive(data);
    else if (isMain(e)) network?.send(data, unreliable);
  });
  // Voix du joueur (trame Opus numérotée) : vers l'hôte, ou vers la salle pour une fenêtre de test.
  ipcMain.on('voice:send', (e, data) => {
    if (!(data instanceof Uint8Array)) return;
    const test = tests.get(e.sender.id);
    if (test) test.socket?.receiveVoice(Buffer.from(data));
    else if (isMain(e)) network?.sendVoice(Buffer.from(data));
  });
  ipcMain.on('net:invite', e => { if (isMain(e)) network?.invite(); });
  ipcMain.handle('display:get', () => display);
  ipcMain.on('display:set', (e, mode) => { if (isMain(e)) setDisplay(mode); });
  ipcMain.on('clipboard', (e, text) => clipboard.writeText(String(text)));
  ipcMain.on('dev:test-window', e => { if (isMain(e)) openTest(); });
  ipcMain.handle('update:get', e => (isMain(e) ? updater.status : { state: 'none' }));
  ipcMain.on('update:check', e => { if (isMain(e)) updater.check(); });
  // Le bouton de l'écran titre : redémarrer sur la nouvelle version, réessayer, ou ouvrir la page de la release
  ipcMain.on('update:go', e => {
    if (!isMain(e)) return;
    const { state } = updater.status;
    if (state === 'ready' && !network?.guests) {
      updating = true;
      app.quit();
    } else if (state === 'failed') updater.check();
    else if (state === 'manual') shell.openExternal(updater.page);
  });
  // Comme la croix de la fenêtre : l'hôte d'une partie doit d'abord confirmer.
  ipcMain.on('app:quit', e => { if (isMain(e)) mainWin.close(); });
}

function startSteam() {
  if (network) return;
  try {
    steam = steamworks.init(SPACEWAR);
  } catch (err) {
    steamError = String(err?.message || err);
    return;
  }
  steamError = '';
  network = new Network({ steam, SteamCallback: steamworks.SteamCallback, version: app.getVersion(), createRoom: () => new Room() });
  network.on('message', data => toMain('net:message', data));
  network.on('voice', (from, data) => toMain('voice:message', from, new Uint8Array(data))); // copie : rien d'autre du tampon de Steam
  network.on('status', s => {
    if (s.state === 'closed') closeTests();
    toMain('net:status', s);
  });
  network.on('join-request', code => {
    toMain('net:join-request', code);
    bringToFront();
  });
}

function bringToFront() {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
}

function info(e) {
  return {
    ok: !!network,
    name: network ? steam.localplayer.getName() : '',
    error: steamError,
    version: app.getVersion(),
    test: tests.has(e.sender.id),
  };
}

const isMain = e => !!mainWin && e.sender === mainWin.webContents;

const settingsFile = () => path.join(app.getPath('userData'), 'reglages.json');

function setDisplay(mode) {
  if (!DISPLAYS.includes(mode)) return;
  display = mode;
  if (mode !== 'windowed') lastFull = mode;
  mainWin?.setFullScreen(mode !== 'windowed');
  toMain('display:changed', mode);
  fs.writeFile(settingsFile(), JSON.stringify({ display })).catch(() => {});
}

function toMain(channel, ...values) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, ...values);
}

// Les fichiers du jeu, servis sous app://jeu/ comme l'était le site : public/, /shared/ et three.js (/vendor/).
const MOUNTS = { '/shared/': 'shared', '/vendor/': 'node_modules/three/build' };

async function serve(req) {
  const { pathname } = new URL(req.url);
  const mount = Object.keys(MOUNTS).find(m => pathname.startsWith(m));
  const base = path.join(ROOT, mount ? MOUNTS[mount] : 'public');
  let file;
  try {
    const rel = decodeURIComponent(mount ? pathname.slice(mount.length - 1) : pathname);
    file = path.join(base, rel.endsWith('/') ? rel + 'index.html' : rel);
  } catch {
    return new Response('Requête invalide', { status: 400 });
  }
  if (!file.startsWith(base + path.sep)) return new Response('Interdit', { status: 403 });
  try {
    return new Response(await fs.readFile(file), { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' } });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}

function createWindow(query, options) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 540,
    show: false,
    title: 'Minuit au Manoir',
    icon: path.join(ROOT, 'public', 'icon.png'),
    backgroundColor: '#050407',
    webPreferences: { preload: path.join(ROOT, 'electron', 'preload.cjs'), autoplayPolicy: 'no-user-gesture-required' },
    ...options,
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' && win === mainWin) setDisplay(display === 'windowed' ? lastFull : 'windowed');
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (input.key === 'F12' || (input.control && input.shift && input.code === 'KeyI')) win.webContents.toggleDevTools();
    else return;
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadURL('app://jeu/index.html' + query);
  return win;
}

function openMain() {
  mainWin = createWindow('', { fullscreen: display !== 'windowed' });
  mainWin.once('ready-to-show', () => {
    if (display === 'windowed') mainWin.maximize();
    mainWin.show();
  });
  // Plein écran : le jeu se réduit quand on passe à une autre application (pas à une fenêtre de test ni aux outils de développement).
  mainWin.on('blur', () => setTimeout(() => {
    if (display !== 'fullscreen' || !mainWin || confirming || mainWin.isFocused() || mainWin.isMinimized()) return;
    if (BrowserWindow.getFocusedWindow() || mainWin.webContents.isDevToolsOpened()) return;
    mainWin.minimize();
  }, 100));
  // Page (re)chargée : elle repart de l'écran titre, on quitte donc toute partie en cours.
  mainWin.webContents.on('did-finish-load', () => { closeTests(); network?.leave(); });
  mainWin.on('close', e => {
    if (!network?.guests) return;
    confirming = true;
    const choice = dialog.showMessageBoxSync(mainWin, {
      type: 'warning',
      title: 'Minuit au Manoir',
      message: 'Vous hébergez la partie.',
      detail: 'Si vous quittez, la partie s’arrête pour tous les joueurs.',
      buttons: ['Rester', 'Quitter quand même'],
      defaultId: 0,
      cancelId: 0,
    });
    confirming = false;
    if (choice === 0) e.preventDefault();
  });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

// Fenêtre de test (Ctrl+Maj+N chez l'hôte) : un joueur de plus sur ce PC, sans passer par Steam.
function openTest() {
  if (!network?.hosting) return;
  const n = ++testCount + 1;
  const offset = 40 * (testCount % 6);
  const win = createWindow(`?test&nom=${encodeURIComponent('Test ' + n)}`, { width: 960, height: 620, x: 60 + offset, y: 60 + offset });
  const id = win.webContents.id;
  const entry = { win, socket: null };
  tests.set(id, entry);
  win.webContents.setAudioMuted(true);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    entry.socket?.close();
    entry.socket = network?.addLocalPlayer(`test-${n}`, data => { if (!win.isDestroyed()) win.webContents.send('net:message', data); },
      (from, data) => { if (!win.isDestroyed()) win.webContents.send('voice:message', from, new Uint8Array(data)); });
    if (entry.socket) win.webContents.send('net:status', { state: 'connected' });
  });
  win.on('closed', () => {
    entry.socket?.close();
    tests.delete(id);
  });
}

function closeTests() {
  for (const { win } of tests.values()) if (!win.isDestroyed()) win.destroy();
}
