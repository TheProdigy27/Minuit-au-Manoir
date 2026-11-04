// Capture du micro pour le chat vocal (voir voice.js) : découpe le son en trames de la durée d'une trame
// Opus. Elle se fait sur le fil audio, que les images lentes du jeu ne retardent pas. La seconde entrée,
// le même micro sans réglage automatique du gain, ne sert qu'à mesurer la puissance de chaque trame.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.size;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.pow = 0;
    this.powN = 0;
    this.alive = true;
    this.port.onmessage = () => { this.alive = false; };
  }

  process(inputs) {
    const ch = inputs[0]?.[0], raw = inputs[1]?.[0];
    if (!this.alive) return false;
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (raw) { this.pow += raw[i] * raw[i]; this.powN++; }
      if (this.n === this.size) {
        // power : puissance moyenne du flux de mesure (-1 : pas de flux de mesure)
        this.port.postMessage({ samples: this.buf, power: this.powN ? this.pow / this.powN : -1 }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
        this.pow = 0;
        this.powN = 0;
      }
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCapture);
