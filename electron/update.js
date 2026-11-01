// Mise à jour automatique par les releases GitHub. Au lancement, l'application regarde la dernière
// version publiée ; si elle est plus récente, elle la télécharge en arrière-plan et l'écran titre
// propose de redémarrer.
// - Exe portable : la nouvelle version arrive à côté de l'ancienne, sous son propre nom
//   (Minuit-au-Manoir-x.y.z.exe). Une fois lancée, elle efface l'ancienne.
// - Jeu dézippé : la nouvelle version est dézippée dans le dossier temporaire. Lancée une première
//   fois sans fenêtre, elle se recopie par-dessus l'ancienne et relance le jeu à sa place, qui efface
//   ensuite le dossier temporaire.
// D'une version à l'autre, ce qui reste à faire passe par maj.json, dans les données de l'application.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export const REPO = 'TheProdigy27/Minuit-au-Manoir';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSETS = { exe: /\.exe$/i, zip: /-win\.zip$/i }; // les fichiers de chaque release, reconnus à leur nom
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // fourni avec Windows 10 et 11, il lit les zip

// Dans Electron, fs voit les archives .asar comme des dossiers : pour copier ou effacer le jeu
// lui-même, il faut le fs d'origine.
const rawFs = process.versions.electron ? createRequire(import.meta.url)('original-fs') : fs;

const parts = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

// « 3.10.0 » est plus récent que « v3.9.2 »
export function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export const pickAsset = (release, kind) => release.assets?.find(a => ASSETS[kind]?.test(a.name));

// Émet 'state' : { state, version, progress }, où state vaut 'none' (pas encore regardé), 'checking',
// 'latest' (le jeu est à jour), 'unreachable' (GitHub injoignable), 'downloading', 'ready' (il n'y a
// plus qu'à redémarrer), 'failed' (téléchargement raté) ou 'manual' (à télécharger soi-même : jeu
// lancé depuis les sources, dossier protégé en écriture…).
export class Updater extends EventEmitter {
  // kind : 'exe' (portable), 'zip' (dossier dézippé) ou null ; target : l'exe portable ou le dossier du jeu.
  constructor({ version, kind, target, exeName, temp, pendingFile, fetch }) {
    super();
    Object.assign(this, { version, kind, target, exeName, temp, pendingFile, fetch });
    this.status = { state: 'none' };
    this.page = PAGE;
    this.busy = false;
    this.launch = null; // l'exe qui finira la mise à jour
    this.pending = null; // et ce qu'il lui restera à faire
    this.part = null; // fichier en cours de téléchargement
    this.abort = new AbortController();
  }

  set(status) {
    this.status = status;
    this.emit('state', status);
  }

  async check() {
    if (this.busy || this.status.state === 'ready') return;
    this.busy = true;
    if (!this.status.version) this.set({ state: 'checking' }); // une version déjà annoncée reste affichée
    try {
      const res = await this.fetch(API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${REPO}/${this.version}` },
        signal: this.abort.signal,
      });
      if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
      const release = await res.json();
      if (!newer(release.tag_name, this.version)) return this.set({ state: 'latest' });
      const version = String(release.tag_name).replace(/^v/i, '');
      if (String(release.html_url).startsWith('https://github.com/')) this.page = release.html_url;
      const asset = pickAsset(release, this.kind);
      if (!asset || !writable(this.kind === 'exe' ? path.dirname(this.target) : this.target)) return this.set({ state: 'manual', version });
      this.set({ state: 'downloading', version, progress: 0 });
      await (this.kind === 'exe' ? this.fetchExe(asset) : this.fetchZip(asset));
      this.set({ state: 'ready', version });
    } catch (err) {
      if (this.abort.signal.aborted) return;
      console.error('Mise à jour :', err);
      const { version } = this.status;
      this.set(version ? { state: 'failed', version } : { state: 'unreachable' });
    } finally {
      this.busy = false;
    }
  }

  // L'exe portable : à côté de l'ancien, sous le nom qu'il porte dans la release.
  async fetchExe(asset) {
    const dest = path.join(path.dirname(this.target), path.basename(asset.name));
    if (same(dest, this.target)) throw new Error(`${asset.name} porte le nom de l'exe lancé`);
    if (!(await matches(dest, asset))) await this.download(asset, dest);
    this.launch = dest;
    this.pending = { remove: this.target };
  }

  // Le jeu dézippé : la release est dézippée dans le dossier temporaire, d'où elle se recopiera.
  async fetchZip(asset) {
    removeTree(this.temp); // ce qu'une mise à jour précédente aurait laissé
    fs.mkdirSync(this.temp, { recursive: true });
    const zip = path.join(this.temp, path.basename(asset.name));
    await this.download(asset, zip);
    const dir = path.join(this.temp, 'jeu');
    fs.mkdirSync(dir);
    await promisify(execFile)(TAR, ['-xf', zip, '-C', dir], { windowsHide: true });
    fs.rmSync(zip);
    // Le zip range le jeu dans un dossier « Minuit au Manoir »
    const root = [dir, ...fs.readdirSync(dir).map(n => path.join(dir, n))].find(d => fs.existsSync(path.join(d, this.exeName)));
    if (!root) throw new Error(`${this.exeName} manque dans ${asset.name}`);
    this.launch = path.join(root, this.exeName);
    this.pending = { install: { from: root, to: this.target }, remove: this.temp };
  }

  async download(asset, dest) {
    const part = (this.part = dest + '.part');
    try {
      const res = await this.fetch(asset.browser_download_url, { signal: this.abort.signal });
      if (!res.ok || !res.body) throw new Error(`${asset.name} : le serveur a répondu ${res.status}`);
      const hash = createHash('sha256');
      let got = 0;
      const tick = n => {
        got += n;
        const progress = Math.min(1, Math.floor((got / asset.size) * 100) / 100);
        if (progress !== this.status.progress) this.set({ ...this.status, progress });
      };
      await pipeline(res.body, async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          tick(chunk.length);
          yield chunk;
        }
      }, fs.createWriteStream(part));
      if (got !== asset.size || !digestOk(asset, hash.digest('hex'))) throw new Error(`${asset.name} est arrivé abîmé`);
      fs.renameSync(part, dest);
    } catch (err) {
      fs.rmSync(part, { force: true });
      throw err;
    } finally {
      this.part = null;
    }
  }

