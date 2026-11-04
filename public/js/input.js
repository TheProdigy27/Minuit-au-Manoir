// Clavier + souris. Pendant la partie, la souris est capturée : elle sert à regarder autour de soi.
// `event.code` désigne la position physique des touches : ZQSD en AZERTY = WASD en QWERTY.
// Les boutons de la souris s'écrivent Mouse1 (molette), Mouse2 (droit), Mouse3 et Mouse4 (côtés) ;
// le clic gauche, lui, reste réservé (capturer la souris, changer de joueur suivi).

// Actions qu'on peut attribuer à des touches (deux au plus chacune), avec celles par défaut.
export const ACTIONS = [
  { id: 'fwd', label: 'Avancer', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Reculer', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Pas à gauche', keys: ['KeyA', ''] },
  { id: 'right', label: 'Pas à droite', keys: ['KeyD', ''] },
  { id: 'turnL', label: 'Tourner à gauche', keys: ['ArrowLeft', ''] },
  { id: 'turnR', label: 'Tourner à droite', keys: ['ArrowRight', ''] },
  { id: 'run', label: 'Courir', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'light', label: 'Lampe', keys: ['KeyF', 'Mouse2'] }, // allumer, éteindre
  { id: 'act', label: 'Action', keys: ['KeyE', 'Space'] }, // relever, se cacher, laisser un signe
  { id: 'plan', label: 'Plan du manoir', keys: ['Tab', ''] },
  { id: 'talk', label: 'Parler', keys: ['KeyV', ''] }, // en mode « appuyer pour parler »
];
const DEFAULTS = Object.fromEntries(ACTIONS.map(a => [a.id, a.keys]));
// Échap ouvre le menu, F11 change l'affichage (l'application l'intercepte) : on ne peut pas les attribuer.
export const RESERVED = new Set(['Escape', 'F11', 'MetaLeft', 'MetaRight']);

