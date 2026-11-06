// Chat vocal de proximité. Le micro passe par un AudioWorklet (trames de 40 ms), un encodeur Opus
// (WebCodecs) puis l'application, qui envoie chaque trame à l'hôte par Steam ; l'hôte la relaie à ceux
// qui peuvent l'entendre (server/room.js). Chaque voix reçue est décodée, jouée avec un léger retard
// (contre les irrégularités du réseau), et réglée à chaque image selon d'où elle vient : plus faible de
// loin, étouffée derrière les murs ou à un autre étage, placée autour de la tête. Chaque trame porte
// aussi son niveau : la créature entend les voix, d'autant plus loin qu'on parle fort (server/game.js).
import { CFG, voiceNoise } from '/shared/config.js';
import { floorAt, levelDist, opaqueAt } from '/shared/physics.js';
import { STOREY } from './render.js';

const FRAME = 0.04; // secondes par trame Opus
const BITRATE = 20000; // bits par seconde : une voix claire en ~100 octets par trame
const JITTER = 0.08; // retard de lecture au début de chaque phrase, quand le réseau est régulier…
const MAX_JITTER = 0.24; // …qui grandit jusque-là quand la voix d'un joueur arrive par à-coups
const MIN_LEAD = 0.02; // une trame qui arrive moins de tant avant son tour : le tampon s'est vidé
const MAX_LAG = 0.3; // retard accumulé (en plus du retard voulu) au-delà duquel on saute des trames
const FADE = 0.004; // fondu aux coupures (tampon vide, trames perdues ou sautées) : sans lui, un clic
const HANGOVER = 0.45; // l'activation vocale reste ouverte un instant après la dernière syllabe
const PREROLL = 2; // trames gardées avant l'ouverture, pour ne pas couper la première syllabe
const IDLE = 60; // secondes de silence avant de libérer le décodeur d'un joueur
const SMOOTH = 0.06; // secondes pour suivre les déplacements (évite les sauts de volume)
const SPEECH_DB = -20; // une voix normale, après le réglage automatique du gain : 3/4 de ses trames dessous (mesuré)
const REF_FRAMES = 3000; // trames de parole (deux minutes) : la mémoire de sa voix habituelle
const REF_SEED = 500; // poids d'une voix habituelle retrouvée d'un lancement précédent (20 s de parole)

export const VOICE_MODES = ['open', 'ptt', 'off']; // activation vocale, appuyer pour parler, micro coupé

// Niveau d'une trame en dB (puissance moyenne, 0 dB : le maximum possible)…
function decibels(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / samples.length + 1e-12);
}
// …et sur une échelle de 0 à 1 (de -70 à -10 dB), celle du curseur de seuil.
const level = db => Math.max(0, Math.min(1, (db + 70) / 60));

// Volume selon la distance (en cases, étages compris) : plein jusqu'à `near`, puis décroissance douce
// jusqu'au silence à `range`.
function falloff(d) {
  const { near, range } = CFG.voice;
  if (d >= range) return 0;
  const k = Math.max(0, (d - range * 0.6) / (range * 0.4));
  return (near / Math.max(near, d)) ** 0.7 * (1 - k * k * (3 - 2 * k));
}

// Murs traversés par la ligne droite entre deux points du même étage (0 à 3).
function walls(map, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25);
  let count = 0, inside = false;
  for (let i = 1; i < n; i++) {
    const t = i / n, o = opaqueAt(map, Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t));
    if (o && !inside && ++count >= 3) return count;
    inside = o;
  }
  return count;
}

const MIC_ERRORS = {
  NotAllowedError: 'Windows bloque le micro : Paramètres › Confidentialité › Microphone, autorisez les applications de bureau.',
  NotFoundError: 'Aucun micro trouvé.',
  OverconstrainedError: 'Aucun micro trouvé.',
  NotReadableError: 'Le micro ne répond pas : une autre application le bloque peut-être, ou Windows le refuse (Paramètres › Confidentialité › Microphone).',
};

