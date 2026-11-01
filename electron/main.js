// Application de bureau : la fenêtre du jeu, Steam et le pont entre la page et le réseau.
import { app, BrowserWindow, ipcMain, protocol, clipboard, dialog, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import steamworks from 'steamworks.js';
import { Room } from '../server/room.js';
import { Network, SPACEWAR } from './network.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
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

// Une seule instance : un double-clic de trop ramène simplement la fenêtre ouverte.
if (!app.requestSingleInstanceLock()) app.exit(0);
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
  });
  app.on('second-instance', bringToFront);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => network?.dispose());

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
  ipcMain.on('net:invite', e => { if (isMain(e)) network?.invite(); });
  ipcMain.handle('display:get', () => display);
  ipcMain.on('display:set', (e, mode) => { if (isMain(e)) setDisplay(mode); });
  ipcMain.on('clipboard', (e, text) => clipboard.writeText(String(text)));
  ipcMain.on('dev:test-window', e => { if (isMain(e)) openTest(); });
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

function toMain(channel, value) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, value);
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
    entry.socket = network?.addLocalPlayer(`test-${n}`, data => { if (!win.isDestroyed()) win.webContents.send('net:message', data); });
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
