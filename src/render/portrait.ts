/**
 * The character's paper doll, as Arena's character sheet draws it: the
 * race's background, the face, the clothes and what is worn, each picture
 * placed where its own file says on the 320x200 screen, of which the doll
 * takes the right-hand side. Also the pictures of single items for the item
 * menus, and the map of Tamriel that races are chosen on. Everything is read
 * from the player's own game:
 *   CHARBK0r.IMG, CHRBKF0r.IMG   backgrounds for men and women of race r, with their own palette
 *   FACES1r.CIF, FACESF1r.CIF    ten heads for each
 *   MPANTS, MSSHIRT, MRSHIRT     trousers, shirt and a spellcaster's robe (F... for women)
 *   0EQUIP.CIF, 1EQUIP.CIF       what can be worn and wielded, for men and women
 *   TAMRIEL.MNU                  the map, with its own palette
 * Pictures without a palette of their own use CHARSHT.COL.
 */
import { steelWeaponThumbnail } from './steelWeaponThumbnail';
import {weaponModelDefinition} from './weaponModelDefinitions';
import type { GameData } from '../data/files';
import { parseCif } from '../formats/cif';
import { parseImg, type IndexedImage } from '../formats/img';
import { indicesToRgba, parseCol, type Palette } from '../formats/palette';
import type { Gender } from '../game/character';

/** The doll's part of the screen: from DOLL_LEFT to the right edge, all 200 rows. */
export const DOLL_LEFT = 172;
export const DOLL_WIDTH = 320 - DOLL_LEFT;
export const DOLL_HEIGHT = 200;
/** Arena's pixels are 1.2 times as tall as they are wide on its 4:3 screen. */
export const PIXEL_ASPECT = 1.2;

export interface DollLook {
  /** Place in the race list, 0 to 7. */
  race: number;
  gender: Gender;
  /** Which of the race's ten faces. */
  face: number;
  /** Spellcasters wear a robe. */
  robe: boolean;
  /** Frames of the equipment pictures, in the order they are drawn (Inventory.pictureFrames). */
  equipment: number[];
  weapon?: { type?: number; material?: number };
}

export interface Layer {
  file: string;
  /** For a CIF: which picture in it. */
  frame?: number;
}

export function equipmentFile(gender: Gender): string {
  return gender === 'female' ? '1EQUIP.CIF' : '0EQUIP.CIF';
}

/** The pictures that make up the doll, the one at the back first. */
export function dollLayers(look: DollLook): Layer[] {
  const f = look.gender === 'female';
  return [
    { file: `${f ? 'CHRBKF0' : 'CHARBK0'}${look.race}.IMG` },
    { file: `${f ? 'FACESF1' : 'FACES1'}${look.race}.CIF`, frame: look.face },
    { file: f ? 'FPANTS.IMG' : 'MPANTS.IMG' },
    { file: `${f ? 'F' : 'M'}${look.robe ? 'R' : 'S'}SHIRT.IMG` },
    ...look.equipment.map((frame) => ({ file: equipmentFile(look.gender), frame })),
  ];
}

interface Picture {
  x: number;
  y: number;
  image: HTMLCanvasElement;
}

export class Portraits {
  private readonly files = new Map<string, Promise<Picture[]>>();
  private palette: Promise<Palette> | undefined;
  /** Which drawing each canvas shows last, so a slow one doesn't cover a newer one. */
  private readonly drawing = new WeakMap<HTMLCanvasElement, number>();
  private draws = 0;

  constructor(private readonly data: GameData) {}