  // À la fermeture, une fois le verrou d'instance unique rendu : lance la nouvelle version.
  start() {
    try {
      fs.writeFileSync(this.pendingFile, JSON.stringify(this.pending));
      relaunch(this.launch);
    } catch (err) {
      console.error('Mise à jour :', err);
    }
  }

  // À la fermeture, sans redémarrer : abandonne le téléchargement en cours.
  dispose() {
    this.abort.abort();
    if (this.part) fs.rmSync(this.part, { force: true });
  }
}

// Lance un exe du jeu, indépendant de celui-ci, qui va se fermer.
export function relaunch(exe) {
  const env = { ...process.env };
  for (const k in env) if (k.startsWith('PORTABLE_EXECUTABLE_')) delete env[k]; // posées par l'exe portable en cours
  // Son dossier comme dossier courant : l'exe portable doit pouvoir effacer le sien en se fermant.
  spawn(exe, [], { detached: true, stdio: 'ignore', env, cwd: path.dirname(exe) })
    .on('error', err => console.error('Mise à jour :', err))
    .unref();
}

// Ce que la version précédente a laissé à faire en se fermant (null si rien).
export function readPending(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Jeu dézippé : lancée sans fenêtre depuis le dossier temporaire, la nouvelle version attend que
// l'ancienne soit fermée, puis se recopie par-dessus. Renvoie l'exe à relancer, ou null si ce n'est
// pas à elle de le faire ou si la copie a échoué (elle s'ouvre alors là où elle est, pour cette fois).
export function install(pendingFile, pending, execPath = process.execPath) {
  const here = path.dirname(execPath);
  if (!pending?.install || !same(pending.install.from, here)) return null;
  const { to } = pending.install;
  const exe = path.join(to, path.basename(execPath));
  fs.writeFileSync(pendingFile, JSON.stringify({ remove: pending.remove }));
  try {
    for (let t = 0; !unlocked(exe); t++) {
      if (t > 240) throw new Error(`${exe} est toujours ouvert`);
      sleepSync(250);
    }
    for (let t = 0; ; t++) {
      try {
        copyTree(here, to);
        return exe;
      } catch (err) {
        if (t >= 5) throw err;
        sleepSync(1000);
      }
    }
  } catch (err) {
    console.error('Mise à jour :', err);
    return null;
  }
}

// Au lancement suivant : efface l'ancien exe portable ou le dossier temporaire, dès que la version
// précédente a fini de se fermer (Windows protège les fichiers d'un programme ouvert).
// `running` : les fichiers de ce jeu-ci, à ne jamais effacer.
export async function cleanUp(pendingFile, pending, running) {
  const target = pending?.remove;
  if (!target || running.some(f => f && inside(f, target))) return;
  for (let t = 0; t < 60; t++) {
    try {
      removeTree(target);
      fs.rmSync(pendingFile, { force: true });
      return;
    } catch {
      await new Promise(ok => setTimeout(ok, 1000));
    }
  }
}

// GitHub donne l'empreinte de chaque fichier (« sha256:… ») ; les releases anciennes n'en ont pas.
const digestOk = (asset, hex) => !asset.digest || asset.digest === `sha256:${hex}`;

// Le fichier est-il déjà là, complet (téléchargé lors d'un lancement précédent) ?
async function matches(file, asset) {
  try {
    if (fs.statSync(file).size !== asset.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return digestOk(asset, hash.digest('hex'));
  } catch {
    return false;
  }
}

// Windows ne dit pas d'avance si l'on a le droit d'écrire dans un dossier : on essaie.
function writable(dir) {
  const probe = path.join(dir, `.maj-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

// Tant qu'un programme tourne, Windows refuse d'ouvrir son exe en écriture.
function unlocked(exe) {
  try {
    rawFs.closeSync(rawFs.openSync(exe, 'r+'));
    return true;
  } catch (err) {
    return err.code === 'ENOENT';
  }
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const same = (a, b) => path.relative(a, b) === '';
const inside = (file, dir) => {
  const rel = path.relative(dir, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

function copyTree(from, to) {
  rawFs.mkdirSync(to, { recursive: true });
  for (const e of rawFs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name));
    else rawFs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

function removeTree(p) {
  let dir;
  try {
    dir = rawFs.lstatSync(p).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (!dir) return rawFs.unlinkSync(p);
  for (const name of rawFs.readdirSync(p)) removeTree(path.join(p, name));
  rawFs.rmdirSync(p);
}
