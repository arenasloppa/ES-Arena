/**
 * Arena's cutscenes: its FLC animations, still pictures and the visions, in
 * which an animation loops while the words of TEMPLATE.DAT appear beneath it
 * three lines at a time, each page spoken by the CD version's voices
 * (SPEECH/1400_00A.VOC then 1400_00B.VOC for the first page, and so on).
 * Without the voices a page shows long enough to read.
 *
 * Enter, Space, a click or A goes on to the next picture or page; Esc, B or
 * Start skips the rest. The pictures are drawn at Arena's 320x200, stretched
 * to the 4:3 screen it was made for.
 */
import type { SoundBank } from '../audio/sound';
import { parseFlc, type Flc } from '../formats/flc';
import { parseImg } from '../formats/img';
import { indicesToRgba, parseCol } from '../formats/palette';
import { fillTemplate, pages, parseTemplates, type Templates } from '../formats/template';
import type { GamepadInput } from '../input/gamepad';

export type Shot =
  /** An animation, played once through. */
  | { kind: 'animation'; file: string }
  /** A still picture for some seconds; `palette` names another picture whose palette it uses. */
  | { kind: 'picture'; file: string; seconds: number; palette?: string }
  /** An animation looping under a text from TEMPLATE.DAT, read aloud where there are voices. */
  | { kind: 'vision'; file: string; text: string; name: string; colour: string };

export interface CutsceneFiles {
  has(name: string): boolean;
  read(name: string): Promise<Uint8Array>;
}

/** Ria Silmane's blue and Jagar Tharn's gold, as the game colours their words. */
export const RIA = 'rgb(105, 174, 207)';
export const THARN = 'rgb(251, 207, 8)';

/** Seconds a page of a vision shows without a voice: enough to read it. */
function readingTime(text: string): number {
  return Math.max(4, text.length * 0.065);
}

