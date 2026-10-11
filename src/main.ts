import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/barlow-condensed/latin-300.css';
import '@fontsource/barlow-condensed/latin-400.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import * as THREE from 'three';
import { desktop, type DesktopFolder } from './data/desktop';
import {
  GameData,
  sourceFromDirectoryHandle,
  sourceFromFileList,
  sourceFromPaths,
  validateFolder,
  type FileSource,
} from './data/files';
import { ensureReadPermission, loadFolderHandle, pickDirectory, saveFolderHandle, supportsDirectoryPicker } from './data/rememberFolder';
import { parseCol } from './formats/palette';
import { parseMif } from './formats/mif';
import { parseInf } from './formats/inf';
import { buildLevel } from './game/level';
import { Engine } from './game/engine';
import { GamepadInput } from './input/gamepad';
import { TextureCache } from './render/textures';
import { buildLevelScene } from './render/levelScene';
import { backdropLevel } from './render/backdrop';
import { BINDINGS, GAME_ACTIONS, InputModeWatcher, type InputMode } from './ui/controls';
import { Hud } from './ui/hud';
import { MenuNav } from './ui/menu';
import { bindSettingRows, loadSettings } from './ui/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu');
const hudEl = $('hud');
const status = $('status');
const checks = $<HTMLUListElement>('checks');
const folderError = $('folder-error');
const mapSelect = $<HTMLSelectElement>('map-select');
const playButton = $<HTMLButtonElement>('play');
const resumeButton = $<HTMLButtonElement>('resume');
const canvas = $<HTMLCanvasElement>('view');

const DEFAULT_MAP = 'START.MIF';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const pad = new GamepadInput();
const input = new InputModeWatcher();
const hud = new Hud(hudEl);
const settings = loadSettings();
let data: GameData | undefined;
let engine: Engine | undefined;
/** The map being played; undefined while only the backdrop runs. */
let engineMap: string | undefined;
let tipsShown = false;

const playing = () => engineMap !== undefined;

// ---- Menu screens ----

type Screen = 'folder' | 'play' | 'controls';
const screens: Record<Screen, HTMLElement> = {
  folder: $('screen-folder'),
  play: $('screen-play'),
  controls: $('screen-controls'),
};
let screen: Screen = 'folder';
let screenBeforeControls: Screen = 'folder';

const nav = new MenuNav(menu, pad, input, {
  back: () => {
    if (screen === 'controls') showScreen(screenBeforeControls);
    else if (playing()) resume();
  },
  resume: () => {
    if (playing()) resume();
  },
});

function showScreen(next: Screen) {
  if (next === 'controls' && screen !== 'controls') screenBeforeControls = screen;
  screen = next;
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== next;
  menu.dataset.screen = next;
  updateHints();
  nav.focusFirst();
}

/** The button hints along the bottom: Back closes the Controls screen, or returns to the game. */
function updateHints() {
  $('hint-back').hidden = screen !== 'controls' && !playing();
  $('hint-back-label').textContent = screen === 'controls' ? 'Back' : 'Resume';
  $('hint-change').hidden = screen === 'folder';
}

function updatePlayOptions() {
  resumeButton.hidden = !playing();
  playButton.textContent = playing() && mapSelect.value === engineMap ? 'Start over' : 'Enter the dungeon';
  updateHints();
}

/** Lists every in-game action with its keys and its controller buttons. */
function fillBindings() {
  const row = (action: (typeof GAME_ACTIONS)[number]) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = BINDINGS[action].label;
    const cells = (['keyboard', 'gamepad'] as InputMode[]).map((mode) => {
      const td = document.createElement('td');
      const glyphs = document.createElement('span');
      glyphs.dataset.glyph = action;
      glyphs.dataset.glyphMode = mode;
      td.append(glyphs);
      return td;
    });
    tr.append(name, ...cells);
    return tr;
  };
  $('bindings').replaceChildren(...GAME_ACTIONS.map(row));
  input.render($('bindings'));
}

