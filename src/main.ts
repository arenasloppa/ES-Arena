import { GameData, sourceFromDirectoryHandle, sourceFromFileList, validateFolder, type FileSource } from './data/files';
import { ensureReadPermission, loadFolderHandle, pickDirectory, saveFolderHandle, supportsDirectoryPicker } from './data/rememberFolder';
import { parseCol } from './formats/palette';
import { parseImg } from './formats/img';
import { parseMif } from './formats/mif';
import { parseInf } from './formats/inf';
import { buildLevel } from './game/level';
import { Engine } from './game/engine';
import { TextureCache, toTexture } from './render/textures';
import { buildLevelScene } from './render/levelScene';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu');
const hud = $('hud');
const status = $('status');
const checks = $<HTMLUListElement>('checks');
const folderError = $('folder-error');
const stepFolder = $('step-folder');
const stepPlay = $('step-play');
const mapSelect = $<HTMLSelectElement>('map-select');
const playButton = $<HTMLButtonElement>('play');
const canvas = $<HTMLCanvasElement>('view');

const DEFAULT_MAP = 'START.MIF';
let data: GameData | undefined;
let engine: Engine | undefined;
let engineMap: string | undefined;

function setStatus(text: string) {
  status.textContent = text;
}

function showChecks(names: string[]) {
  const result = validateFolder(names);
  checks.replaceChildren(
    ...result.checks.map((c) => {
      const li = document.createElement('li');
      if (c.found) li.className = 'found';
      li.textContent = `${c.found ?? c.anyOf.join(' or ')} `;
      const why = document.createElement('span');
      why.textContent = `(${c.why})`;
      li.append(why);
      return li;
    }),
  );
  return result.ok;
}

async function useSource(source: FileSource) {
  folderError.hidden = true;
  const names = source.names();
  if (!showChecks(names)) {
    folderError.textContent = names.length
      ? 'Some required files are missing. Pick the folder that contains GLOBAL.BSA.'
      : 'That folder is empty.';
    folderError.hidden = false;
    return;
  }
  setStatus('Reading GLOBAL.BSA…');
  try {
    data = await GameData.open(source);
  } catch (err) {
    folderError.textContent = `Could not read the game data: ${(err as Error).message}`;
    folderError.hidden = false;
    setStatus('');
    return;
  }
  await showTitle(data);
  const maps = data.mapNames();
  mapSelect.replaceChildren(
    ...maps.map((m) => {
      const o = document.createElement('option');
      o.value = o.textContent = m;
      if (m === DEFAULT_MAP) o.selected = true;
      return o;
    }),
  );
  stepFolder.hidden = true;
  stepPlay.hidden = false;
  setStatus(`Found ${data.bsa.entries.length} files in GLOBAL.BSA.`);
}

async function showTitle(d: GameData) {
  if (!d.has('TITLE.IMG')) return;
  try {
    const img = parseImg(await d.read('TITLE.IMG'));
    const pal = parseCol(await d.read('PAL.COL'));
    const tex = toTexture(img, pal, false);
    const art = $<HTMLCanvasElement>('title-art');
    const ctx = art.getContext('2d')!;
    const src = tex.image as { data: Uint8Array; width: number; height: number };
    // toTexture flips rows for WebGL; flip back for the 2D canvas.
    const out = ctx.createImageData(src.width, src.height);
    const row = src.width * 4;
    for (let y = 0; y < src.height; y++) out.data.set(src.data.subarray((src.height - 1 - y) * row, (src.height - y) * row), y * row);
    ctx.putImageData(out, 0, 0);
    art.hidden = false;
  } catch (err) {
    console.warn('Title image failed to load:', err);
  }
}

async function startMap(name: string) {
  if (!data) return;
  if (engine && engineMap === name) {
    resume();
    return;
  }
  engine?.dispose();
  engine = undefined;
  playButton.disabled = true;
  try {
    setStatus(`Loading ${name}…`);
    const mif = parseMif(await data.read(name));
    const levelIndex = Math.min(mif.startingLevelIndex, mif.levels.length - 1);
    const infName = mif.levels[levelIndex].info;
    const inf = parseInf(await data.read(infName));
    const level = buildLevel(mif, levelIndex, inf);
    const palette = parseCol(await data.read('PAL.COL'));
    const scene = await buildLevelScene(level, new TextureCache(data, palette));
    engine = new Engine(canvas, level, scene, $('message'));
    engine.onPause = pause;
    if (import.meta.env.DEV) (window as unknown as { arenaEngine?: Engine }).arenaEngine = engine;
    engineMap = name;
    if (scene.skippedFlats.length) {
      console.info(`Not drawn yet (animated sprites and creatures): ${[...new Set(scene.skippedFlats)].join(', ')}`);
    }
    setStatus(`${level.name || name} · ${level.width}×${level.depth}`);
    resume();
  } catch (err) {
    console.error(err);
    setStatus(`Could not load ${name}: ${(err as Error).message}`);
  } finally {
    playButton.disabled = false;
  }
}

function resume() {
  menu.hidden = true;
  hud.hidden = false;
  playButton.textContent = 'Resume';
  engine?.start();
}

function pause() {
  engine?.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  menu.hidden = false;
  hud.hidden = true;
}

// ---- Folder selection ----

const reuseButton = $<HTMLButtonElement>('reuse-folder');
const pickButton = $<HTMLButtonElement>('pick-folder');
const fallbackLabel = $('pick-fallback');
const folderInput = $<HTMLInputElement>('folder-input');

async function useHandle(handle: FileSystemDirectoryHandle) {
  setStatus('Scanning folder…');
  await useSource(await sourceFromDirectoryHandle(handle));
}

if (supportsDirectoryPicker()) {
  pickButton.addEventListener('click', async () => {
    try {
      const handle = await pickDirectory();
      await saveFolderHandle(handle);
      await useHandle(handle);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setStatus(`Could not open folder: ${(err as Error).message}`);
    }
  });
  loadFolderHandle().then((handle) => {
    if (!handle) return;
    reuseButton.hidden = false;
    reuseButton.textContent = `Use "${handle.name}" again`;
    reuseButton.addEventListener('click', async () => {
      if (await ensureReadPermission(handle)) await useHandle(handle);
      else setStatus('Access to the folder was not allowed.');
    });
  });
} else {
  pickButton.hidden = true;
  fallbackLabel.hidden = false;
}

folderInput.addEventListener('change', async () => {
  if (folderInput.files?.length) await useSource(sourceFromFileList(folderInput.files));
});

$('change-folder').addEventListener('click', () => {
  engine?.dispose();
  engine = undefined;
  engineMap = undefined;
  data = undefined;
  playButton.textContent = 'Enter the dungeon';
  stepPlay.hidden = true;
  stepFolder.hidden = false;
  setStatus('');
});

playButton.addEventListener('click', () => startMap(mapSelect.value));
mapSelect.addEventListener('change', () => {
  playButton.textContent = mapSelect.value === engineMap ? 'Resume' : 'Enter the dungeon';
});