export class Cutscenes {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly subtitle: HTMLElement;
  private templates: Promise<Templates> | undefined;
  private playing = false;
  /** Set by the player's input; read and cleared by the shot playing. */
  private next = false;
  private skip = false;
  private wake: (() => void) | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly pad: GamepadInput,
    private readonly files: () => CutsceneFiles | undefined,
    private readonly sounds: () => SoundBank | undefined,
  ) {
    this.canvas = root.querySelector('canvas')!;
    this.canvas.width = 320;
    this.canvas.height = 200;
    this.ctx = this.canvas.getContext('2d')!;
    this.subtitle = root.querySelector('.cutscene-text')!;
    window.addEventListener('keydown', this.onKey, true);
    root.addEventListener('pointerdown', () => this.press(false));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Plays the shots in turn; resolves when they end or are skipped. */
  async play(shots: Shot[]): Promise<void> {
    const files = this.files();
    if (!files || this.playing) return;
    this.playing = true;
    this.next = this.skip = false;
    this.root.hidden = false;
    this.subtitle.textContent = '';
    try {
      for (const shot of shots) {
        if (this.skip) break;
        this.next = false;
        try {
          if (shot.kind === 'picture') await this.picture(files, shot);
          else if (shot.kind === 'animation') await this.animation(files, shot.file);
          else await this.vision(files, shot);
        } catch (err) {
          // A missing or unreadable file only leaves out that shot.
          console.warn(`Could not show ${shot.file}:`, err);
        }
      }
    } finally {
      this.root.hidden = true;
      this.subtitle.textContent = '';
      this.playing = false;
    }
  }

  /** Reads the controller; call every frame. */
  frame(): void {
    if (!this.playing || !this.pad.connected) return;
    if (this.pad.take('B') || this.pad.take('Start')) this.press(true);
    else if (this.pad.take('A')) this.press(false);
  }

  private press(all: boolean): void {
    if (!this.playing) return;
    if (all) this.skip = true;
    this.next = true;
    this.wake?.();
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.playing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') this.press(true);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') this.press(false);
  };

  /** Waits `seconds`, or until the player moves on. */
  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, seconds * 1000);
      this.wake = done;
      if (this.next) done();
    });
  }

  private async picture(files: CutsceneFiles, shot: Extract<Shot, { kind: 'picture' }>): Promise<void> {
    const img = parseImg(await files.read(shot.file));
    const own = img.palette ?? (shot.palette ? parseImg(await files.read(shot.palette)).palette : undefined);
    const palette = own ? parseCol(own) : parseCol(await files.read('PAL.COL'));
    this.draw(img.width, img.height, indicesToRgba(img.pixels, palette));
    await this.wait(shot.seconds);
  }

  private async animation(files: CutsceneFiles, file: string): Promise<void> {
    const flc = parseFlc(await files.read(file));
    await this.run(flc, false, () => false);
  }

  private async vision(files: CutsceneFiles, shot: Extract<Shot, { kind: 'vision' }>): Promise<void> {
    const flc = parseFlc(await files.read(shot.file));
    const text = (await this.texts(files)).get(shot.text);
    let finished = false;
    const looping = this.run(flc, true, () => finished);
    this.subtitle.style.color = shot.colour;
    const sounds = this.sounds();
    for (const [i, page] of (text ? pages(fillTemplate(text, shot.name)) : []).entries()) {
      if (this.skip) break;
      this.next = false;
      this.subtitle.textContent = page;
      let spoke = false;
      for (const part of ['A', 'B']) {
        const name = `SPEECH/${shot.text}_${String(i).padStart(2, '0')}${part}.VOC`;
        if (this.next || !sounds || !files.has(name)) continue;
        const voice = sounds.speak(name);
        this.wake = () => voice.stop();
        spoke = (await voice.done) || spoke;
        this.wake = undefined;
      }
      if (!spoke && !this.next) await this.wait(readingTime(page));
    }
    finished = true;
    this.subtitle.textContent = '';
    await looping;
  }

  /** Plays an animation once, or loops it until `stop` says so. */
  private run(flc: Flc, loop: boolean, stop: () => boolean): Promise<void> {
    const images = new Map<number, ImageData>();
    const image = (i: number) => {
      let data = images.get(i);
      if (!data) {
        const f = flc.frames[i];
        const rgba = new Uint8ClampedArray(flc.width * flc.height * 4);
        for (let p = 0; p < f.pixels.length; p++) {
          const c = f.pixels[p] * 3;
          rgba[p * 4] = f.palette[c];
          rgba[p * 4 + 1] = f.palette[c + 1];
          rgba[p * 4 + 2] = f.palette[c + 2];
          rgba[p * 4 + 3] = 255;
        }
        data = new ImageData(rgba, flc.width, flc.height);
        images.set(i, data);
      }
      return data;
    };
    return new Promise((resolve) => {
      let start: number | undefined;
      const tick = (now: number) => {
        // Timed from the first frame drawn: the browser's frame times can be a little before performance.now().
        start ??= now;
        const shown = Math.max(0, Math.floor((now - start) / flc.frameMs));
        const ended = loop ? stop() || this.skip : shown >= flc.frames.length || this.next;
        if (ended || !flc.frames.length) {
          resolve();
          return;
        }
        try {
          this.drawImage(image(shown % flc.frames.length), flc.width, flc.height);
        } catch (err) {
          console.warn('Could not draw the animation:', err);
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private texts(files: CutsceneFiles): Promise<Templates> {
    this.templates ??= files.read('TEMPLATE.DAT').then((b) => parseTemplates(new TextDecoder('latin1').decode(b)));
    return this.templates;
  }

  private draw(width: number, height: number, rgba: Uint8Array): void {
    this.drawImage(new ImageData(Uint8ClampedArray.from(rgba), width, height), width, height);
  }

  private drawImage(data: ImageData, width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.putImageData(data, 0, 0);
  }
}

/** The opening, when the game starts: the book, the title, the quote, and the scroll that tells how it began. */
export const OPENING: Shot[] = [
  { kind: 'animation', file: 'INTRO.FLC' },
  { kind: 'picture', file: 'TITLE.IMG', seconds: 5 },
  { kind: 'picture', file: 'QUOTE.IMG', seconds: 5 },
  { kind: 'animation', file: 'SCROLL.FLC' },
  { kind: 'picture', file: 'SCROLL01.IMG', seconds: 13, palette: 'SCROLL03.IMG' },
  { kind: 'picture', file: 'SCROLL02.IMG', seconds: 13, palette: 'SCROLL03.IMG' },
  { kind: 'picture', file: 'SCROLL03.IMG', seconds: 10 },
];

/** Before a new character is made: the scroll, and the nine pages of how the Emperor was betrayed. */
export const NEW_GAME: Shot[] = [
  { kind: 'animation', file: 'SCROLL.FLC' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Shot => ({ kind: 'picture', file: `INTRO0${n}.IMG`, seconds: 5, palette: 'SCROLL03.IMG' })),
];

/** Ria Silmane's first vision, after the character is made. */
export function firstVision(firstName: string): Shot[] {
  return [{ kind: 'vision', file: 'VISION.FLC', text: '1400', name: firstName, colour: RIA }];
}

/** Ria Silmane's farewell when the player dies. */
export function deathVision(firstName: string): Shot[] {
  return [{ kind: 'vision', file: 'VISION.FLC', text: '1402', name: firstName, colour: RIA }];
}