// ---- Game ----

/** Stops the running engine (map or backdrop) and makes `next` the current one. */
function setEngine(next?: Engine, map?: string) {
  engine?.dispose();
  engine = next;
  engineMap = map;
}

/** Shows the generated hall behind the menu until a real map is loaded. */
async function showBackdrop() {
  const { level, textures } = backdropLevel();
  const scene = await buildLevelScene(level, textures);
  if (engine) return; // a map started while the backdrop was building
  setEngine(new Engine(renderer, level, scene, { autopilot: true }));
  engine!.start();
}

function setStatus(text: string) {
  status.textContent = text;
}

async function startMap(name: string) {
  if (!data) return;
  setEngine(undefined);
  hud.reset();
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
    const next = new Engine(renderer, level, scene, { pad, hud, controls: settings });
    next.onPause = pause;
    setEngine(next, name);
    if (import.meta.env.DEV) (window as unknown as { arenaEngine?: Engine }).arenaEngine = next;
    if (scene.skippedFlats.length) {
      console.info(`Not drawn yet (animated sprites and creatures): ${[...new Set(scene.skippedFlats)].join(', ')}`);
    }
    setStatus(`${level.name || name} · ${level.width}×${level.depth}`);
    resume();
    if (!tipsShown) {
      tipsShown = true;
      hud.showTips();
    }
  } catch (err) {
    console.error(err);
    setStatus(`Could not load ${name}: ${(err as Error).message}`);
    void showBackdrop();
  } finally {
    playButton.disabled = false;
    updatePlayOptions();
  }
}

function resume() {
  if (!engine || !playing()) return;
  menu.hidden = true;
  hudEl.hidden = false;
  engine.start();
}

function pause() {
  engine?.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  hudEl.hidden = true;
  menu.hidden = false;
  updatePlayOptions();
  nav.opened();
  showScreen('play');
}

/**
 * Reads the controller for the menu and the button prompts, every frame. The running
 * map reads it too, in the same frame, and gets the same presses.
 */
let padWasConnected = false;
function uiFrame(now: number) {
  pad.poll(now);
  input.update(pad);
  if (!menu.hidden) nav.frame(now);
  // Like Skyrim, pause if the controller goes away mid-game.
  else if (padWasConnected && !pad.connected && playing()) pause();
  padWasConnected = pad.connected;
  requestAnimationFrame(uiFrame);
}

// ---- Folder selection ----

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

/** Checks and opens a folder; true when the game can be played from it. */
async function useSource(source: FileSource): Promise<boolean> {
  folderError.hidden = true;
  const names = source.names();
  if (!showChecks(names)) {
    folderError.textContent = names.length
      ? 'Some required files are missing. Pick the ARENA folder, the one that contains GLOBAL.BSA.'
      : 'That folder is empty.';
    folderError.hidden = false;
    setStatus('');
    return false;
  }
  setStatus('Reading GLOBAL.BSA…');
  try {
    data = await GameData.open(source);
  } catch (err) {
    folderError.textContent = `Could not read the game data: ${(err as Error).message}`;
    folderError.hidden = false;
    setStatus('');
    return false;
  }
  const maps = data.mapNames();
  mapSelect.replaceChildren(
    ...maps.map((m) => {
      const o = document.createElement('option');
      o.value = o.textContent = m;
      if (m === DEFAULT_MAP) o.selected = true;
      return o;
    }),
  );
  updatePlayOptions();
  showScreen('play');
  setStatus(`Found ${data.bsa.entries.length} files in GLOBAL.BSA.`);
  return true;
}

const reuseButton = $<HTMLButtonElement>('reuse-folder');
const pickButton = $<HTMLButtonElement>('pick-folder');
const fallbackLabel = $('pick-fallback');
const folderInput = $<HTMLInputElement>('folder-input');