// Noms des touches qui n'écrivent pas de caractère ; `short` : version courte pour les indications à l'écran.
const NAMES = {
  Space: 'Espace', Tab: 'Tab', Enter: 'Entrée', NumpadEnter: 'Entrée (pavé)', Backspace: 'Retour arrière',
  ShiftLeft: ['Maj gauche', 'Maj'], ShiftRight: ['Maj droite', 'Maj'], ControlLeft: ['Ctrl gauche', 'Ctrl'],
  ControlRight: ['Ctrl droite', 'Ctrl'], AltLeft: 'Alt', AltRight: 'Alt Gr', CapsLock: 'Verr. maj',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Inser', Delete: 'Suppr',
  Home: 'Début', End: 'Fin', PageUp: 'Page préc.', PageDown: 'Page suiv.', ContextMenu: 'Menu',
  NumpadAdd: 'Pavé +', NumpadSubtract: 'Pavé −', NumpadMultiply: 'Pavé ×', NumpadDivide: 'Pavé /', NumpadDecimal: 'Pavé .',
  Mouse1: ['Clic molette', 'clic molette'], Mouse2: ['Clic droit', 'clic droit'], Mouse3: ['Souris 4', 'souris 4'], Mouse4: ['Souris 5', 'souris 5'],
};

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.flags = { click: false };
    this.wantLock = false; // la partie a besoin de la souris (joueur dans le manoir)
    this.onUnlock = null;
    this.binds = structuredClone(DEFAULTS);
    // Ce qu'écrit chaque touche avec la disposition du clavier (AZERTY : KeyW → « Z »), pour les afficher
    this.layout = new Map();
    this.onLayout = null;
    this.readLayout();

    addEventListener('keydown', e => {
      this.learn(e);
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      // pas de défilement (Espace, flèches) ni de changement de bouton (Tab) pendant la partie
      if (this.active && (this.bound(e.code) || e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    });
    // Les boutons de la souris comptent partout (« parler » sur un bouton de côté marche aussi au salon),
    // le clic gauche seulement dans la vue du jeu.
    addEventListener('mousedown', e => {
      // Le premier clic capture la souris, sans compter comme une action.
      if (e.target === el && this.active && this.wantLock && !this.locked) { this.lock(); return; }
      if (e.button === 0) {
        if (e.target === el) this.flags.click = true;
        return;
      }
      const code = 'Mouse' + e.button;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      if (this.active && e.button === 1) e.preventDefault(); // pas de défilement automatique à la molette
    });
    addEventListener('mouseup', e => {
      this.keys.delete('Mouse' + e.button);
      if (e.button === 3 || e.button === 4) e.preventDefault(); // pas de « page précédente »
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) { this.keys.clear(); this.onUnlock?.(); }
    });
  }

  get locked() {
    return document.pointerLockElement === this.el;
  }

  lock() {
    if (this.locked) return;
    try {
      const r = this.el.requestPointerLock();
      if (r?.catch) r.catch(() => {}); // refusé (ex. juste après Échap) : un clic suffira
    } catch {}
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  // --- Touches attribuées ---

  // Touches gardées (JSON) : celles qui manquent ou ne sont pas valables reprennent leur valeur par défaut.
  load(saved) {
    this.binds = structuredClone(DEFAULTS);
    let data = null;
    try { data = JSON.parse(saved); } catch {}
    if (!data || typeof data !== 'object') return;
    const used = new Set();
    for (const { id } of ACTIONS) {
      const keys = data[id];
      if (!Array.isArray(keys)) continue;
      this.binds[id] = [0, 1].map(i => {
        const k = typeof keys[i] === 'string' && !RESERVED.has(keys[i]) && !used.has(keys[i]) ? keys[i] : '';
        if (k) used.add(k);
        return k;
      });
    }
    // Une touche par défaut déjà prise par une action gardée ne compte pas deux fois
    for (const { id } of ACTIONS) {
      if (Array.isArray(data[id])) continue;
      this.binds[id] = this.binds[id].map(k => (used.has(k) ? '' : (used.add(k), k)));
    }
  }

  save() {
    return JSON.stringify(this.binds);
  }

  reset() {
    this.binds = structuredClone(DEFAULTS);
  }

  // Attribue une touche (ou '' pour vider la case) ; renvoie l'action à qui on l'a retirée, s'il y en avait une.
  bind(id, slot, code) {
    let taken = null;
    if (code) {
      for (const [other, keys] of Object.entries(this.binds)) {
        const i = keys.indexOf(code);
        if (i < 0 || (other === id && i === slot)) continue;
        keys[i] = '';
        if (other !== id) taken = other;
      }
    }
    this.binds[id][slot] = code;
    return taken;
  }

  bound(code) {
    return !!code && Object.values(this.binds).some(keys => keys.includes(code));
  }

  held(id) {
    return this.binds[id].some(k => k && this.keys.has(k));
  }

  hit(id) {
    return this.binds[id].some(k => k && this.pressed.has(k));
  }

  // --- Noms des touches ---

  async readLayout() {
    try {
      const map = await navigator.keyboard?.getLayoutMap();
      if (!map) return;
      for (const [code, key] of map) this.layout.set(code, key);
      this.onLayout?.();
    } catch {}
  }

  // Sans la disposition du clavier, ce qu'écrivent les touches qu'on presse (sans Maj ni Alt Gr).
  learn(e) {
    if (e.key.length !== 1 || e.key === ' ' || e.shiftKey || e.ctrlKey || e.altKey || e.getModifierState?.('AltGraph')) return;
    if (this.layout.get(e.code) === e.key) return;
    this.layout.set(e.code, e.key);
    this.onLayout?.();
  }

  name(code, short = false) {
    if (!code) return '';
    const n = NAMES[code];
    if (n) return Array.isArray(n) ? n[short ? 1 : 0] : n;
    if (/^Digit\d$/.test(code)) return code.slice(5); // pas le « & » de la touche 1 en AZERTY
    if (/^Numpad\d$/.test(code)) return 'Pavé ' + code.slice(6);
    if (/^F\d+$/.test(code)) return code;
    const key = this.layout.get(code);
    if (key) return key.toUpperCase();
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    return code;
  }

  // La première touche d'une action, pour les indications à l'écran (« ? » si elle n'en a aucune)
  key(id) {
    const code = this.binds[id].find(Boolean);
    return code ? this.name(code, true) : '?';
  }

  // Les noms courts des touches d'une action, sans doublon : ['E', 'Espace'] ; Maj gauche et droite : ['Maj']
  names(id) {
    return [...new Set(this.binds[id].filter(Boolean).map(k => this.name(k, true)))];
  }

  // Les quatre touches de déplacement : « ZQSD », ou « ↑/Q/S/D » si l'une n'est pas une lettre (ni un chiffre)
  moveKeys() {
    const k = ['fwd', 'left', 'back', 'right'].map(id => this.key(id));
    return k.every(s => /^[\p{L}\d]$/u.test(s)) ? k.join('') : k.join('/');
  }

  state() {
    const look = { x: this.look.x, y: this.look.y };
    const axis = (plus, minus) => (this.held(plus) ? 1 : 0) - (this.held(minus) ? 1 : 0);
    return {
      fwd: axis('fwd', 'back'),
      side: axis('right', 'left'),
      turn: axis('turnR', 'turnL'),
      look,
      run: this.held('run'),
      act: this.held('act'),
      actPressed: this.hit('act'),
      toggleLight: this.hit('light'),
      next: this.flags.click,
      plan: this.held('plan'),
    };
  }

  endFrame() {
    this.pressed.clear();
    this.flags.click = false;
    this.look.x = this.look.y = 0;
  }
}
