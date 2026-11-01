// Mise à jour automatique (electron/update.js) avec un faux GitHub et des dossiers temporaires.
// Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Updater, newer, pickAsset, install, cleanUp, readPending } from '../electron/update.js';

const EXE = Buffer.alloc(300_000, 7); // la « nouvelle version »
const sha = buf => 'sha256:' + createHash('sha256').update(buf).digest('hex');

function release(tag, body = EXE, digest = sha(body)) {
  return {
    tag_name: tag,
    html_url: `https://github.com/TheProdigy27/Minuit-au-Manoir/releases/tag/${tag}`,
    assets: [
      { name: `Minuit-au-Manoir-${tag.slice(1)}-win.zip`, size: 10, browser_download_url: 'https://x/zip', digest: 'sha256:00' },
      { name: `Minuit-au-Manoir-${tag.slice(1)}.exe`, size: body.length, browser_download_url: 'https://x/exe', digest },
    ],
  };
}

// Faux GitHub : l'API donne la release, le lien de l'exe renvoie `body` par morceaux.
function fakeFetch(rel, body = EXE) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) return Response.json(rel);
    if (url === 'https://x/exe') {
      let i = 0;
      return new Response(new ReadableStream({
        pull(c) {
          if (i >= body.length) return c.close();
          c.enqueue(body.subarray(i, i + 16384));
          i += 16384;
        },
      }));
    }
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mam-maj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function portable(t, rel, opts = {}) {
  const dir = tmpDir(t);
  const target = path.join(dir, 'Minuit-au-Manoir-3.1.0.exe');
  fs.writeFileSync(target, 'ancien');
  const { fetch, calls } = fakeFetch(rel, opts.body);
  const updater = new Updater({ version: '3.1.0', kind: 'kind' in opts ? opts.kind : 'exe', target, pendingFile: path.join(dir, 'maj.json'), fetch });
  const states = [];
  updater.on('state', s => states.push(s));
  return { dir, target, updater, states, calls };
}

test('compare les numéros de version', () => {
  assert.ok(newer('v3.2.0', '3.1.0'));
  assert.ok(newer('v3.10.0', '3.9.9'));
  assert.ok(newer('4.0', '3.9.9'));
  assert.ok(!newer('v3.1.0', '3.1.0'));
  assert.ok(!newer('v3.0.9', '3.1.0'));
  assert.ok(!newer('v3.1.0-beta', '3.1.0'));
});

test('reconnaît les fichiers de la release', () => {
  const rel = release('v3.2.0');
  assert.equal(pickAsset(rel, 'exe').name, 'Minuit-au-Manoir-3.2.0.exe');
  assert.equal(pickAsset(rel, 'zip').name, 'Minuit-au-Manoir-3.2.0-win.zip');
  assert.equal(pickAsset(rel, null), undefined);
});

test('à jour : ne télécharge rien', async t => {
  const { updater, states, calls } = portable(t, release('v3.1.0'));
  await updater.check();
  assert.deepEqual(states.map(s => s.state), ['checking', 'latest']);
  assert.equal(calls.length, 1);
});

test('GitHub injoignable : signalé, puis nouvel essai à la demande', async t => {
  const { updater, states } = portable(t, release('v3.2.0'));
  const fetch = updater.fetch;
  updater.fetch = async () => { throw new TypeError('fetch failed'); };
  await updater.check();
  assert.deepEqual(states.map(s => s.state), ['checking', 'unreachable']);
  updater.fetch = fetch;
  await updater.check();
  assert.deepEqual(updater.status, { state: 'ready', version: '3.2.0' });
});

test('exe portable : télécharge la nouvelle version à côté de l’ancienne', async t => {
  const { dir, target, updater, states } = portable(t, release('v3.2.0'));
  await updater.check();
  const dest = path.join(dir, 'Minuit-au-Manoir-3.2.0.exe');
  assert.deepEqual(updater.status, { state: 'ready', version: '3.2.0' });
  assert.deepEqual(fs.readFileSync(dest), EXE);
  assert.ok(!fs.existsSync(dest + '.part'));
  assert.equal(updater.launch, dest);
  assert.deepEqual(updater.pending, { remove: target });
  const progress = states.filter(s => s.state === 'downloading').map(s => s.progress);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => i === 0 || p > progress[i - 1]));
});

