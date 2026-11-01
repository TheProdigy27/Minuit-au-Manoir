// Clavier + souris. Pendant la partie, la souris est capturée : elle sert à regarder autour de soi.
// `event.code` désigne la position physique des touches : ZQSD en AZERTY = WASD en QWERTY.
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'KeyF', 'ShiftLeft', 'ShiftRight', 'Tab']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.flags = { click: false, light: false };
    this.wantLock = false; // la partie a besoin de la souris (joueur dans le manoir)
    this.onUnlock = null;

    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (GAME_KEYS.has(e.code) && this.active) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    });
    el.addEventListener('mousedown', e => {
      // Le premier clic capture la souris, sans compter comme une action.
      if (this.active && this.wantLock && !this.locked) { this.lock(); return; }
      if (e.button === 2) this.flags.light = true; else this.flags.click = true;
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

  state() {
    const k = this.keys;
    const axis = (plus, minus) => Math.max(-1, Math.min(1, plus.filter(c => k.has(c)).length - minus.filter(c => k.has(c)).length));
    const look = { x: this.look.x, y: this.look.y };
    return {
      fwd: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      side: axis(['KeyD'], ['KeyA']),
      turn: axis(['ArrowRight'], ['ArrowLeft']),
      look,
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
      act: k.has('KeyE') || k.has('Space'),
      actPressed: this.pressed.has('KeyE') || this.pressed.has('Space'),
      toggleLight: this.pressed.has('KeyF') || this.flags.light,
      next: this.flags.click,
      plan: k.has('Tab'),
    };
  }

  endFrame() {
    this.pressed.clear();
    this.flags.click = this.flags.light = false;
    this.look.x = this.look.y = 0;
  }
}
