/**
 * Synthesized sound for TrojanConnect. No audio files: every cue is built from
 * oscillators and filtered noise so it can be pitched and layered live.
 *
 * Browsers only allow audio after a user gesture, so nothing here makes a sound
 * until `unlock()` has been called from a click or key press.
 */

export type Cue =
  | "type"
  | "ping"
  | "buzz"
  | "whoosh"
  | "resolve"
  | "send"
  | "receive"
  | "stamp"
  | "tick"
  | "decline";

export type CueOptions = {
  /** Base frequency in Hz, for pitched cues. */
  freq?: number;
  /** Detune in cents, used to make stacked pings clash. */
  detune?: number;
  /** 0 to 1, multiplied into the cue's own level. */
  volume?: number;
};

type AudioCtor = typeof AudioContext;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = true;
  private level = 0.8;

  private drone: {
    gain: GainNode;
    filter: BiquadFilterNode;
    oscs: OscillatorNode[];
    lfo: OscillatorNode;
  } | null = null;

  private lastPlayed = new Map<Cue, number>();

  /** Create or resume the audio context. Must run inside a user gesture. */
  unlock(): boolean {
    if (typeof window === "undefined") return false;
    if (!this.ctx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.level;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 8;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return true;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state !== "closed";
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : this.level, t, 0.04);
  }

  /** Scale everything down, used by the app UI so cues sit under the interface. */
  setLevel(level: number) {
    this.level = level;
    if (!this.muted) this.setMuted(false);
  }

  play(cue: Cue, opts: CueOptions = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== "running") return;

    // Scroll scrubbing can fire the same cue many times in one frame.
    const now = performance.now();
    const gap = cue === "type" ? 28 : cue === "ping" || cue === "buzz" ? 45 : 60;
    if (now - (this.lastPlayed.get(cue) ?? 0) < gap) return;
    this.lastPlayed.set(cue, now);

    const t = ctx.currentTime + 0.005;
    const v = opts.volume ?? 1;
    switch (cue) {
      case "type":
        return this.typeTick(ctx, t, v);
      case "tick":
        return this.blip(ctx, t, 1400, 0.03, 0.12 * v, "square");
      case "ping":
        return this.ping(ctx, t, opts.freq ?? 880, opts.detune ?? 0, v);
      case "buzz":
        return this.buzz(ctx, t, v);
      case "whoosh":
        return this.whoosh(ctx, t, v);
      case "resolve":
        return this.resolve(ctx, t, v);
      case "send":
        this.blip(ctx, t, 520, 0.09, 0.2 * v, "sine");
        return this.blip(ctx, t + 0.07, 780, 0.12, 0.2 * v, "sine");
      case "receive":
        this.blip(ctx, t, 660, 0.1, 0.16 * v, "sine");
        return this.blip(ctx, t + 0.08, 495, 0.16, 0.16 * v, "sine");
      case "stamp":
        return this.stamp(ctx, t, v);
      case "decline":
        this.blip(ctx, t, 300, 0.14, 0.2 * v, "triangle");
        return this.blip(ctx, t + 0.12, 220, 0.22, 0.2 * v, "triangle");
    }
  }

  /**
   * A low drone whose weight follows `level` (0 silent, 1 oppressive).
   * Drives the "still waiting" feeling on the landing page.
   */
  setDrone(level: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const clamped = Math.max(0, Math.min(1, level));
    if (!this.drone) {
      if (clamped === 0) return;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 120;
      filter.Q.value = 4;
      const oscs = [55, 55.7, 82.6].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? "triangle" : "sawtooth";
        o.frequency.value = f;
        o.connect(filter);
        o.start();
        return o;
      });
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.17;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 40;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      filter.connect(gain).connect(this.master);
      this.drone = { gain, filter, oscs, lfo };
    }
    const t = ctx.currentTime;
    const { gain, filter, oscs } = this.drone;
    gain.gain.setTargetAtTime(clamped * 0.22, t, 0.25);
    filter.frequency.setTargetAtTime(110 + clamped * 620, t, 0.3);
    // The upper voice drifts sharp as pressure builds, so the drone sours.
    oscs[2].detune.setTargetAtTime(clamped * 90, t, 0.4);
    oscs[1].detune.setTargetAtTime(clamped * 35, t, 0.4);
  }

  /** Cut the drone immediately. Used for the silence at the turn. */
  killDrone() {
    const ctx = this.ctx;
    if (!ctx || !this.drone) return;
    this.drone.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.drone.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  }

  // ---- voices -------------------------------------------------------------

  private makeNoise(ctx: AudioContext) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private blip(
    ctx: AudioContext,
    t: number,
    freq: number,
    dur: number,
    peak: number,
    type: OscillatorType,
  ) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(this.env(ctx, t, peak, 0.006, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private typeTick(ctx: AudioContext, t: number, v: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200 + Math.random() * 1600;
    bp.Q.value = 1.6;
    src.connect(bp).connect(this.env(ctx, t, 0.16 * v, 0.002, 0.03));
    src.start(t, Math.random() * 0.5, 0.05);
  }

  private ping(ctx: AudioContext, t: number, freq: number, detune: number, v: number) {
    for (const [mult, peak, dur] of [
      [1, 0.2, 0.5],
      [2.01, 0.07, 0.3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * mult;
      o.detune.value = detune;
      o.connect(this.env(ctx, t, peak * v, 0.004, dur));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private buzz(ctx: AudioContext, t: number, v: number) {
    // Phone on a desk: two short low bursts.
    for (const off of [0, 0.16]) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 148;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      o.connect(lp).connect(this.env(ctx, t + off, 0.1 * v, 0.01, 0.11));
      o.start(t + off);
      o.stop(t + off + 0.2);
    }
  }

  private whoosh(ctx: AudioContext, t: number, v: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 1);
  }

  private resolve(ctx: AudioContext, t: number, v: number) {
    // Open major voicing, staggered upward, long tail.
    const notes = [130.81, 196.0, 261.63, 329.63, 392.0, 523.25];
    notes.forEach((f, i) => {
      const start = t + i * 0.055;
      for (const type of ["sine", "triangle"] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = type === "triangle" ? 4 : -3;
        const peak = (type === "sine" ? 0.11 : 0.045) * v;
        o.connect(this.env(ctx, start, peak, 0.05, 2.8 - i * 0.15));
        o.start(start);
        o.stop(start + 3.2);
      }
    });
  }

  private stamp(ctx: AudioContext, t: number, v: number) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    o.connect(this.env(ctx, t, 0.5 * v, 0.004, 0.2));
    o.start(t);
    o.stop(t + 0.3);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    src.connect(hp).connect(this.env(ctx, t, 0.14 * v, 0.002, 0.05));
    src.start(t, 0.1, 0.08);

    // A small bright confirmation after the thud.
    this.blip(ctx, t + 0.12, 784, 0.25, 0.1 * v, "sine");
    this.blip(ctx, t + 0.2, 1175, 0.35, 0.08 * v, "sine");
  }
}

/** One engine for the whole app, so navigation never restarts the audio context. */
export const sound = new SoundEngine();