/** Browsers open their folder pickers only for a click or a key press, not for a controller button. */
function needsClick(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (!activation || activation.isActive) return false;
  setStatus('Use the mouse or keyboard for this one: browsers only open their folder picker for a click or a key press.');
  return true;
}

async function useHandle(handle: FileSystemDirectoryHandle) {
  setStatus('Scanning folder…');
  await useSource(await sourceFromDirectoryHandle(handle));
}

async function useDesktopFolder(opening: Promise<DesktopFolder | null>) {
  let folder: DesktopFolder | null;
  try {
    folder = await opening;
  } catch (err) {
    // Electron prefixes errors from the main process with "Error invoking remote method '…': Error: ".
    folderError.textContent = `Could not open that folder: ${(err as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}`;
    folderError.hidden = false;
    return;
  }
  if (!folder || !desktop) return;
  setStatus(`Scanning ${folder.path}…`);
  if (await useSource(sourceFromPaths(folder.files, desktop.readFile))) await desktop.rememberFolder();
}

// Embedded pages (cross-origin frames) may not open the native folder picker, so use the upload-style one there.
const embedded = window.self !== window.top;

if (desktop) {
  // The desktop app reads the folder itself and opens the one from last time on launch.
  const bridge = desktop;
  pickButton.addEventListener('click', () => useDesktopFolder(bridge.chooseFolder()));
  void useDesktopFolder(bridge.reopenFolder());
  for (const quit of document.querySelectorAll<HTMLButtonElement>('.quit')) {
    quit.hidden = false;
    quit.addEventListener('click', () => void bridge.quit());
  }
} else if (supportsDirectoryPicker() && !embedded) {
  pickButton.addEventListener('click', async () => {
    if (needsClick()) return;
    try {
      const handle = await pickDirectory();
      await saveFolderHandle(handle);
      await useHandle(handle);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      // Some embedded pages block the folder picker; the upload-style picker still works there.
      pickButton.hidden = true;
      fallbackLabel.hidden = false;
      fallbackLabel.focus();
      setStatus('This page cannot open the folder picker, so use the button again to choose the folder.');
    }
  });
  loadFolderHandle().then((handle) => {
    if (!handle) return;
    reuseButton.hidden = false;
    reuseButton.textContent = `Use "${handle.name}" again`;
    reuseButton.addEventListener('click', async () => {
      if (needsClick()) return;
      if (await ensureReadPermission(handle)) await useHandle(handle);
      else setStatus('Access to the folder was not allowed.');
    });
    if (screen === 'folder') nav.focusFirst();
  });
} else {
  pickButton.hidden = true;
  fallbackLabel.hidden = false;
}

fallbackLabel.addEventListener('click', (e) => {
  if (e.target === fallbackLabel && needsClick()) e.preventDefault();
});
folderInput.addEventListener('change', async () => {
  if (folderInput.files?.length) await useSource(sourceFromFileList(folderInput.files));
});

$('change-folder').addEventListener('click', () => {
  setEngine(undefined);
  void showBackdrop();
  data = undefined;
  updatePlayOptions();
  showScreen('folder');
  setStatus('');
});

for (const el of document.querySelectorAll<HTMLElement>('[data-screen]')) {
  el.addEventListener('click', () => showScreen(el.dataset.screen as Screen));
}
for (const el of document.querySelectorAll<HTMLElement>('[data-back]')) {
  el.addEventListener('click', () => showScreen(screenBeforeControls));
}

resumeButton.addEventListener('click', resume);
playButton.addEventListener('click', () => startMap(mapSelect.value));
mapSelect.addEventListener('change', updatePlayOptions);
// Choosing the map list itself (A on a controller, or Enter) plays the map picked in it.
mapSelect.addEventListener('choose', () => startMap(mapSelect.value));

bindSettingRows(screens.controls, settings);
fillBindings();
showScreen('folder');
void showBackdrop();
requestAnimationFrame(uiFrame);
