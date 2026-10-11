/**
 * Arena's sound effects, played from the player's own VOC files through the
 * Web Audio API. Sounds from a place in the level are quieter further away
 * or round a corner, and come from the side they are on.
 */
import { parseVoc } from '../formats/voc';

/** How far away a sound can still be heard, in voxels. */
const HEARING = 12;
const MAX_VOICES = 16;
/** Browsers must accept at least this rate; Arena's quietest sounds use less. */
const MIN_RATE = 8000;

export interface Listener {
  x: number;
  y: number;
  yaw: number;
}

export interface SoundFiles {
  has(name: string): boolean;
  read(name: string): Promise<Uint8Array>;
}

export class SoundBank {
  private context?: AudioContext;
  private output?: GainNode;
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly lastPlayed = new Map<string, number>();
  private voices = 0;
  private volume = 1;

  constructor(private readonly files: SoundFiles) {}

  /** Browsers start sound only after a click or key press; call this from one. */
  wake(): void {
    void this.audio()?.resume().catch(() => {});
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.output) this.output.gain.value = volume;
  }

  /**
   * Plays a sound file. With `from` and `listener` it comes from that place;
   * `heard` (0 to 1) muffles it, for sounds behind walls.
   */
  play(name: string, options: { volume?: number; from?: { x: number; y: number }; listener?: Listener; heard?: number } = {}): void {
    if (!this.files.has(name) || this.volume <= 0) return;
    let volume = options.volume ?? 1;
    let pan = 0;
    const { from, listener } = options;
    if (from && listener) {
      const dx = from.x - listener.x;
      const dy = from.y - listener.y;
      const d = Math.hypot(dx, dy);
      if (d >= HEARING) return;
      volume *= (1 - d / HEARING) ** 1.5 * (options.heard ?? 1);
      // The listener's right is (-sin yaw, cos yaw) in level coordinates.
      if (d > 0.3) pan = ((dx * -Math.sin(listener.yaw) + dy * Math.cos(listener.yaw)) / d) * 0.75;
    }
    if (volume < 0.02) return;
    const ctx = this.audio();
    // Until the page may play sound, nothing would be heard (and nothing would finish).
    if (!ctx || ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    // The same sound many times at once only gets louder; once is enough.
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.05) return;
    this.lastPlayed.set(name, now);
    void this.buffer(name).then((buffer) => {
      if (!buffer || !this.output) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1, volume);
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      source.connect(gain).connect(panner).connect(this.output);
      this.voices++;
      source.onended = () => this.voices--;
      source.start();
    });
  }

  private audio(): AudioContext | undefined {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return undefined; // no sound on this system
      }
      this.output = this.context.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(this.context.destination);
    }
    return this.context;
  }

  private buffer(name: string): Promise<AudioBuffer | undefined> {
    let p = this.buffers.get(name);
    if (!p) {
      p = (async () => {
        const ctx = this.audio()!;
        const sound = parseVoc(await this.files.read(name));
        // Low-rate sounds are stretched to a rate every browser takes, filling in between samples.
        const factor = Math.ceil(MIN_RATE / sound.sampleRate);
        const s = sound.samples;
        const buffer = ctx.createBuffer(1, Math.max(1, s.length * factor), sound.sampleRate * factor);
        const out = buffer.getChannelData(0);
        for (let i = 0; i < s.length; i++) {
          const next = s[Math.min(i + 1, s.length - 1)];
          for (let k = 0; k < factor; k++) out[i * factor + k] = s[i] + ((next - s[i]) * k) / factor;
        }
        return buffer;
      })().catch((err) => {
        console.warn(`Could not play ${name}:`, err);
        return undefined;
      });
      this.buffers.set(name, p);
    }
    return p;
  }
}
