/**
 * INF level definition reader.
 *
 * INF files are text. Copies inside GLOBAL.BSA are XOR-encrypted with an
 * 8-byte key where each byte is offset by its position; plain ones start with
 * '@'. Sections we use:
 *   @FLOORS / @WALLS  - texture file names, in index order. "walla.set #5"
 *                       means a 5-frame SET, and each frame takes its own
 *                       index. "*BOXCAP 3", "*DOOR 0", "*WETCHASM" style tags
 *                       precede entries with special roles. In @FLOORS,
 *                       "*CEILING height boxScale outdoor" marks the next
 *                       texture as the ceiling's and sets the room height in
 *                       Arena units (100 when missing) and the scale, out of
 *                       256, of the raised platforms' thickness.
 *   @FLATS            - sprite names (decoration, creatures). "*ITEM n" marks
 *                       the next one as an item: 1 key, 2 corpse, 3 equipment,
 *                       4-6 treasure, 7-8 chests, 32+ creature n - 32. After
 *                       the name, "F:n" flags (1 solid, 2 reflects like a
 *                       puddle, 4 triple size, 8 dark, 16 see-through, 32
 *                       hangs from the ceiling, 64 one and a half times the
 *                       size), "S:n" the light it gives, in voxels, and
 *                       "Y:n" how far it is raised (negative is up).
 * As OpenTESArena reads them (INFFile.cpp).
 *   @SOUND            - "drip1.voc 16": the sound files MIF triggers play
 *   @TEXT             - "*TEXT n" entries that MIF triggers show. "~" in front
 *                       means show once; "+n" is not shown but names key n.
 */
const KEY = [0xea, 0x7b, 0x4e, 0xbd, 0x19, 0xc9, 0x38, 0x99];

export function decryptInf(data: Uint8Array): Uint8Array {
  if (data[0] === 0x40) return data; // already plain text ('@')
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ((KEY[i % 8] + i) & 0xff);
  return out;
}

export interface InfTexture {
  /** File name, e.g. "WALLA.SET" or "WALL04.IMG". */
  file: string;
  /** Number of 64x64 frames when the entry is a SET ("walla.set #5"); each frame takes its own texture index. */
  frames: number;
}

export interface InfRole {
  /** Number after the tag, e.g. 3 for "*BOXCAP 3". */
  arg?: number;
  /** Texture the tag applies to. */
  texture: InfTexture;
  /** Index of that texture's first frame in the expanded list. */
  index: number;
}

export interface InfFlat {
  /** Sprite file, e.g. "BARREL.IMG" or "TORCHPST.DFA". */
  name: string;
  /** "Y:-35" modifier: vertical offset in Arena units (negative is up). */
  yOffset?: number;
  /** "F:n" flags (see the module comment). */
  solid?: boolean;
  puddle?: boolean;
  /** Drawn at this times its size: 3 or 1.5. */
  scale?: number;
  dark?: boolean;
  seeThrough?: boolean;
  /** Hangs from the ceiling. */
  ceiling?: boolean;
  /** "S:n": the radius of the light it gives, in voxels. */
  light?: number;
  /** "*ITEM n" before the entry: what kind of item it stands for (see the module comment). */
  item?: number;
}

export interface InfFile {
  /** Floor textures, in file order (not expanded; see expandTextures). */
  floors: InfTexture[];
  /** Wall textures, in file order (not expanded; see expandTextures). */
  walls: InfTexture[];
  flats: InfFlat[];
  /** Ceiling height in Arena units, when the INF sets one. */
  ceilingHeight?: number;
  /** The raised platforms' thickness scale out of 256, when the INF sets one. */
  boxScale?: number;
  /** Index of the ceiling's texture in the expanded floor list, when the INF names one. */
  ceilingTexture?: number;
  /** Tags such as BOXCAP, BOXSIDE, DOOR, LEVELUP, WETCHASM, keyed by tag. */
  roles: Record<string, InfRole[]>;
  /** @TEXT entries keyed by their "*TEXT n" number (what MIF triggers show). */
  texts: Record<number, string>;
  /** @SOUND entries: sound file by the number MIF triggers use. */
  sounds: Record<number, string>;
  raw: string;
}

