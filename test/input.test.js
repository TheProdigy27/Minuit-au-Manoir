// Touches qu'on peut changer dans les options : attribution, conflits, sauvegarde, noms affichés.
// Lancer avec `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// La page n'est pas là : juste de quoi construire l'objet Input (les écouteurs ne servent pas ici).
globalThis.addEventListener ??= () => {};
globalThis.document ??= { addEventListener() {}, pointerLockElement: null };
const { Input, ACTIONS } = await import('../public/js/input.js');
const canvas = { addEventListener() {} };

function press(inp, ...codes) {
  inp.keys.clear();
  inp.pressed.clear();
  for (const c of codes) { inp.keys.add(c); inp.pressed.add(c); }
  return inp.state();
}

test('touches par défaut : ZQSD (WASD en position physique), E ou Espace, F ou clic droit', () => {
  const inp = new Input(canvas);
  assert.equal(press(inp, 'KeyW').fwd, 1);
  assert.equal(press(inp, 'ArrowDown').fwd, -1);
  assert.equal(press(inp, 'KeyA').side, -1);
  assert.equal(press(inp, 'ShiftRight').run, true);
  assert.equal(press(inp, 'Space').actPressed, true);
  assert.equal(press(inp, 'Mouse2').toggleLight, true);
  assert.equal(press(inp, 'Tab').plan, true);
  assert.equal(press(inp, 'KeyW', 'KeyS').fwd, 0);
});

test('une touche attribuée ailleurs est retirée de son ancienne action', () => {
  const inp = new Input(canvas);
  assert.equal(inp.bind('light', 1, 'KeyE'), 'act');
  assert.deepEqual(inp.binds.light, ['KeyF', 'KeyE']);
  assert.deepEqual(inp.binds.act, ['', 'Space']);
  const s = press(inp, 'KeyE');
  assert.equal(s.toggleLight, true);
  assert.equal(s.actPressed, false);
  // dans l'autre case de la même action : elle change de case, sans conflit annoncé
  assert.equal(inp.bind('light', 0, 'KeyE'), null);
  assert.deepEqual(inp.binds.light, ['KeyE', '']);
  // vider une case
  inp.bind('fwd', 1, '');
  assert.deepEqual(inp.binds.fwd, ['KeyW', '']);
});

test('un bouton de côté de la souris pour parler', () => {
  const inp = new Input(canvas);
  inp.bind('talk', 1, 'Mouse4');
  inp.keys.add('Mouse4');
  assert.equal(inp.held('talk'), true);
  assert.equal(inp.name('Mouse4'), 'Souris 5');
});

test('touches gardées : relues, et réparées si le fichier est abîmé', () => {
  const inp = new Input(canvas);
  inp.bind('fwd', 0, 'KeyI');
  inp.bind('light', 0, 'KeyE'); // retirée de « Action »
  const saved = inp.save();
  const back = new Input(canvas);
  back.load(saved);
  assert.deepEqual(back.binds, inp.binds);

  // illisible : les touches par défaut
  back.load('{pas du json');
  assert.deepEqual(back.binds, Object.fromEntries(ACTIONS.map(a => [a.id, a.keys])));

  // une ancienne sauvegarde sans « Parler », qui a pris V pour la lampe ; Échap n'est pas attribuable,
  // et une touche ne compte qu'une fois
  back.load(JSON.stringify({ light: ['KeyV', 'Escape'], plan: ['KeyV', 'KeyM'] }));
  assert.deepEqual(back.binds.light, ['KeyV', '']);
  assert.deepEqual(back.binds.plan, ['', 'KeyM']);
  assert.deepEqual(back.binds.talk, ['', '']); // V par défaut, mais déjà prise
  assert.deepEqual(back.binds.act, ['KeyE', 'Space']);
});

test('noms des touches : disposition du clavier, Maj sans doublon, chiffres', () => {
  const inp = new Input(canvas);
  assert.equal(inp.moveKeys(), 'WASD'); // disposition inconnue
  for (const [code, key] of [['KeyW', 'z'], ['KeyA', 'q'], ['KeyQ', 'a'], ['Digit1', '&']]) inp.learn({ code, key, shiftKey: false, ctrlKey: false, altKey: false });
  inp.learn({ code: 'KeyS', key: 'S', shiftKey: true, ctrlKey: false, altKey: false }); // Maj enfoncée : ignorée
  assert.equal(inp.moveKeys(), 'ZQSD');
  assert.equal(inp.name('KeyQ'), 'A');
  assert.equal(inp.name('Digit1'), '1');
  assert.deepEqual(inp.names('run'), ['Maj']);
  assert.equal(inp.name('ShiftLeft'), 'Maj gauche');
  assert.deepEqual(inp.names('light'), ['F', 'clic droit']);
  inp.bind('fwd', 0, 'ArrowUp');
  assert.equal(inp.moveKeys(), '↑/Q/S/D');
  inp.bind('plan', 0, '');
  assert.equal(inp.key('plan'), '?');
});
