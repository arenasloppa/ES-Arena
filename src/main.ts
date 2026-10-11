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
import { SoundBank } from './audio/sound';
import { readExeData, type ExeData } from './formats/exe';
import { parseCol } from './formats/palette';
import { parseMif } from './formats/mif';
import { parseInf } from './formats/inf';
import { unpackExe, UnsupportedExeError } from './formats/pklite';
import { Dungeon } from './game/dungeon';
import { buildLevel } from './game/level';
import { Engine } from './game/engine';
import { GamepadInput } from './input/gamepad';
import { CreatureView } from './render/creatureView';
import { TextureCache } from './render/textures';
import { buildLevelScene } from './render/levelScene';
import { MapView } from './render/mapView';
import { WeaponView } from './render/weaponView';
import { backdropLevel } from './render/backdrop';
import { BINDINGS, GAME_ACTIONS, InputModeWatcher, type InputMode } from './ui/controls';
import { Hud } from './ui/hud';
import { MenuNav } from './ui/menu';
import { Minimap } from './ui/minimap';
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
const mapButton = $<HTMLButtonElement>('open-map');
const mapScreen = $('map-screen');
const canvas = $<HTMLCanvasElement>('view');

const DEFAULT_MAP = 'START.MIF';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const pad = new GamepadInput();
const input = new InputModeWatcher();
const hud = new Hud(hudEl);
const settings = loadSettings();
let data: GameData | undefined;
/** Creature and weapon tables from the game's program, once read; null when they could not be. */
let tables: ExeData | null | undefined;
let sounds: SoundBank | undefined;
/** Textures of the map being played, freed with it. */
let textures: TextureCache | undefined;
let engine: Engine | undefined;
/** The map being played; undefined while only the backdrop runs. */
let engineMap: string | undefined;
let tipsShown = false;

/** True while a map is being played and the player is still in it. */
const playing = () => engineMap !== undefined && !engine?.dungeon.outcome;

// ---- Menu screens ----

type Screen = 'folder' | 'play' | 'controls' | 'dead' | 'escaped';
const screens: Record<Screen, HTMLElement> = {
  folder: $('screen-folder'),
  play: $('screen-play'),
  controls: $('screen-controls'),
  dead: $('screen-dead'),
  escaped: $('screen-escaped'),
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
  $('hint-change').hidden = screen !== 'play' && screen !== 'controls';
}

function updatePlayOptions() {
  resumeButton.hidden = !playing();
  mapButton.hidden = !playing();
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
  if (engine !== next) {
    textures?.dispose();
    textures = undefined;
  }
  engine = next;
  engineMap = map;
}

/** Shows the generated hall behind the menu until a real map is loaded. */
async function showBackdrop() {
  const { level, textures: provider } = backdropLevel();
  const scene = await buildLevelScene(level, provider);
  if (engine) return; // a map started while the backdrop was building
  setEngine(new Engine(renderer, new Dungeon(level, undefined), scene, { autopilot: true }));
  engine!.start();
}

function setStatus(text: string) {
  status.textContent = text;
}

/**
 * Reads the creature and weapon tables from the game's program, unpacking it
 * first when it is packed (the CD version's ACD.EXE is). Without them the
 * dungeons have no monsters, but can still be explored.
 */
