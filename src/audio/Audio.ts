/**
 * All game audio, synthesised in the browser with Web Audio.
 *
 * Nothing is loaded from a file: the star chime, the dive whoosh and the
 * background music are all generated from oscillators and noise. That keeps
 * the repository free of binary assets, exactly like the 3D models.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so `init()`
 * must be called from a click — the Start button does that.
 */

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** One eighth note at 96bpm. Eight of them make a 2.5 second bar. */
const STEP = 0.3125;
const STEPS_PER_BAR = 8;

/** A gentle I–V–vi–IV loop. Voiced low and wide so it sits under the game. */
const CHORDS: number[][] = [
  [48, 55, 60, 64], // C
  [43, 50, 55, 59], // G
  [45, 52, 57, 60], // Am
  [41, 48, 53, 57], // F
];

/** Melody notes available in each bar, picked by the pattern below. */
const ARP_POOL: number[][] = [
  [72, 76, 79, 84],
  [71, 74, 79, 83],
  [72, 76, 81, 84],
  [72, 77, 81, 84],
];

/** Which pool note to play on each eighth; -1 is a rest, so the loop breathes. */
const ARP_PATTERN = [0, -1, 2, 1, -1, 3, 2, -1];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;

  private noise: AudioBuffer | null = null;

  private schedulerId: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private musicWanted = false;

  private _muted = false;

  get ready() {
    return this.ctx !== null;
  }

  get muted() {
    return this._muted;
  }

  /** Must be called from a user gesture, or the context stays suspended. */
  async init(): Promise<void> {
    if (this.ctx) {
      // Browsers can suspend the context again when a tab is backgrounded.
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }

    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 1;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.16;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.master);

    if (ctx.state === "suspended") await ctx.resume();
  }

  setMuted(muted: boolean) {
    this._muted = muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
  }

  /* ------------------------------------------------------------------ *
   * Sound effects
   * ------------------------------------------------------------------ */

  /**
   * Star pickup. The pitch climbs with the streak, so chaining stars together
   * sounds like it is going well rather than like the same blip repeated.
   */
  star(streak = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = 72 + Math.min(streak, 8) * 2;

    for (const [interval, level, wave] of [
      [0, 0.5, "triangle"],
      [7, 0.22, "sine"],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq(base + interval), t);
      osc.frequency.exponentialRampToValueAtTime(freq(base + interval + 5), t + 0.09);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

      osc.connect(gain).connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.36);
    }
  }

  /**
   * One wingbeat. Fires over a wingbeat a second, so it is deliberately quiet
   * and short — at full volume it would become a rattle within seconds.
   */
  flap(strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.getNoise();
    src.playbackRate.value = 0.8 + Math.random() * 0.3;

    // Low-passed noise sweeping down reads as a soft push of air rather than
    // a hiss.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1100, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.22);
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    const level = 0.1 + strength * 0.1;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);

    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.3);
  }

  /**
   * A hornbill call: the loud nasal double honk the bird is named for.
   *
   * Sawtooth through a resonant bandpass gives the hollow, reedy quality; the
   * fast downward pitch bend on each bark is what makes it read as a call
   * rather than a beep.
   */
  call() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const barks = 2 + Math.floor(Math.random() * 2);

    for (let i = 0; i < barks; i++) {
      const at = t0 + i * (0.19 + Math.random() * 0.05);
      const root = 300 + Math.random() * 60;

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(root * 1.5, at);
      osc.frequency.exponentialRampToValueAtTime(root, at + 0.07);

      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(950, at);
      band.frequency.exponentialRampToValueAtTime(620, at + 0.12);
      band.Q.value = 4.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);

      osc.connect(band).connect(gain).connect(this.sfxBus);
      osc.start(at);
      osc.stop(at + 0.18);
    }
  }

  /** Bonus time awarded. Bright and rising, clearly a good thing. */
  bonus() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [79, 84, 88].forEach((midi, i) => {
      const at = t + i * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq(midi), at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
      osc.connect(gain).connect(this.sfxBus);
      osc.start(at);
      osc.stop(at + 0.42);
    });
  }

  /** Flying into a tree. A dull thud, not a musical note. */
  crash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.getNoise();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + 0.45);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(filter).connect(noiseGain).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.55);

    // A low body under the impact so it lands with some weight.
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(oscGain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  /** Air rushing past as the bird tucks in and drops. */
  dive() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.getNoise();

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(320, t);
    band.frequency.exponentialRampToValueAtTime(1900, t + 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);

    src.connect(band).connect(gain).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.75);
  }

  /** Three descending notes when the clock runs out. */
  gameOver() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [76, 72, 67].forEach((midi, i) => {
      const at = t + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq(midi), at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(this.sfxBus);
      osc.start(at);
      osc.stop(at + 0.52);
    });
  }

  /** Rising flourish when a run begins. */
  launch() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [60, 64, 67, 72].forEach((midi, i) => {
      const at = t + i * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq(midi), at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.34, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(this.sfxBus);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  }

  private getNoise(): AudioBuffer {
    const ctx = this.ctx!;
    if (this.noise) return this.noise;
    const length = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /* ------------------------------------------------------------------ *
   * Background music
   * ------------------------------------------------------------------ */

  startMusic() {
    if (!this.ctx || this.musicWanted) return;
    this.musicWanted = true;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    // A lookahead scheduler: setInterval is far too jittery to place notes
    // directly, so it only queues notes that are already due soon.
    this.schedulerId = window.setInterval(this.schedule, 25);
  }

  stopMusic() {
    this.musicWanted = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  private schedule = () => {
    const ctx = this.ctx;
    if (!ctx || !this.musicWanted) return;
    while (this.nextStepTime < ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP;
      this.step++;
    }
  };

  private playStep(step: number, time: number) {
    const bar = Math.floor(step / STEPS_PER_BAR) % CHORDS.length;
    const beat = step % STEPS_PER_BAR;

    if (beat === 0) this.pad(CHORDS[bar], time);

    const pick = ARP_PATTERN[beat];
    if (pick >= 0) {
      const pool = ARP_POOL[bar];
      this.blip(pool[pick % pool.length], time, beat === 0 ? 0.16 : 0.1);
    }
  }

  /** A soft sustained chord under the whole bar. */
  private pad(chord: number[], time: number) {
    const ctx = this.ctx!;
    const length = STEP * STEPS_PER_BAR;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.linearRampToValueAtTime(1200, time + length * 0.5);
    filter.frequency.linearRampToValueAtTime(700, time + length);
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.32, time + 0.7);
    gain.gain.setValueAtTime(0.32, time + length - 0.7);
    gain.gain.linearRampToValueAtTime(0.0001, time + length);

    filter.connect(gain).connect(this.musicBus);

    for (const midi of chord) {
      // Two slightly detuned voices per note, which is what stops a stack of
      // plain oscillators from sounding like a test tone.
      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + length + 0.05);
      }
    }
  }

  /** A single plucked melody note. */
  private blip(midi: number, time: number, level: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq(midi);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    osc.connect(gain).connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.52);
  }
}
