// Les sons sont synthétisés en direct (Web Audio), sauf la musique des menus et ceux de SAMPLES.
const MELODY = [12, 15, 19, 24, 23, 19, 15, 14, 12, 15, 19, 17, 15, 14, 11, 7, 8, 12, 15, 20, 19, 15, 12, 11, 12, null, 7, null, 12, null, null, null];
const MUSIC_URL = 'audio/menu.mp3';
const SAMPLES = { scream: 'audio/scream.mp3' };
const MUSIC_VOLUME = 0.7;
const MUSIC_FADE = 1.5; // secondes
const SCREAM_DRIVE = 2.5; // saturation du cri du jumpscare : ~5 dB de plus en volume perçu
const SCREAM_DUCK = 0.25; // le reste du mix baisse de 12 dB pendant ce cri
const VOICE_GAIN = 1.3; // voix des autres joueurs (chat vocal), à volume 100 %
// Fréquence au-dessus de laquelle les sons du manoir s'étouffent, caché·e dans chaque sorte de meuble
const MUFFLE = { wardrobe: 1400, cabinet: 1400, coffin: 900, bed: 5000 };

export class Sound {
  constructor() {
    this.ctx = null;
    this.loops = [];
    this.growls = [];
    this.tension = null;
    this.inGame = false;
    this.nextBeat = 0;
    this.ambT = 6;
    this.track = null;
    this.musicOn = false;
    this.musicStop = null;
    this.volume = { music: 1, sfx: 1, voice: 1 };
    this.samples = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return; }
    const c = (this.ctx = new AudioContext());
    this.master = c.createGain();
    this.duck = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    // Caché·e dans un meuble, le manoir s'entend étouffé
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.master.connect(this.muffle).connect(this.duck).connect(comp).connect(c.destination);
    // La musique des menus passe à côté du compresseur et de la réverbération.
    this.musicOut = c.createGain();
    this.musicOut.connect(c.destination);
    // Le cri du jumpscare aussi, saturé pour passer au-dessus de tout le reste.
    this.scareIn = c.createWaveShaper();
    this.scareIn.curve = this.saturation(SCREAM_DRIVE);
    this.scareIn.oversample = '4x';
    this.scareOut = c.createGain();
    this.scareIn.connect(this.scareOut).connect(c.destination);
    // Les voix du chat vocal (voice.js) ont leur propre volume, mais baissent aussi pendant le cri.
    this.voiceOut = c.createGain();
    this.voiceOut.connect(this.duck);
    this.applyVolume();
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(3.2, 2.4);
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.verb.connect(wet).connect(this.master);
    this.bus = c.createGain();
    this.bus.connect(this.master);
    const send = c.createGain();
    send.gain.value = 0.55;
    this.bus.connect(send).connect(this.verb);
    this.noise = this.noiseBuffer(3);
    this.curve = this.distortion(40);
    // Sons enregistrés, décodés d'avance pour partir sans délai
    for (const [name, url] of Object.entries(SAMPLES)) {
      fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(b => c.decodeAudioData(b))
        .then(buf => { this.samples[name] = buf; }).catch(() => {});
    }
  }

  // Volumes du menu Options (0 à 1), mis au carré pour suivre la perception de l'oreille.
  setVolume(kind, v) {
    this.volume[kind] = v;
    if (this.ctx) this.applyVolume();
  }

  applyVolume() {
    this.master.gain.setTargetAtTime(0.9 * this.volume.sfx ** 2, this.t, 0.03);
    this.musicOut.gain.setTargetAtTime(this.volume.music ** 2, this.t, 0.03);
    this.scareOut.gain.setTargetAtTime(this.volume.sfx ** 2, this.t, 0.03);
    this.voiceOut.gain.setTargetAtTime(VOICE_GAIN * this.volume.voice ** 2, this.t, 0.03);
  }

  get t() { return this.ctx.currentTime; }

  noiseBuffer(sec) {
    const c = this.ctx, b = c.createBuffer(1, sec * c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Réverbération de grande maison vide : bruit qui décroît.
  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(sec * c.sampleRate), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  distortion(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Écrêtage doux (tanh) : son plus dense donc plus fort, pics toujours sous 0 dB.
  saturation(drive) {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(drive * ((i * 2) / (n - 1) - 1)) / Math.tanh(drive);
    return curve;
  }

  out(pan = 0, vol = 1, dest = this.bus) {
    const c = this.ctx, g = c.createGain();
    g.gain.value = vol;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(dest);
    } else g.connect(dest);
    return g;
  }

  env(param, t, attack, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(type, f0, f1, t, dur, peak, dest, attack = 0.005) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
    this.env(g.gain, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  hiss(t, dur, peak, dest, type = 'lowpass', f0 = 800, f1 = f0, q = 0.7, attack = 0.005) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    s.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
    this.env(g.gain, t, attack, peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 2);
    s.stop(t + attack + dur + 0.05);
    return g;
  }

  // --- Ambiance de partie ---
  startGame() {
    if (!this.ctx) return;
    this.stopGame();
    this.music(false);
    this.inGame = true;
    const c = this.ctx, t = this.t;
    const keep = n => { this.loops.push(n); return n; };

    // bourdon grave
    const drone = c.createGain();
    drone.gain.setValueAtTime(0, t);
    drone.gain.linearRampToValueAtTime(0.07, t + 4);
    drone.connect(this.master);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.connect(drone);
    for (const f of [41.2, 41.5, 61.7]) {
      const o = keep(c.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const lfo = keep(c.createOscillator());
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 70;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    // vent dans les fenêtres
    const wind = keep(c.createBufferSource());
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const wg = c.createGain();
    wg.gain.value = 0.045;
    wind.connect(bp).connect(wg).connect(this.bus);
    wind.start();
    const lfo2 = keep(c.createOscillator());
    lfo2.frequency.value = 0.11;
    const l2g = c.createGain();
    l2g.gain.value = 300;
    lfo2.connect(l2g).connect(bp.frequency);
    lfo2.start();

    // dissonance aiguë qui monte quand la créature approche
    this.tension = c.createGain();
    this.tension.gain.value = 0;
    this.tension.connect(this.bus);
    for (const f of [622, 659, 698]) {
      const o = keep(c.createOscillator());
      o.frequency.value = f;
      o.connect(this.tension);
      o.start();
    }
  }

  stopGame() {
    for (const n of this.loops) try { n.stop(); } catch {}
    for (const g of this.growls) for (const n of [g.osc, g.src, g.lfo]) try { n.stop(); } catch {}
    this.loops = [];
    this.growls = [];
    this.tension = null;
    this.inGame = false;
    if (this.muffle) this.muffle.frequency.setTargetAtTime(20000, this.t, 0.05);
  }

  // Grondement continu d'une créature (volume et stéréo selon sa position)
  growl(i) {
    if (this.growls[i]) return this.growls[i];
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 44;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const nf = c.createGain();
    nf.gain.value = 0.4;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 4;
    const ws = c.createWaveShaper();
    ws.curve = this.curve;
    const breath = c.createGain();
    breath.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.35 + Math.random() * 0.2;
    const lg = c.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(breath.gain);
    const gain = c.createGain();
    gain.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    osc.connect(filter);
    src.connect(nf).connect(filter);
    filter.connect(ws).connect(breath).connect(gain);
    if (pan) gain.connect(pan).connect(this.bus); else gain.connect(this.bus);
    osc.start();
    src.start();
    lfo.start();
    return (this.growls[i] = { osc, src, lfo, filter, gain, pan });
  }

  // Appelé à chaque image : cœur qui bat, grondements, bruits d'ambiance aléatoires.
  update(dt, s) {
    if (!this.ctx || !this.inGame) return;
    const t = this.t;
    if (s.fear > 0.06 && t >= this.nextBeat) {
      const vol = 0.2 + s.fear * 0.8;
      this.thump(t + 0.02, vol);
      this.thump(t + 0.2, vol * 0.65);
      this.nextBeat = t + 60 / (55 + s.fear * 105);
    }
    if (this.tension) this.tension.gain.setTargetAtTime(Math.max(0, s.fear - 0.3) * 0.05, t, 0.4);
    this.muffle.frequency.setTargetAtTime(MUFFLE[s.muffle] ?? 20000, t, 0.15);
    s.monsters.forEach((m, i) => {
      const g = this.growl(i);
      g.gain.gain.setTargetAtTime(m.vol, t, 0.2);
      if (g.pan) g.pan.pan.setTargetAtTime(m.pan, t, 0.1);
      g.filter.frequency.setTargetAtTime(m.chase ? 900 : 380, t, 0.3);
      g.osc.frequency.setTargetAtTime(m.chase ? 58 : 42, t, 0.5);
    });
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 7 + Math.random() * 14;
      const pan = Math.random() * 2 - 1, r = Math.random();
      if (s.ghost || r < 0.3) this.whisper(pan, 0.1 + Math.random() * 0.1);
      else if (r < 0.65) this.creak(pan);
      else if (r < 0.85) this.knock();
      else this.musicBoxFar();
    }
  }

  // --- Musique des menus : audio/menu.mp3 en boucle, avec fondu ---
  music(on) {
    if (!this.ctx) return;
    this.musicOn = on;
    if (!this.track) {
      if (!on) return;
      this.track = new Audio();
      this.track.loop = true;
      this.trackGain = this.ctx.createGain();
      this.trackGain.gain.value = 0;
      this.ctx.createMediaElementSource(this.track).connect(this.trackGain).connect(this.musicOut);
      // Chargée en entier dans un blob : le protocole app:// ne sait pas servir un média en flux.
      fetch(MUSIC_URL).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => {
        this.track.src = URL.createObjectURL(b);
        if (this.musicOn) this.track.play().catch(() => {});
      }).catch(() => {});
    }
    clearTimeout(this.musicStop);
    const g = this.trackGain.gain, t = this.t;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? MUSIC_VOLUME : 0, t + MUSIC_FADE);
    if (!on) this.musicStop = setTimeout(() => { this.track.pause(); this.track.currentTime = 0; }, MUSIC_FADE * 1000);
    else if (this.track.src && this.track.paused) this.track.play().catch(() => {});
  }

  // --- Boîte à musique du salon ---
  bell(f, t, vol, dest = this.bus) {
    const o = this.out(0, vol, dest);
    this.tone('sine', f, f, t, 1.6, 0.6, o, 0.004);
    this.tone('sine', f * 2.01, f * 2.01, t, 0.7, 0.2, o, 0.004);
    this.tone('sine', f * 3.02, f * 3.02, t, 0.3, 0.08, o, 0.004);
  }

  musicBoxFar() {
    const c = this.ctx, t = this.t;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(this.out(Math.random() * 2 - 1, 0.5));
    const start = Math.floor(Math.random() * 8) * 4;
    for (let i = 0; i < 6; i++) {
      const n = MELODY[(start + i) % MELODY.length];
      if (n !== null) this.bell(220 * Math.pow(2, n / 12) * 0.997, t + i * 0.55, 0.06, lp);
    }
  }

  // --- Effets ponctuels ---
  thump(t, vol) { this.tone('sine', 75, 38, t, 0.16, 1, this.out(0, vol, this.master), 0.01); }

  footstep(vol = 0.3, pan = 0) {
    if (!this.ctx) return;
    const t = this.t, o = this.out(pan, vol);
    this.hiss(t, 0.08, 0.6, o, 'lowpass', 400 + Math.random() * 500);
    this.tone('sine', 110, 50, t, 0.07, 0.5, o);
  }

  click() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.25);
    this.tone('square', 2400, 1800, t, 0.015, 0.5, o);
    this.tone('square', 1400, 900, t + 0.04, 0.02, 0.4, o);
  }

  // Survol d'un bouton des menus : un coup sourd et un frottement, à peine audibles
  hover() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.12);
    this.tone('sine', 150, 85, t, 0.09, 0.6, o, 0.004);
    this.hiss(t, 0.07, 0.2, o, 'bandpass', 1600, 700, 1.2);
  }

  tick(high) {
    if (!this.ctx) return;
    this.tone('sine', high ? 1100 : 660, high ? 1100 : 600, this.t, 0.12, 0.5, this.out(0, 0.4));
  }

  battery() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.3);
    this.tone('square', 1800, 1200, t, 0.02, 0.4, o);
    this.tone('sine', 700, 1500, t + 0.05, 0.18, 0.5, o);
  }

  skull() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.5);
    for (const f of [220, 233.1, 329.6, 466.2]) this.tone('sine', f, f * 0.98, t, 3.2, 0.25, o, 0.25);
    this.hiss(t, 0.7, 0.3, o, 'highpass', 3000, 8000, 0.7, 0.6);
  }

  roar(pan = 0, vol = 0.6) {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, o = this.out(pan, vol);
    const ws = c.createWaveShaper();
    ws.curve = this.curve;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    ws.connect(lp).connect(o);
    const os = c.createOscillator();
    os.type = 'sawtooth';
    os.frequency.setValueAtTime(48, t);
    os.frequency.linearRampToValueAtTime(82, t + 0.6);
    os.frequency.linearRampToValueAtTime(40, t + 2);
    const g = c.createGain();
    this.env(g.gain, t, 0.25, 0.9, 1.8);
    os.connect(g).connect(ws);
    os.start(t);
    os.stop(t + 2.2);
    this.hiss(t, 1.8, 0.5, ws, 'bandpass', 300, 150, 1.5, 0.3);
  }

  screech(pan = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2;
    bp.connect(this.out(pan, 0.45));
    for (const f of [1300, 1390, 1550]) this.tone('sawtooth', f, f * 0.3, t, 0.9, 0.4, bp, 0.02);
  }

  spotted() {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.connect(this.out(0, 0.35));
    for (const f of [880, 932, 988, 1046]) this.tone('sawtooth', f, f * 1.02, t, 0.35, 0.3, bp, 0.005);
  }

  // Joueur attrapé par la créature (audio/scream.mp3)
  scream(pan = 0, vol = 0.35) {
    const buf = this.samples.scream;
    if (!this.ctx || !buf) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.out(pan, vol));
    s.start();
  }

  // Jumpscare quand c'est soi qui est attrapé : cri saturé, le reste du jeu s'efface le temps du cri.
  jumpscare() {
    const buf = this.samples.scream;
    if (!this.ctx || !buf) return;
    const t = this.t, s = this.ctx.createBufferSource(), d = this.duck.gain;
    s.buffer = buf;
    s.connect(this.scareIn);
    s.start(t);
    d.cancelScheduledValues(t);
    d.setValueAtTime(d.value, t);
    d.setTargetAtTime(SCREAM_DUCK, t, 0.015);
    d.setTargetAtTime(1, t + buf.duration * 0.5, 0.8);
  }

  thunder() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 1);
    this.hiss(t, 0.3, 0.5, o, 'highpass', 1500);
    this.hiss(t, 4, 0.9, o, 'lowpass', 900, 90, 0.7, 0.08);
  }

  gong() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.6);
    for (const [f, d] of [[73, 7], [119, 6], [171, 5], [233, 4], [311, 3.5]]) this.tone('sine', f, f * 0.995, t, d, 0.3, o, 0.01);
    this.hiss(t, 2, 0.2, o, 'lowpass', 400, 80);
  }

  revive() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.35);
    [523, 659, 784, 1046].forEach((f, i) => this.tone('sine', f, f, t + i * 0.08, 0.6, 0.4, o, 0.01));
  }

  death() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.6);
    for (const f of [55, 82.4, 110.5]) this.tone('sine', f, f * 0.97, t, 5, 0.35, o, 0.4);
    this.bell(146.8, t + 0.3, 0.3);
  }

  escape() {
    if (!this.ctx) return;
    const t = this.t, o = this.out(0, 0.4);
    for (const f of [261.6, 329.6, 392, 523.3]) this.tone('sine', f, f, t, 3, 0.25, o, 0.5);
  }

  whisper(pan = 0, vol = 0.25) {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 1200;
    bp.Q.value = 4;
    g.gain.value = 0;
    bp.connect(g).connect(this.out(pan, vol));
    let tt = t;
    const syllables = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < syllables; i++) {
      const d = 0.06 + Math.random() * 0.14;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.6 + Math.random() * 0.4, tt + d * 0.3);
      g.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + Math.random() * 0.06;
    }
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.connect(bp);
    s.start(t, Math.random());
    s.stop(tt + 0.1);
  }

  creak(pan = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600 + Math.random() * 500;
    bp.Q.value = 12;
    bp.connect(this.out(pan, 0.12));
    const dur = 0.6 + Math.random() * 0.8;
    const os = c.createOscillator();
    os.type = 'sawtooth';
    os.frequency.setValueCurveAtTime(new Float32Array(16).map(() => 70 + Math.random() * 90), t, dur);
    const g = c.createGain();
    this.env(g.gain, t, 0.05, 1, dur);
    os.connect(g).connect(bp);
    os.start(t);
    os.stop(t + dur + 0.1);
  }

  // Se glisser dans une cachette ou en sortir : la porte de l'armoire qui grince puis se referme, le
  // frottement des draps sous un lit, le couvercle d'un cercueil qui racle.
  hide(kind, pan = 0, vol = 1) {
    const c = this.ctx;
    if (!c) return;
    const t = this.t, o = this.out(pan, vol);
    if (kind === 'bed') {
      this.hiss(t, 0.35, 0.22, o, 'bandpass', 1800, 900, 0.8, 0.08);
      this.hiss(t + 0.3, 0.3, 0.15, o, 'bandpass', 1400, 700, 0.8, 0.06);
      this.tone('sine', 90, 50, t + 0.25, 0.12, 0.3, o);
      return;
    }
    if (kind === 'coffin') {
      this.hiss(t, 0.7, 0.35, o, 'bandpass', 380, 240, 3, 0.05);
      this.tone('sine', 70, 40, t + 0.72, 0.2, 0.7, o, 0.01);
      return;
    }
    // la porte : un grincement court, puis le loquet
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 300;
    bp.Q.value = 10;
    bp.connect(o);
    const os = c.createOscillator(), g = c.createGain(), dur = 0.45;
    os.type = 'sawtooth';
    os.frequency.setValueCurveAtTime(new Float32Array(10).map((_, i) => 90 + 50 * Math.sin(i * 1.3) + Math.random() * 30), t, dur);
    this.env(g.gain, t, 0.04, 0.5, dur);
    os.connect(g).connect(bp);
    os.start(t);
    os.stop(t + dur + 0.1);
    this.tone('square', 1600, 900, t + dur + 0.05, 0.02, 0.15, o);
    this.tone('sine', 120, 60, t + dur + 0.05, 0.08, 0.5, o);
  }

  knock() {
    if (!this.ctx) return;
    const t = this.t, o = this.out((Math.random() * 2 - 1) * 0.8, 0.3);
    for (let i = 0; i < 3; i++) this.tone('sine', 140, 60, t + i * 0.28, 0.1, 0.8, o);
  }

  ping(pan = 0) {
    if (!this.ctx) return;
    const t = this.t, o = this.out(pan, 0.25);
    this.tone('sine', 660, 640, t, 1.5, 0.3, o, 0.3);
    this.tone('sine', 664, 650, t, 1.5, 0.3, o, 0.3);
    this.whisper(pan, 0.15);
  }
}
