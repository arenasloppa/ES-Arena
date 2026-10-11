/**
 * Arena's music: which song plays where, and playing it. Songs are XMI
 * files in GLOBAL.BSA played on the AdLib (adlib.ts) with the instruments
 * of the game's SAMPLE.AD, from the .XFM arrangement Arena made for FM
 * chips when there is one. Each song is made into sound once, in a worker,
 * then loops; a new song fades in as the last fades out.
 *
 * Where each plays follows the game's program, which lists them in this
 * order, and OpenTESArena: PERCNTRO in the main menu, SHEET while making a
 * character, EVLINTRO for the story before it, VISION for Ria Silmane's
 * visions, and one of DUNGEON1 to DUNGEON5 in a dungeon.
 */
import { parseTimbres } from '../formats/timbres';
import { parseXmi } from '../formats/xmi';
import { renderSong } from './adlib';
import type { RenderReply, RenderRequest } from './musicWorker';

export const SONGS = {
  menu: 'PERCNTRO',
  creation: 'SHEET',
  story: 'EVLINTRO',
  vision: 'VISION',
  dungeons: ['DUNGEON1', 'DUNGEON2', 'DUNGEON3', 'DUNGEON4', 'DUNGEON5'],
} as const;

/** The instrument banks, the AdLib's first. */
const TIMBRE_FILES = ['SAMPLE.AD', 'SAMPLE.OPL'];
const FADE = 1.2;
const SAMPLE_RATE = 32000;

export interface MusicFiles {
  has(name: string): boolean;
  read(name: string): Promise<Uint8Array>;
}

/** The file to play for a song: its FM arrangement when there is one. */
export function songFile(files: Pick<MusicFiles, 'has'>, song: string): string | undefined {
  return [`${song}.XFM`, `${song}.XMI`].find((n) => files.has(n));
}

export class MusicPlayer {
  private context: AudioContext | undefined;
  private output: GainNode | undefined;
  private current: { song: string; source?: AudioBufferSourceNode; gain?: GainNode } | undefined;
  private readonly rendered = new Map<string, Promise<AudioBuffer | undefined>>();
  private timbres: Promise<Uint8Array | undefined> | undefined;
  private worker: Worker | undefined | null;
  private nextId = 0;
  private readonly waiting = new Map<number, { request: RenderRequest; resolve: (reply: RenderReply) => void }>();
  private volume = 1;

  constructor(private readonly files: MusicFiles) {}

  /** True when the folder has the instruments to play music with. */
  get available(): boolean {
    return TIMBRE_FILES.some((n) => this.files.has(n));
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.output) this.output.gain.value = volume;
  }

  /** Browsers start sound only after a click or key press; call on one. */
  wake(): void {
    void this.audio()?.resume().catch(() => {});
  }

  /** Plays a song, or one of several at random; the same song carries on. Undefined stops the music. */
  play(song: string | readonly string[] | undefined): void {
    const name = typeof song === 'string' || song === undefined ? song : song[Math.floor(Math.random() * song.length)];
    if (typeof song !== 'string' && song && this.current && song.includes(this.current.song)) return;
    if (name === this.current?.song) return;
    this.fadeOut();
    if (!name || !this.available) {
      this.current = undefined;
      return;
    }
    const playing = { song: name } as NonNullable<MusicPlayer['current']>;
    this.current = playing;
    void this.buffer(name).then((buffer) => {
      const ctx = this.context;
      if (!buffer || !ctx || !this.output || this.current !== playing) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
      source.connect(gain).connect(this.output);
      source.start();
      playing.source = source;
      playing.gain = gain;
    });
  }

  /** The song playing (or about to), for the dev console and browser tests. */
  get song(): string | undefined {
    return this.current?.song;
  }

  /** True once the song playing has started sounding. */
  get sounding(): boolean {
    return !!this.current?.source;
  }

  /** Makes a song's sound ahead of time, so it starts at once when asked for. */
  prepare(song: string): void {
    void this.buffer(song);
  }

  private fadeOut(): void {
    const old = this.current;
    const ctx = this.context;
    if (!old?.source || !old.gain || !ctx) return;
    old.gain.gain.cancelScheduledValues(ctx.currentTime);
    old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime);
    old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
    old.source.stop(ctx.currentTime + FADE + 0.05);
  }

  private audio(): AudioContext | undefined {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return undefined;
      }
      this.output = this.context.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(this.context.destination);
    }
    return this.context;
  }

  private buffer(song: string): Promise<AudioBuffer | undefined> {
    let p = this.rendered.get(song);
    if (!p) {
      p = (async () => {
        const file = songFile(this.files, song);
        const timbres = await this.timbreBank();
        const ctx = this.audio();
        if (!file || !timbres || !ctx) return undefined;
        const reply = await this.render({ id: this.nextId++, song: await this.files.read(file), timbres, sampleRate: SAMPLE_RATE });
        if ('error' in reply) throw new Error(reply.error);
        const buffer = ctx.createBuffer(1, Math.max(1, reply.samples.length), reply.sampleRate);
        buffer.copyToChannel(reply.samples as Float32Array<ArrayBuffer>, 0);
        return buffer;
      })().catch((err) => {
        console.warn(`Could not play the music ${song}:`, err);
        return undefined;
      });
      this.rendered.set(song, p);
    }
    return p;
  }

  private timbreBank(): Promise<Uint8Array | undefined> {
    this.timbres ??= (async () => {
      const name = TIMBRE_FILES.find((n) => this.files.has(n));
      return name ? this.files.read(name) : undefined;
    })();
    return this.timbres;
  }

  /** Renders in the worker, or here if a worker can't be started. */
  private render(request: RenderRequest): Promise<RenderReply> {
    const worker = this.startWorker();
    if (!worker) return Promise.resolve(renderHere(request));
    return new Promise((resolve) => {
      this.waiting.set(request.id, { request, resolve });
      worker.postMessage(request);
    });
  }

  private startWorker(): Worker | undefined {
    if (this.worker === undefined) {
      try {
        this.worker = new Worker(new URL('./musicWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<RenderReply>) => {
          this.waiting.get(e.data.id)?.resolve(e.data);
          this.waiting.delete(e.data.id);
        };
        this.worker.onerror = () => {
          // The worker could not start: render the songs waiting on it here instead.
          this.worker = null;
          for (const { request, resolve } of this.waiting.values()) resolve(renderHere(request));
          this.waiting.clear();
        };
      } catch {
        this.worker = null;
      }
    }
    return this.worker ?? undefined;
  }
}

function renderHere(r: RenderRequest): RenderReply {
  try {
    const out = renderSong(parseXmi(r.song), parseTimbres(r.timbres), r.sampleRate);
    return { id: r.id, samples: out.samples, sampleRate: out.sampleRate };
  } catch (err) {
    return { id: r.id, error: (err as Error).message };
  }
}