async function loadTables(game: GameData): Promise<ExeData | null> {
  for (const name of ['ACD.EXE', 'A.EXE']) {
    if (!game.has(name)) continue;
    try {
      const file = await game.read(name);
      let image: Uint8Array;
      try {
        image = unpackExe(file);
      } catch (err) {
        if (!(err instanceof UnsupportedExeError)) throw err;
        image = file; // not packed
      }
      return readExeData(image);
    } catch (err) {
      console.warn(`Could not read the creature tables from ${name}:`, err);
    }
  }
  return null;
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
    // Arena's first dungeon, under the Imperial Palace.
    if (name === DEFAULT_MAP) level.name = 'Imperial Dungeons';
    const palette = parseCol(await data.read('PAL.COL'));
    if (tables === undefined) tables = await loadTables(data);
    const cache = new TextureCache(data, palette);
    const dungeon = new Dungeon(level, tables ?? undefined);
    const scene = await buildLevelScene(level, cache);
    const creatures = await CreatureView.create(dungeon.creatures, (stem) => cache.creature(stem));
    const weapon = new WeaponView($<HTMLCanvasElement>('weapon'), (file) => cache.screenImages(file));
    await weapon.use(dungeon.stats.weapon.cif);
    weapon.useBlood(await cache.screenAnimation('BLOODEXP.CFA'));
    const next = new Engine(renderer, dungeon, scene, {
      pad,
      hud,
      controls: settings,
      creatures,
      weapon,
      sounds,
      map: new MapView(dungeon, scene.material, $('map-north')),
      minimap: new Minimap($<HTMLCanvasElement>('minimap'), dungeon),
    });
    next.onPause = pause;
    next.onDeath = died;
    next.onEscape = escaped;
    next.onMap = (open) => {
      mapScreen.hidden = !open;
      hudEl.hidden = open;
    };
    setEngine(next, name);
    textures = cache;
    $('map-name').textContent = level.name || name;
    if (import.meta.env.DEV) (window as unknown as { arenaEngine?: Engine }).arenaEngine = next;
    if (scene.skippedFlats.length) {
      console.info(`Not drawn yet (animated sprites): ${[...new Set(scene.skippedFlats)].join(', ')}`);
    }
    setStatus(`${level.name || name} · ${level.width}×${level.depth}`);
    if (!tables && level.creatures.length) {
      hud.notify('The monsters could not be read from the game program, so this dungeon is empty');
    }
    // Fade in from black, with the place's name across the top, as Skyrim does on arrival.
    hud.fade(1, 0);
    resume();
    hud.fade(0, 1.4);
    hud.banner(level.name || name);
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

/** Shows the menu over the game, with the run's progress under the options. */
function showMenu(next: Screen) {
  engine?.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  hudEl.hidden = true;
  mapScreen.hidden = true;
  menu.hidden = false;
  // Out of the black the view faded to when the player died or left.
  hud.fade(0, 1.2);
  updatePlayOptions();
  nav.opened();
  showScreen(next);
}

function pause() {
  showMenu('play');
  const d = engine?.dungeon;
  if (d && playing()) {
    const s = d.stats;
    const potions = s.potions === 1 ? '1 healing potion' : `${s.potions} healing potions`;
    const goal = d.objective ? `\n${d.quest!.name}: ${d.objective.text}` : '';
    setStatus(`${d.level.name || engineMap} · Level ${s.level} · ${s.weapon.name} · ${potions} · ${s.gold} gold${goal}`);
  }
}

function died() {
  const d = engine!.dungeon;
  $('dead-notes').textContent = d.kills
    ? `You fell after ${d.kills === 1 ? 'one kill' : `${d.kills} kills`}, ${formatTime(d.time)} into the dungeon.`
    : `You fell ${formatTime(d.time)} into the dungeon.`;
  showMenu('dead');
}

function escaped() {
  const d = engine!.dungeon;
  const gate = /shift gate/i.test(d.level.triggers.map((t) => t.text ?? '').join(' '));
  $('escaped-notes').textContent = gate
    ? 'You step through the Shift Gate and leave the Imperial Dungeons behind. The rest of Tamriel is not in the remake yet.'
    : `You found the way out of ${d.level.name || engineMap}.`;
  const explored = d.explored.seen.reduce((n, v) => n + v, 0);
  const open = d.level.cells.filter((c) => c.kind !== 'wall').length;
  const rows: Array<[string, string]> = [
    ['Time', formatTime(d.time)],
    ['Creatures slain', `${d.kills} of ${d.creatures.length}`],
    ['Level', String(d.stats.level)],
    ['Gold', String(d.stats.gold)],
    ['Weapon', d.stats.weapon.name],
    ['Explored', `${Math.min(100, Math.round((explored / Math.max(1, open)) * 100))}%`],
  ];
  $('run-stats').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  showMenu('escaped');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
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
    tables = undefined;
    sounds = new SoundBank(data);
    sounds.setVolume(settings.volume);
    sounds.wake();
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
mapButton.addEventListener('click', () => {
  if (!engine || !playing()) return;
  menu.hidden = true;
  engine.openMap();
  engine.start();
});
playButton.addEventListener('click', () => startMap(mapSelect.value));
$('try-again').addEventListener('click', () => engineMap && startMap(engineMap));
$('play-again').addEventListener('click', () => engineMap && startMap(engineMap));
mapSelect.addEventListener('change', updatePlayOptions);
// Choosing the map list itself (A on a controller, or Enter) plays the map picked in it.
mapSelect.addEventListener('choose', () => startMap(mapSelect.value));

bindSettingRows(screens.controls, settings, (key) => {
  if (key === 'volume') sounds?.setVolume(settings.volume);
});
// Browsers start sound only after a click or key press.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sounds?.wake(), true);
fillBindings();
showScreen('folder');
void showBackdrop();
requestAnimationFrame(uiFrame);
