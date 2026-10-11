/**
 * Access to the player's own Arena folder.
 *
 * The remake ships no game data. The player picks the folder that holds
 * GLOBAL.BSA, and every asset is read from it at runtime. Lookups are
 * case-insensitive by base name (DOS file names), and loose files take
 * priority over GLOBAL.BSA entries, as in the original game.
 */
import { BsaArchive } from '../formats/bsa';

export interface FileSource {
  /** Upper-case base names of every file in the chosen folder. */
  names(): string[];
  read(name: string): Promise<Uint8Array>;
}

export interface RequiredFile {
  /** Any one of these names satisfies the requirement. */
  anyOf: string[];
  why: string;
}

export const REQUIRED_FILES: RequiredFile[] = [
  { anyOf: ['GLOBAL.BSA'], why: 'textures, maps and sounds archive' },
  { anyOf: ['ACD.EXE', 'A.EXE'], why: 'game executable (CD or floppy version)' },
  { anyOf: ['PAL.COL'], why: 'main colour palette' },
  { anyOf: ['TEMPLATE.DAT'], why: 'dialogue templates' },
  { anyOf: ['QUESTION.TXT'], why: 'character creation questions' },
  { anyOf: ['CITYDATA.65'], why: 'new-game city data' },
  { anyOf: ['SPELLSG.65'], why: 'new-game spell data' },
  { anyOf: ['ARENAFNT.DAT', 'FONT_A.DAT'], why: 'font' },
];

export interface ValidationResult {
  ok: boolean;
  checks: Array<RequiredFile & { found?: string }>;
}

export function validateFolder(names: Iterable<string>): ValidationResult {
  const set = new Set([...names].map((n) => n.toUpperCase()));
  const checks = REQUIRED_FILES.map((req) => ({ ...req, found: req.anyOf.find((n) => set.has(n)) }));
  return { ok: checks.every((c) => c.found), checks };
}

/**
 * Save-slot and runtime files a played copy carries. They are never game
 * data, so they are left out of the index: save slots and their per-slot
 * copies use two-digit extensions (".65" is the new-game template and is
 * kept), temp files use "$" extensions, plus DOSBox/driver state.
 */
export function isRuntimeFile(baseName: string): boolean {
  const upper = baseName.toUpperCase();
  const ext = upper.includes('.') ? upper.slice(upper.lastIndexOf('.') + 1) : '';
  if (/^\d\d$/.test(ext) && ext !== '65') return true;
  if (ext.startsWith('$')) return true;
  return upper === 'SOUND.CFG' || upper === 'VISION.EMS';
}

/**
 * Indexes the files of a picked folder by upper-case path relative to the
 * folder that holds GLOBAL.BSA. The data sits at different depths in each
 * release (Steam: <root>/ARENA, GamesNostalgia Windows: <root>/arena,
 * Mac: <root>/game/Resources/arena) and name case varies, so the player can
 * pick any folder above it. When several copies are present, the shallowest
 * GLOBAL.BSA wins.
 */
export function indexGameFolder<T>(entries: Iterable<{ path: string; value: T }>): Map<string, T> {
  const all = [...entries].map((e) => ({ path: e.path.replace(/\\/g, '/').toUpperCase(), value: e.value }));
  let root: string | undefined;
  for (const e of all) {
    if (e.path !== 'GLOBAL.BSA' && !e.path.endsWith('/GLOBAL.BSA')) continue;
    const dir = e.path.slice(0, e.path.length - 'GLOBAL.BSA'.length);
    if (root === undefined || dir.split('/').length < root.split('/').length) root = dir;
  }
  const index = new Map<string, T>();
  for (const e of all) {
    if (root !== undefined && !e.path.startsWith(root)) continue;
    const key = root !== undefined ? e.path.slice(root.length) : e.path;
    const base = key.slice(key.lastIndexOf('/') + 1);
    if (isRuntimeFile(base) || index.has(key)) continue;
    index.set(key, e.value);
  }
  return index;
}

/** Indexes `entries` (see indexGameFolder) and reads each file through `read`. */
function indexedSource<T>(entries: Iterable<{ path: string; value: T }>, read: (value: T) => Promise<Uint8Array>): FileSource {
  const index = indexGameFolder(entries);
  return {
    names: () => [...index.keys()],
    read: async (name) => {
      const value = index.get(name.toUpperCase());
      if (value === undefined) throw new Error(`${name} is not in the chosen folder`);
      return read(value);
    },
  };
}

/** Builds a source from <input type="file" webkitdirectory> results. */
export function sourceFromFileList(files: Iterable<File>): FileSource {
  // webkitRelativePath starts with the picked folder's own name; drop it.
  return indexedSource(
    [...files].map((f) => ({ path: relPath(f).split('/').slice(1).join('/') || f.name, value: f })),
    async (f) => new Uint8Array(await f.arrayBuffer()),
  );
}

/** How many folder levels below the picked one are searched for GLOBAL.BSA. */
const MAX_DEPTH = 4;

/** Builds a source from a File System Access API directory handle (Chromium). */
export async function sourceFromDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<FileSource> {
  const entries: Array<{ path: string; value: FileSystemFileHandle }> = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    for await (const [name, handle] of d.entries()) {
      if (handle.kind === 'file') entries.push({ path: prefix + name, value: handle as FileSystemFileHandle });
      else if (depth < MAX_DEPTH) await walk(handle as FileSystemDirectoryHandle, prefix + name + '/', depth + 1);
    }
  };
  await walk(dir, '', 0);
  return indexedSource(entries, async (h) => new Uint8Array(await (await h.getFile()).arrayBuffer()));
}

/**
 * Builds a source from paths relative to the picked folder, read by `read`
 * with the path as listed (the desktop app lists and reads files itself).
 */
export function sourceFromPaths(paths: Iterable<string>, read: (path: string) => Promise<Uint8Array>): FileSource {
  return indexedSource([...paths].map((path) => ({ path, value: path })), read);
}

/** Game data: loose files first, then GLOBAL.BSA. */
export class GameData {
  private constructor(
    private readonly source: FileSource,
    readonly bsa: BsaArchive,
    private readonly loose: Set<string>,
  ) {}

  static async open(source: FileSource): Promise<GameData> {
    const bsa = new BsaArchive(await source.read('GLOBAL.BSA'));
    return new GameData(source, bsa, new Set(source.names()));
  }

  has(name: string): boolean {
    const n = name.toUpperCase();
    return this.loose.has(n) || this.bsa.has(n);
  }

  async read(name: string): Promise<Uint8Array> {
    const n = name.toUpperCase();
    if (this.loose.has(n)) return this.source.read(n);
    const e = this.bsa.get(n);
    if (!e) throw new Error(`${name} was not found in the Arena folder or GLOBAL.BSA`);
    return e;
  }

  /** Every map name available, loose and archived. */
  mapNames(): string[] {
    const names = new Set<string>();
    for (const n of this.loose) if (n.endsWith('.MIF') && !n.includes('/')) names.add(n);
    for (const e of this.bsa.entries) if (e.name.toUpperCase().endsWith('.MIF')) names.add(e.name.toUpperCase());
    return [...names].sort();
  }
}

function relPath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}
