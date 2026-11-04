// Qualité graphique (options, Graphismes) : préréglages, réglages détaillés, sauvegarde, limite d'images.
// Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../public/js/quality.js';

const BIG = { msaa: 8, aniso: 16 };

test('par défaut : qualité automatique (valeurs de « Haute »), 60 images par seconde', () => {
  const s = Q.parse(null);
  assert.deepEqual(s, { preset: 'auto', fps: 60 });
  assert.deepEqual(Q.resolve(s, BIG), Q.PRESETS.high);
});

test('sauvegarde abîmée ou inconnue : on retombe sur les valeurs par défaut', () => {
  assert.deepEqual(Q.parse('{pas du json'), Q.DEFAULT);
  assert.deepEqual(Q.parse('"high"'), Q.DEFAULT);
  assert.deepEqual(Q.parse('{"preset":"extreme","fps":144}'), Q.DEFAULT);
  // réglage personnalisé aux valeurs farfelues : ramenées aux valeurs proposées
  const s = Q.parse('{"preset":"custom","fps":30,"scale":3,"msaa":5,"shadows":-1,"lights":100,"beam":"x"}');
  assert.equal(s.fps, 30);
  assert.equal(s.scale, 1);
  assert.equal(s.msaa, 4);
  assert.equal(s.shadows, 0);
  assert.equal(s.lights, 12);
  assert.equal(s.beam, Q.PRESETS.high.beam);
});

test('un préréglage se sauvegarde seul ; un réglage personnalisé avec ses valeurs', () => {
  assert.deepEqual(JSON.parse(Q.serialize({ preset: 'low', fps: 0 })), { preset: 'low', fps: 0 });
  const custom = Q.change({ preset: 'high', fps: 60 }, 'msaa', 0, BIG);
  assert.equal(custom.preset, 'custom');
  assert.deepEqual(Q.parse(Q.serialize(custom)), custom);
});

test('changer un détail : « Personnalisée », ou le préréglage qui a ces valeurs', () => {
  let s = Q.change({ preset: 'high', fps: 60 }, 'shadows', 4096, BIG);
  assert.equal(s.preset, 'custom');
  assert.equal(Q.resolve(s, BIG).shadows, 4096);
  assert.equal(Q.resolve(s, BIG).msaa, 4);
  s = Q.change(s, 'shadows', 2048, BIG);
  assert.deepEqual(s, { preset: 'high', fps: 60 });
  // de « Haute » à « Ultra » détail par détail
  for (const k of Q.KEYS) s = Q.change(s, k, Q.PRESETS.ultra[k], BIG);
  assert.deepEqual(s, { preset: 'ultra', fps: 60 });
});

test('la résolution se règle par pas de 5 %, entre 50 et 100 %', () => {
  const s = Q.change({ preset: 'high', fps: 60 }, 'scale', 0.73, BIG);
  assert.equal(Q.resolve(s, BIG).scale, 0.75);
  assert.equal(Q.resolve(Q.change(s, 'scale', 0.2, BIG), BIG).scale, 0.5);
});

test('limites de la carte graphique : « Ultra » sans 8× ni filtrage, et toujours reconnue', () => {
  const small = { msaa: 4, aniso: 1 };
  const v = Q.resolve({ preset: 'ultra' }, small);
  assert.equal(v.msaa, 4);
  assert.equal(v.aniso, 1);
  // Ultra et Haute ne diffèrent alors que par les ombres et le faisceau : chacune reste reconnue
  assert.equal(Q.matching(v, small), 'ultra');
  assert.equal(Q.matching(Q.resolve({ preset: 'high' }, small), small), 'high');
  // pas de lissage du tout : 0 reste possible
  assert.equal(Q.resolve({ preset: 'high' }, { msaa: 0, aniso: 16 }).msaa, 0);
});

test('choisir un préréglage garde la limite d’images par seconde', () => {
  const s = Q.change({ preset: 'auto', fps: 60 }, 'fps', 30);
  assert.deepEqual(Q.choose(s, 'medium'), { preset: 'medium', fps: 30 });
  assert.deepEqual(Q.change(s, 'fps', 144), s); // valeur non proposée : rien ne change
  assert.equal(Q.choose(s, 'custom'), s);
});

test('limite d’images par seconde : une image sur combien d’appels de l’écran', () => {
  assert.equal(Q.frameSkip(60, 1000 / 60), 1);
  assert.equal(Q.frameSkip(60, 1000 / 144), 2); // 72 images par seconde (comme avant)
  assert.equal(Q.frameSkip(30, 1000 / 60), 2);
  assert.equal(Q.frameSkip(30, 1000 / 144), 4);
  assert.equal(Q.frameSkip(0, 1000 / 144), 1);
  assert.equal(Q.frameSkip(60, 1000 / 50), 1); // écran plus lent que la limite
});