export class Voice {
  // `send(bytes)` envoie une trame : numéro sur 2 octets, niveau (dB + 100) sur 1, puis la trame Opus.
  constructor(sound, send) {
    this.sound = sound;
    this.send = send;
    this.supported = typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && !!navigator.mediaDevices;
    this.canCapture = true; // non pour les fenêtres de test : elles se partageraient le micro de l'hôte
    this.mode = 'open';
    this.gate = 0.45; // seuil de l'activation vocale, sur l'échelle de level()
    this.device = ''; // micro choisi ('' : celui de Windows)
    this.joined = false; // relié à une partie : la voix part
    this.monitoring = false; // options ouvertes : on montre le niveau du micro
    this.ptt = false; // touche « parler » enfoncée
    this.level = 0;
    this.talking = false; // ce qu'on dit part en ce moment
    this.error = this.supported ? '' : 'Le chat vocal n’est pas disponible sur cet ordinateur.';
    this.onChange = null; // micro ouvert, fermé ou en erreur (pour les options)
    this.capture = null;
    this.starting = false;
    this.aec = false; // le micro ouvert (ou en train de s'ouvrir) a l'annulation d'écho
    this.token = 0;
    this.seq = 0;
    this.ts = 0;
    this.preroll = [];
    this.loudAt = -1;
    this.db = -100; // à quel point la dernière trame encodée est forte (voir loudness)
    this.ref = null; // sa voix habituelle : 3/4 de ses trames de parole sous ce niveau (dB, flux brut)
    this.hist = new Float32Array(101); // poids de ses trames de parole récentes, par dB (de -100 à 0)
    this.histW = 0;
    this.learnt = 0;
    this.onRef = null; // pour garder sa voix habituelle d'un lancement à l'autre
    this.meterBad = 0; // trames où le flux de mesure restait muet alors qu'on parlait
    this.carry = 0; // jusqu'où la créature entend notre voix (en cases), à l'instant `carryAt`
    this.carryAt = 0;
    this.shoutAt = -99; // dernière fois qu'on a crié
    this.speakers = new Map(); // numéro du joueur → sa voix
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      if (this.error && this.supported) this.error = '';
      this.refresh();
      this.onChange?.();
    });
  }

  // --- Réglages ---
  setMode(mode) {
    if (!VOICE_MODES.includes(mode)) return;
    this.mode = mode;
    if (this.supported) this.error = '';
    this.refresh();
  }

  setDevice(id) {
    this.device = id;
    this.seedRef(null); // un autre micro : on réapprend sa voix
    if (this.supported) this.error = '';
    this.stop();
    this.refresh();
  }

  join(on) {
    this.joined = on;
    if (!on) for (const id of [...this.speakers.keys()]) this.drop(id);
    this.refresh();
  }

  monitor(on) {
    this.monitoring = on;
    if (on && this.supported && !this.capture) this.error = ''; // rouvrir les options réessaie le micro
    this.refresh();
  }

  // Le micro reste ouvert tant qu'on est dans une partie (sauf micro coupé) ou que les options le testent.
  // Il se rouvre en entrant dans une partie ou en la quittant, avec ou sans annulation d'écho (voir start).
  refresh() {
    const need = this.supported && this.canCapture && this.mode !== 'off' && (this.joined || this.monitoring);
    if (!need || ((this.capture || this.starting) && this.aec !== this.joined)) this.stop();
    if (need && !this.capture && !this.starting && !this.error) this.start();
  }

  async devices() {
    try {
      return (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(d => ({ id: d.deviceId, label: d.label }));
    } catch {
      return [];
    }
  }

  // --- Capture et envoi ---
  async start() {
    const token = ++this.token, ctx = this.sound.ctx;
    if (!ctx) return;
    this.starting = true;
    // L'annulation d'écho seulement dans une partie (salon compris) : dès qu'un micro l'utilise, Chrome fait
    // passer tout le son de la page par un mélangeur (pour en tirer l'écho à retirer), puis revient en
    // arrière quand il se ferme, et chaque bascule s'entend comme une saccade dans la musique. Pour le
    // niveau montré dans les options de l'écran titre, on s'en passe, comme du flux de mesure (qui ne sert
    // qu'à la voix envoyée).
    const aec = (this.aec = this.joined);
    let stream = null, meter = null;
    try {
      const audio = { echoCancellation: aec, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: this.device ? { ...audio, deviceId: { exact: this.device } } : audio });
      } catch (err) {
        if (!this.device || token !== this.token) throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio }); // micro choisi débranché : celui de Windows
      }
      // Le même micro, brut, rien que pour juger si l'on parle fort : le réglage automatique du gain
      // rehausse peu à peu une voix basse et baisse une voix forte, la créature s'y tromperait. (Chrome
      // ne traite qu'un flux par micro : le second est sans réglage, ni filtre du bruit ou de l'écho.)
      // Faute de quoi on mesure le son réglé, à peu près juste.
      if (aec) try {
        const id = stream.getAudioTracks()[0]?.getSettings().deviceId;
        const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: { exact: false }, channelCount: 1 };
        meter = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...raw, deviceId: { exact: id } } : raw });
      } catch (err) {
        console.warn('micro (mesure) :', err);
      }
      await this.sound.worklet(); // déjà chargé avec le son (audio.js), sauf échec
    } catch (err) {
      for (const s of [stream, meter]) s?.getTracks().forEach(t => t.stop());
      if (token !== this.token) return;
      this.starting = false;
      this.error = MIC_ERRORS[err?.name] || 'Impossible d’ouvrir le micro.';
      console.warn('micro :', err);
      this.onChange?.();
      return;
    }
    if (token !== this.token) { for (const s of [stream, meter]) s?.getTracks().forEach(t => t.stop()); return; }
    const rate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'voice-capture', { numberOfInputs: 2, numberOfOutputs: 0, processorOptions: { size: Math.round(rate * FRAME) } });
    const meterSource = meter && ctx.createMediaStreamSource(meter);
    meterSource?.connect(node, 0, 1);
    this.meterBad = 0;
    const encoder = new AudioEncoder({
      output: chunk => this.sendChunk(chunk),
      error: err => {
        console.warn('encodeur :', err);
        if (this.capture?.encoder !== encoder) return;
        this.stop();
        setTimeout(() => this.refresh(), 2000); // on rouvre le micro avec un encodeur neuf
      },
    });
    encoder.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: BITRATE, opus: { frameDuration: FRAME * 1e6, application: 'voip' } });
    source.connect(node);
    node.port.onmessage = e => this.onFrame(e.data.samples, e.data.power, rate);
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      if (this.capture?.stream !== stream) return;
      this.stop();
      this.error = 'Le micro a été débranché.';
      this.onChange?.();
    });
    this.capture = { stream, source, meter, meterSource, node, encoder, rate };
    this.starting = false;
    this.onChange?.();
  }

  stop() {
    this.token++;
    this.starting = false;
    this.talking = false;
    this.preroll = [];
    this.level = 0;
    const cap = this.capture;
    if (!cap) return;
    this.capture = null;
    cap.node.port.onmessage = null;
    cap.node.port.postMessage('stop');
    cap.source.disconnect();
    cap.meterSource?.disconnect();
    for (const s of [cap.stream, cap.meter]) s?.getTracks().forEach(t => t.stop());
    if (cap.encoder.state !== 'closed') cap.encoder.close();
    this.onChange?.();
  }

  onFrame(samples, power, rate) {
    const db = decibels(samples), lvl = level(db), now = performance.now() / 1000;
    this.level = Math.max(lvl, this.level * 0.75);
    let open = false;
    if (this.joined && this.mode === 'ptt') open = this.ptt;
    else if (this.joined && this.mode === 'open') {
      if (lvl >= this.gate) this.loudAt = now;
      open = now - this.loudAt < HANGOVER;
    }
    if (open) {
      if (!this.talking) {
        this.talking = true;
        for (const f of this.preroll) this.encode(f, rate);
        this.preroll = [];
      }
      this.db = this.loudness(db, power);
      this.encode(samples, rate);
    } else {
      if (this.talking) {
        this.talking = false;
        this.capture?.encoder.flush().catch(() => {}); // la fin de la dernière trame part tout de suite
      }
      this.preroll.push(samples);
      if (this.preroll.length > PREROLL) this.preroll.shift();
    }
  }

  // À quel point on parle fort, sur l'échelle du son réglé (une voix normale : les trois quarts de ses
  // trames sous SPEECH_DB) : l'écart entre le flux brut et sa voix habituelle, apprise sur les deux
  // dernières minutes de parole. N'y comptent que les trames où l'on parle (le son réglé, débarrassé du
  // bruit de fond, en décide) : ni les silences entre deux phrases, ni le bruit de la pièce.
  loudness(db, power) {
    if (power < 0 || this.meterBad > 25) return db;
    const m = 10 * Math.log10(power + 1e-12);
    if (m < -85 && db > -50) { this.meterBad++; return db; } // flux brut muet : on s'en passe
    if (db > -45) this.learn(m);
    return this.ref === null ? db : m - this.ref + SPEECH_DB;
  }

  // Une trame de parole de plus pour apprendre sa voix habituelle : le niveau sous lequel tombent les
  // trois quarts de ses trames. Il bouge à peine tant que l'on parle normalement la plupart du temps,
  // même après avoir chuchoté ou crié un moment (la médiane, elle, suivrait les murmures).
  learn(m) {
    const k = 1 - 1 / REF_FRAMES, h = this.hist;
    for (let i = 0; i < h.length; i++) h[i] *= k;
    h[Math.max(0, Math.min(100, Math.round(m) + 100))] += 1;
    this.histW = this.histW * k + 1;
    let i = 0;
    for (let acc = 0; i < 100; i++) if ((acc += h[i]) >= this.histW * 0.75) break;
    this.ref = i - 100;
    if (++this.learnt % 250 === 0) this.onRef?.(this.ref);
  }

  // Reprend une voix habituelle connue (ou repart de zéro avec null).
  seedRef(ref) {
    this.hist.fill(0);
    this.histW = 0;
    this.ref = null;
    if (!Number.isFinite(ref) || ref < -100 || ref > 0) return;
    this.hist[Math.round(ref) + 100] = REF_SEED;
    this.histW = REF_SEED;
    this.ref = Math.round(ref);
  }

  encode(samples, rate) {
    const enc = this.capture?.encoder;
    if (!enc || enc.state !== 'configured' || enc.encodeQueueSize > 4) return;
    const data = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: this.ts, data: samples });
    this.ts += (samples.length / rate) * 1e6;
    enc.encode(data);
    data.close();
  }

  sendChunk(chunk) {
    if (!this.joined) return;
    const bytes = new Uint8Array(3 + chunk.byteLength);
    bytes[0] = this.seq & 255;
    bytes[1] = this.seq >> 8;
    bytes[2] = Math.max(0, Math.min(100, Math.round(this.db + 100)));
    chunk.copyTo(bytes.subarray(3));
    this.seq = (this.seq + 1) & 0xffff;
    this.send(bytes);
    // Ce que la créature en entend, comme l'hôte le calcule (pour la pastille du HUD)
    const now = performance.now() / 1000, r = voiceNoise(this.db);
    this.carry = Math.max(this.carrying(now), r);
    this.carryAt = now;
    if (r >= CFG.noise.voice.shout) this.shoutAt = now;
  }

  // Jusqu'où la créature entend notre voix en ce moment (en cases ; 0 : pas du tout)…
  carrying(now = performance.now() / 1000) {
    return Math.max(0, this.carry - CFG.noise.voice.fade * (now - this.carryAt));
  }

  // …et si l'on vient de crier (l'avertissement reste un peu, sans clignoter entre deux mots).
  shouted() {
    return performance.now() / 1000 - this.shoutAt < 1.5;
  }

  // --- Réception et lecture ---
  receive(from, data) {
    const ctx = this.sound.ctx;
    if (!this.supported || !ctx || !(data instanceof Uint8Array) || data.length < 4) return;
    const s = this.speakers.get(from) || this.speaker(from);
    const seq = data[0] | (data[1] << 8);
    if (s.seq >= 0) {
      const d = (seq - s.seq) & 0xffff;
      if (d === 0 || d > 0x8000) return; // en double, ou doublée en route par la suivante
      if (d <= 4) s.gap += (d - 1) * FRAME; // trames perdues : un court silence à leur place
    }
    s.seq = seq;
    s.heard = ctx.currentTime;
    if (!s.decoder || s.decoder.state === 'closed') s.decoder = this.decoder(s);
    s.ts += FRAME * 1e6;
    try {
      s.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: s.ts, data: data.subarray(3) }));
    } catch {
      s.decoder = null;
    }
  }

  decoder(s) {
    const dec = new AudioDecoder({
      output: d => this.play(s, d),
      error: () => { if (s.decoder === dec) s.decoder = null; },
    });
    dec.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
    return dec;
  }

  speaker(id) {
    const c = this.sound.ctx;
    const env = c.createGain(); // les fondus aux coupures (voir play)
    const input = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    filter.Q.value = 0.5;
    const panner = new PannerNode(c, { panningModel: 'equalpower', distanceModel: 'linear', rolloffFactor: 0, positionZ: -1 });
    const wet = c.createGain();
    wet.gain.value = 0;
    env.connect(input).connect(filter).connect(panner).connect(this.sound.voiceOut);
    filter.connect(wet).connect(this.sound.verb);
    const s = { env, input, filter, panner, wet, decoder: null, seq: -1, ts: 0, gap: 0, cut: false, next: 0, fadeAt: 0, delay: JITTER, heard: c.currentTime, flat: true, audible: true };
    this.speakers.set(id, s);
    return s;
  }

  play(s, d) {
    const ctx = this.sound.ctx;
    if (s.gone) { d.close(); return; }
    const buf = ctx.createBuffer(1, d.numberOfFrames, d.sampleRate);
    d.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
    d.close();
    const now = ctx.currentTime, g = s.env.gain;
    let start = s.next + s.gap, cut = s.gap > 0 || s.cut;
    s.gap = 0;
    s.cut = false;
    if (start < now + MIN_LEAD) {
      // Tampon vide. Si la voix venait de s'interrompre (elle arrive en retard, pas une nouvelle phrase), on
      // la retarde un peu plus désormais ; à chaque nouvelle phrase, ce retard revient doucement.
      if (now - s.next < 0.3) s.delay = Math.min(MAX_JITTER, s.delay + FRAME);
      else s.delay = Math.max(JITTER, s.delay - FRAME / 2);
      start = now + s.delay;
      cut = true;
    } else if (start > now + s.delay + MAX_LAG) {
      // Trop de retard accumulé (une rafale après un blocage) : on saute cette trame. Repartir plus tôt
      // ferait jouer deux bouts de phrase par-dessus ceux déjà programmés.
      s.cut = true;
      return;
    }
    // Chaque trame finit par un fondu, annulé dès que la suivante arrive à temps pour lui succéder ; après
    // une coupure, la reprise commence par un fondu. Tout se joue au moins MIN_LEAD à l'avance.
    if (cut) {
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(1, start + FADE);
    } else g.cancelScheduledValues(s.fadeAt);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(s.env);
    src.start(start);
    s.next = start + buf.duration;
    s.fadeAt = s.next - FADE;
    g.setValueAtTime(1, s.fadeAt);
    g.linearRampToValueAtTime(0, s.next);
  }

  drop(id) {
    const s = this.speakers.get(id);
    if (!s) return;
    this.speakers.delete(id);
    s.gone = true;
    if (s.decoder && s.decoder.state !== 'closed') s.decoder.close();
    s.env.disconnect();
    s.input.disconnect();
    s.filter.disconnect();
    s.panner.disconnect();
    s.wet.disconnect();
  }

  // Quelqu'un qu'on entend parler en ce moment (soi-même : sa voix part).
  speaking(id, me) {
    if (id === me) return this.talking;
    const s = this.speakers.get(id), ctx = this.sound.ctx;
    return !!s && !!ctx && s.audible && s.next > ctx.currentTime;
  }

  // À chaque image : volume, étouffement, direction et réverbération de chaque voix, selon les oreilles
  // par lesquelles on entend (G.view : les siennes, celles de son fantôme, ou celles de l'ami suivi).
  update(G) {
    const ctx = this.sound.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, map = G.map, v = G.view;
    for (const [id, s] of this.speakers) {
      if (t - s.heard > IDLE) { this.drop(id); continue; }
      const p = map && G.players.get(id);
      let gain = 1, cutoff = 20000, wet = 0, x = 0, y = 0, z = -1, flat = true;
      if (p && (p.state === 'alive' || p.state === 'down')) {
        // Une voix du manoir
        flat = false;
        const d = levelDist(map, v.x, v.y, p.x, p.y), df = floorAt(map, p.x) - floorAt(map, v.x);
        gain = falloff(d);
        if (df) { gain *= 0.55; cutoff = 450; } // à travers le plancher
        else {
          // une cachette (la sienne ou celle de celui qui parle) étouffe comme un mur
          const k = Math.max(walls(map, v.x, v.y, p.x, p.y), p.hidden || v.hide ? 1 : 0);
          gain *= 0.62 ** k;
          cutoff = [20000, 1500, 850, 550][k];
        }
        wet = 0.06 + 0.3 * Math.min(1, d / CFG.voice.range);
        const dx = p.x - v.x - df * map.stride, dy = p.y - v.y, ca = Math.cos(v.a), sa = Math.sin(v.a);
        x = dy * ca - dx * sa; // à droite
        z = -(dx * ca + dy * sa); // devant (l'auditeur regarde vers -z)
        y = df * STOREY;
        if (Math.hypot(x, y, z) < 0.3) { x = 0; y = 0; z = -0.3; }
      } else if (p && p.state === 'dead') {
        wet = 0.45; // voix d'outre-tombe : partout à la fois, dans l'écho du manoir
      }
      if (flat !== s.flat) {
        s.flat = flat;
        s.panner.panningModel = flat ? 'equalpower' : 'HRTF';
      }
      s.audible = gain > 0.04;
      s.input.gain.setTargetAtTime(gain, t, SMOOTH);
      s.filter.frequency.setTargetAtTime(cutoff, t, SMOOTH);
      s.wet.gain.setTargetAtTime(wet, t, SMOOTH);
      s.panner.positionX.setTargetAtTime(x, t, SMOOTH);
      s.panner.positionY.setTargetAtTime(y, t, SMOOTH);
      s.panner.positionZ.setTargetAtTime(z, t, SMOOTH);
    }
  }
}