  /**
   * Draws the doll on `canvas`, sized to the doll. Resolves false when its
   * pictures are missing, and undefined when a newer drawing on the same
   * canvas came first.
   */
  async drawDoll(canvas: HTMLCanvasElement, look: DollLook): Promise<boolean | undefined> {
    const ticket = ++this.draws;
    this.drawing.set(canvas, ticket);
    const layers = await Promise.all(dollLayers(look).map((l) => this.picture(l)));
    const steel = look.weapon && weaponModelDefinition(look.weapon) ? await steelWeaponThumbnail(look.weapon) : undefined;
    if (this.drawing.get(canvas) !== ticket) return undefined;
    canvas.width = DOLL_WIDTH;
    canvas.height = DOLL_HEIGHT;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, DOLL_WIDTH, DOLL_HEIGHT);
    // Without the background, there is no doll to speak of.
    if (!layers[0]) return false;
    for (let i = 0; i < layers.length; i++) {
      const p = layers[i];
      if (!p) continue;
      if (steel && i >= 4 && look.equipment[i - 4] === look.weapon?.type) {
        ctx.drawImage(steel, p.x - DOLL_LEFT, p.y, p.image.width, p.image.height);
      } else ctx.drawImage(p.image, p.x - DOLL_LEFT, p.y);
    }
    return true;
  }

  /** Crops the actual paper doll around the chosen face, including worn headgear. */
  async drawHead(canvas:HTMLCanvasElement,look:DollLook):Promise<boolean|undefined> {
    const ticket=++this.draws;this.drawing.set(canvas,ticket);
    const face=await this.picture({file:`${look.gender==='female'?'FACESF1':'FACES1'}${look.race}.CIF`,frame:look.face});
    if(!face)return false;
    const doll=document.createElement('canvas');
    const drawn=await this.drawDoll(doll,{...look,weapon:undefined});
    if(this.drawing.get(canvas)!==ticket)return undefined;
    if(!drawn)return false;
    canvas.width=canvas.height=80;
    const ctx=canvas.getContext('2d')!;ctx.imageSmoothingEnabled=false;
    const width=face.image.width+8,height=face.image.height+8,scale=Math.max(80/width,80/(height*PIXEL_ASPECT));
    const w=width*scale,h=height*PIXEL_ASPECT*scale;
    ctx.drawImage(doll,face.x-DOLL_LEFT-4,face.y-4,width,height,(80-w)/2,(80-h)/2,w,h);
    return true;
  }

  /** The picture of one item, cut to its own size; undefined when missing. */
  async item(frame: number, gender: Gender): Promise<HTMLCanvasElement | undefined> {
    return (await this.picture({ file: equipmentFile(gender), frame }))?.image;
  }

  /** The map of Tamriel that races are chosen on, 320x200; undefined when missing. */
  async map(): Promise<HTMLCanvasElement | undefined> {
    return (await this.picture({ file: 'TAMRIEL.MNU' }))?.image;
  }

  /**
   * The piece Arena draws over the map's Exit while a character is being made
   * (NOEXIT.IMG), with where it goes. It has no colours of its own: it is
   * drawn in the map's.
   */
  async noExit(): Promise<{ x: number; y: number; image: HTMLCanvasElement } | undefined> {
    if (!this.data.has('NOEXIT.IMG') || !this.data.has('TAMRIEL.MNU')) return undefined;
    try {
      const [piece, map] = await Promise.all([this.data.read('NOEXIT.IMG'), this.data.read('TAMRIEL.MNU')]).then((files) => files.map(parseImg));
      if (!map.palette) return undefined;
      return { x: piece.xOffset, y: piece.yOffset, image: toCanvas(piece, parseCol(map.palette)) };
    } catch (err) {
      console.warn('Could not load NOEXIT.IMG:', err);
      return undefined;
    }
  }

  private async picture(layer: Layer): Promise<Picture | undefined> {
    return (await this.load(layer.file))[layer.frame ?? 0];
  }

  private load(file: string): Promise<Picture[]> {
    let p = this.files.get(file);
    if (!p) {
      p = (async () => {
        if (!this.data.has(file)) return [];
        const bytes = await this.data.read(file);
        const images = file.endsWith('.CIF') ? parseCif(bytes) : [parseImg(bytes)];
        const sheet = await this.sheetPalette();
        return images.map((img) => ({ x: img.xOffset, y: img.yOffset, image: toCanvas(img, img.palette ? parseCol(img.palette) : sheet) }));
      })().catch((err) => {
        console.warn(`Could not load ${file}:`, err);
        return [];
      });
      this.files.set(file, p);
    }
    return p;
  }

  private sheetPalette(): Promise<Palette> {
    this.palette ??= (async () => {
      for (const name of ['CHARSHT.COL', 'PAL.COL']) {
        try {
          if (this.data.has(name)) return parseCol(await this.data.read(name));
        } catch (err) {
          console.warn(`Could not read ${name}:`, err);
        }
      }
      // Grey ramp: something to see rather than nothing.
      const grey = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) grey.set([i, i, i, 255], i * 4);
      return grey;
    })();
    return this.palette;
  }
}

function toCanvas(img: IndexedImage, palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const pixels = new ImageData(img.width, img.height);
  pixels.data.set(indicesToRgba(img.pixels, palette, true));
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  return canvas;
}