test('fichier abîmé : échec, rien ne reste', async t => {
  const { dir, updater } = portable(t, release('v3.2.0', EXE, 'sha256:' + '0'.repeat(64)));
  await updater.check();
  assert.deepEqual(updater.status, { state: 'failed', version: '3.2.0' });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Minuit-au-Manoir-3.1.0.exe']);
});

test('téléchargement coupé : échec', async t => {
  const { dir, updater } = portable(t, release('v3.2.0'), { body: EXE.subarray(0, 1000) });
  await updater.check();
  assert.equal(updater.status.state, 'failed');
  assert.ok(!fs.existsSync(path.join(dir, 'Minuit-au-Manoir-3.2.0.exe')));
});

test('déjà téléchargée lors d’un lancement précédent : prête tout de suite', async t => {
  const { dir, updater, calls } = portable(t, release('v3.2.0'));
  fs.writeFileSync(path.join(dir, 'Minuit-au-Manoir-3.2.0.exe'), EXE);
  await updater.check();
  assert.equal(updater.status.state, 'ready');
  assert.equal(calls.length, 1);
});

test('lancé depuis les sources : renvoie vers la page de la release', async t => {
  const { updater, calls } = portable(t, release('v3.2.0'), { kind: null });
  await updater.check();
  assert.deepEqual(updater.status, { state: 'manual', version: '3.2.0' });
  assert.equal(updater.page, 'https://github.com/TheProdigy27/Minuit-au-Manoir/releases/tag/v3.2.0');
  assert.equal(calls.length, 1);
});

test('jeu dézippé : la nouvelle version se recopie à la place de l’ancienne', t => {
  const dir = tmpDir(t);
  const from = path.join(dir, 'tmp', 'jeu', 'Minuit au Manoir');
  const to = path.join(dir, 'Minuit au Manoir');
  for (const [file, text] of [[path.join(from, 'Minuit au Manoir.exe'), 'nouveau'], [path.join(from, 'resources', 'app.asar'), 'nouveau'],
    [path.join(to, 'Minuit au Manoir.exe'), 'ancien'], [path.join(to, 'resources', 'app.asar'), 'ancien'], [path.join(to, 'vieux.dll'), 'ancien']]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const pendingFile = path.join(dir, 'maj.json');
  const pending = { install: { from, to }, remove: path.join(dir, 'tmp') };
  // Ailleurs que dans le dossier temporaire, ce n'est pas à lui de le faire
  assert.equal(install(pendingFile, pending, path.join(to, 'Minuit au Manoir.exe')), null);
  assert.equal(install(pendingFile, pending, path.join(from, 'Minuit au Manoir.exe')), path.join(to, 'Minuit au Manoir.exe'));
  assert.equal(fs.readFileSync(path.join(to, 'Minuit au Manoir.exe'), 'utf8'), 'nouveau');
  assert.equal(fs.readFileSync(path.join(to, 'resources', 'app.asar'), 'utf8'), 'nouveau');
  assert.ok(fs.existsSync(path.join(to, 'vieux.dll')));
  assert.deepEqual(readPending(pendingFile), { remove: path.join(dir, 'tmp') });
});

test('au lancement suivant : efface l’ancienne version, jamais celle qui tourne', async t => {
  const dir = tmpDir(t);
  const old = path.join(dir, 'tmp');
  fs.mkdirSync(path.join(old, 'jeu'), { recursive: true });
  fs.writeFileSync(path.join(old, 'jeu', 'a.exe'), '');
  const pendingFile = path.join(dir, 'maj.json');
  fs.writeFileSync(pendingFile, JSON.stringify({ remove: old }));
  await cleanUp(pendingFile, readPending(pendingFile), [path.join(old, 'jeu', 'a.exe')]);
  assert.ok(fs.existsSync(old));
  await cleanUp(pendingFile, readPending(pendingFile), [path.join(dir, 'Minuit au Manoir', 'a.exe'), undefined]);
  assert.ok(!fs.existsSync(old));
  assert.ok(!fs.existsSync(pendingFile));
});