export function parseInf(data: Uint8Array): InfFile {
  const plain = decryptInf(data);
  let text = '';
  for (const b of plain) text += String.fromCharCode(b);
  const lines = text.split(/\r?\n/);

  const inf: InfFile = { floors: [], walls: [], flats: [], roles: {}, texts: {}, sounds: {}, raw: text };
  let item: number | undefined;
  let textIndex: number | undefined;
  let section = '';
  let pending: Array<{ tag: string; arg?: number; height?: number; boxScale?: number }> = [];
  const expandedCount = { FLOORS: 0, WALLS: 0 };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (section === 'TEXT' && !line.startsWith('@')) {
      const m = /^\*TEXT\s+(\d+)/i.exec(line);
      if (m) {
        textIndex = parseInt(m[1], 10);
        inf.texts[textIndex] = '';
      } else if (textIndex !== undefined) {
        inf.texts[textIndex] += (inf.texts[textIndex] ? '\n' : '') + rawLine.replace(/\s+$/, '');
      }
      continue;
    }
    if (line.startsWith('@')) {
      section = line.slice(1).split(/\s+/)[0].toUpperCase();
      pending = [];
      continue;
    }
    if (line.startsWith(';')) continue;

    if (section === 'FLOORS' || section === 'WALLS') {
      if (line.startsWith('*')) {
        const [tag, ...args] = line.slice(1).split(/\s+/);
        const n = args.map((a) => parseInt(a, 10));
        const num = (i: number) => (Number.isNaN(n[i]) ? undefined : n[i]);
        pending.push({ tag: tag.toUpperCase(), arg: num(0), height: num(0), boxScale: num(1) });
        continue;
      }
      const tex = parseTextureLine(line);
      if (!tex) continue;
      const index = expandedCount[section];
      for (const p of pending) {
        if (p.tag === 'CEILING' && section === 'FLOORS') {
          inf.ceilingTexture = index;
          if (p.height !== undefined) inf.ceilingHeight = p.height;
          if (p.boxScale !== undefined) inf.boxScale = p.boxScale;
        } else (inf.roles[p.tag] ??= []).push({ arg: p.arg, texture: tex, index });
      }
      pending = [];
      (section === 'FLOORS' ? inf.floors : inf.walls).push(tex);
      expandedCount[section] += tex.frames;
    } else if (section === 'FLATS') {
      if (line.startsWith('*')) {
        const m = /^\*ITEM\s+(\d+)/i.exec(line);
        if (m) item = parseInt(m[1], 10);
        continue;
      }
      const [rawName, ...mods] = line.split(/\s+/);
      // A dash in front of the name is in some files; what it means is not known.
      const name = rawName.replace(/^-/, '');
      if (!/\.(IMG|CFA|DFA)$/i.test(name)) continue;
      const flat: InfFlat = { name: name.toUpperCase() };
      for (const mod of mods) {
        const m = /^([FSY]):(-?\d+)$/i.exec(mod);
        if (!m) continue;
        const value = parseInt(m[2], 10);
        const kind = m[1].toUpperCase();
        if (kind === 'Y') flat.yOffset = value;
        else if (kind === 'S') flat.light = value;
        else {
          if (value & 1) flat.solid = true;
          if (value & 2) flat.puddle = true;
          if (value & 4) flat.scale = 3;
          else if (value & 64) flat.scale = 1.5;
          if (value & 8) flat.dark = true;
          if (value & 16) flat.seeThrough = true;
          if (value & 32) flat.ceiling = true;
        }
      }
      if (item !== undefined) flat.item = item;
      item = undefined;
      inf.flats.push(flat);
    } else if (section === 'SOUND') {
      const m = /^(\S+\.VOC)\s+(\d+)/i.exec(line);
      if (m) inf.sounds[parseInt(m[2], 10)] = m[1].toUpperCase();
    }
  }
  return inf;
}

/** One entry per texture index: SETs contribute one entry per frame. */
export function expandTextures(list: InfTexture[]): Array<{ file: string; frame: number }> {
  const out: Array<{ file: string; frame: number }> = [];
  for (const t of list) for (let f = 0; f < t.frames; f++) out.push({ file: t.file, frame: f });
  return out;
}

/** Finds the texture tagged with e.g. "*BOXCAP 3". */
export function roleTexture(inf: InfFile, tag: string, arg?: number): InfRole | undefined {
  return inf.roles[tag]?.find((r) => r.arg === arg);
}

function parseTextureLine(line: string): InfTexture | undefined {
  // e.g. "walla.set	#5" or "door_1.img" (sometimes followed by comments)
  const m = /^([A-Za-z0-9_\-]+\.(?:IMG|SET))(?:\s*#\s*(\d+))?/i.exec(line);
  if (!m) return undefined;
  return { file: m[1].toUpperCase(), frames: m[2] !== undefined ? Math.max(1, parseInt(m[2], 10)) : 1 };
}
