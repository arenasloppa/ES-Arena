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
import { MusicPlayer, SONGS } from './audio/music';
import { SoundBank } from './audio/sound';
import { parseClassAnswers, parseNameChunks, parseQuestions, type ClassChooser, type Question } from './formats/creation';
import { readExeData, type ExeData } from './formats/exe';
import { parseSpells, type SpellRecord } from './formats/spells';
import { parseTemplates } from './formats/template';
import { FALLBACK_CALENDAR, formatDate, formatTime as formatClock } from './formats/calendar';
import { parseCol } from './formats/palette';
import { parseMif } from './formats/mif';
import { parseInf } from './formats/inf';
import { unpackExe, UnsupportedExeError } from './formats/pklite';
import { creationData, heroFor, loadCharacter, saveCharacter, type Character, type CreationData } from './game/character';
import { Dungeon, type Vision } from './game/dungeon';
import { buildLevel } from './game/level';
import { Engine, type GameMenu } from './game/engine';
import { GamepadInput } from './input/gamepad';
import { CreatureView } from './render/creatureView';
import { TextureCache } from './render/textures';
import { buildLevelScene } from './render/levelScene';
import { MapView } from './render/mapView';
import { Portraits } from './render/portrait';
import { WeaponView } from './render/weaponView';
import { SpellView } from './render/spellView';
import { backdropLevel } from './render/backdrop';
import { BINDINGS, GAME_ACTIONS, InputModeWatcher, type InputMode } from './ui/controls';
import { CharacterCreation } from './ui/creation';
import { Cutscenes, deathVision, dreamVisions, firstVision, NEW_GAME, OPENING } from './ui/cutscene';
import { GameMenus } from './ui/gameMenus';
import { Hud } from './ui/hud';
import { MenuNav, type StepEvent } from './ui/menu';
import { Minimap } from './ui/minimap';
import { bindSettingRows, loadSettings } from './ui/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu');
const hudEl = $('hud');
const status = $('status');
const checks = $<HTMLUListElement>('checks');
const folderError = $('folder-error');
const playButton = $<HTMLButtonElement>('play');
const newCharacterButton = $<HTMLButtonElement>('new-character');
const resumeButton = $<HTMLButtonElement>('resume');
const mainMenuButton = $<HTMLButtonElement>('to-main-menu');
const mapScreen = $('map-screen');
const canvas = $<HTMLCanvasElement>('view');

/** Arena begins in the Imperial Dungeons. Development builds can start elsewhere with ?map=NAME.MIF. */
const DEFAULT_MAP = 'START.MIF';
const startMapName = () => (import.meta.env.DEV && new URLSearchParams(location.search).get('map')?.toUpperCase()) || DEFAULT_MAP;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const pad = new GamepadInput();
const input = new InputModeWatcher();
const hud = new Hud(hudEl);
const settings = loadSettings();
let data: GameData | undefined;
/** Creature and weapon tables from the game's program, once read; null when they could not be. */
let tables: ExeData | null | undefined;
/** The game's spells; undefined until first needed. */
let spells: SpellRecord[] | undefined;
let sounds: SoundBank | undefined;
/** Arena's music, played on an emulated AdLib with the game's own instruments. */
let music: MusicPlayer | undefined;
/** The opening plays once a visit, when the folder is first opened. */
let openingShown = false;
/** The paper doll and item pictures, read from the game folder. */
let portraits: Portraits | undefined;
/** Classes, races, questions and words for making a character, once read from the game folder. */
let creation: Promise<CreationData> | undefined;
let creationLoaded: CreationData | undefined;
/** The character of the map being played. */
let runCharacter: Character | undefined;
/** Textures of the map being played, freed with it. */
let textures: TextureCache | undefined;
let engine: Engine | undefined;
/** The map being played; undefined while only the backdrop runs. */
let engineMap: string | undefined;
let tipsShown = false;

/** True while a map is being played and the player is still in it. */
const playing = () => engineMap !== undefined && !engine?.dungeon.outcome;

// ---- Menu screens ----

type Screen = 'folder' | 'play' | 'create' | 'controls' | 'wait' | 'dead' | 'escaped';
const screens: Record<Screen, HTMLElement> = {
  folder: $('screen-folder'),
  play: $('screen-play'),
  create: $('screen-create'),
  controls: $('screen-controls'),
  wait: $('screen-wait'),
  dead: $('screen-dead'),
  escaped: $('screen-escaped'),
};
let screen: Screen = 'folder';
let screenBeforeControls: Screen = 'folder';
const creator = new CharacterCreation(screens.create);
const cutscenes = new Cutscenes($('cutscene'), pad, () => data, () => sounds);
input.onChange(() => input.render($('cutscene')));
input.render($('cutscene'));

/** Plays cutscenes over everything, with a song; the menu's focus comes back after. */
async function showCutscene(shots: Parameters<Cutscenes['play']>[0], song?: string) {
  if (song) music?.play(song);
  await cutscenes.play(shots);
  nav.focusFirst();
}

/** The character's first name, as the game's texts address them. */
const firstName = (c: Character) => c.name.trim().split(/\s+/)[0] ?? c.name;
if (import.meta.env.DEV) {
  (window as unknown as { arenaVision?: (name: string, death?: boolean) => Promise<void> }).arenaVision = (name, death) =>
    showCutscene(death ? deathVision(name) : firstVision(name), SONGS.vision);
}

const nav = new MenuNav(menu, pad, input, {
  back: () => {
    if (screen === 'create') creator.back();
    else if (screen === 'controls') showScreen(screenBeforeControls);
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
  // The main menu's song, unless a map is being played (its music carries on under the pause menu) or a character is being made.
  if (!playing() && next !== 'create') music?.play(SONGS.menu);
  updateHints();
  nav.focusFirst();
}

/** The button hints along the bottom: Back steps back through character creation, closes the Controls screen, or returns to the game. */
function updateHints() {
  $('hint-back').hidden = screen !== 'controls' && screen !== 'create' && !playing();
  $('hint-back-label').textContent = screen === 'controls' || screen === 'create' ? 'Back' : screen === 'wait' ? 'Cancel' : 'Resume';
  $('hint-change').hidden = screen !== 'controls' && screen !== 'create' && screen !== 'wait';
}

/**
 * The main menu as Skyrim's: Continue (with the character made last time)
 * and New on the title screen; Resume and Main Menu over a game.
 */
function updatePlayOptions() {
  const inGame = playing();
  const saved = creationLoaded && loadCharacter(creationLoaded);
  resumeButton.hidden = !inGame;
  mainMenuButton.hidden = !inGame;
  playButton.hidden = inGame || !saved;
  newCharacterButton.hidden = inGame;
  $('change-folder').hidden = !data;
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

/** Where each race's description is in TEMPLATE.DAT, in the races' order (as OpenTESArena has them). */
const RACE_LORE = [1409, 1410, 1411, 1412, 1413, 1414, 1415, 1416];

/** QUESTION.TXT, CLASSES.DAT, NAMECHNK.DAT and the races' descriptions in TEMPLATE.DAT; any that are missing or unreadable are left out. */
async function readCreationFiles(game: GameData): Promise<{ questions?: Question[]; chooser?: ClassChooser; names?: string[][]; raceLore?: string[] }> {
  const read = async <T>(name: string, parse: (bytes: Uint8Array) => T): Promise<T | undefined> => {
    if (!game.has(name)) return undefined;
    try {
      return parse(await game.read(name));
    } catch (err) {
      console.warn(`Could not read ${name}:`, err);
      return undefined;
    }
  };
  return {
    questions: await read('QUESTION.TXT', (bytes) => parseQuestions(new TextDecoder('latin1').decode(bytes))),
    chooser: await read('CLASSES.DAT', parseClassAnswers),
    names: await read('NAMECHNK.DAT', parseNameChunks),
    raceLore: await read('TEMPLATE.DAT', (bytes) => {
      const templates = parseTemplates(new TextDecoder('latin1').decode(bytes));
      const lore = RACE_LORE.map((n) => templates.get(String(n)));
      return lore.every((t) => t) ? (lore as string[]) : undefined;
    }),
  };
}

/** What making a character needs, read from the game folder once. */
async function creationFor(): Promise<CreationData | undefined> {
  const game = data;
  if (!game) return undefined;
  creation ??= (async () => {
    if (tables === undefined) tables = await loadTables(game);
    return creationData(tables?.character, await readCreationFiles(game), { raceAttributes: tables?.raceAttributes, messages: tables?.messages });
  })();
  const loaded = await creation;
  if (data !== game) return undefined; // another folder was chosen meanwhile
  creationLoaded = loaded;
  return loaded;
}

/** Plays the map with the character made last time, making one first when there is none. */
async function enterDungeon(name: string) {
  const made = await creationFor();
  if (!made) return;
  const character = loadCharacter(made);
  if (character) await startMap(name, character);
  else await createCharacter(name);
}

/**
 * Opens character creation, after the story of how the Emperor was betrayed,
 * as a new game does in Arena; the new character then has Ria Silmane's
 * vision and plays the map.
 */
async function createCharacter(map: string) {
  const made = await creationFor();
  if (!made) return;
  await showCutscene(NEW_GAME, SONGS.story);
  showScreen('create');
  music?.play(SONGS.creation);
  creator.start({
    data: made,
    weapons: tables?.weapons ?? [],
    portraits,
    finish: 'Enter the dungeon',
    done: async (character) => {
      saveCharacter(character, made.classes[character.cls]);
      await showCutscene(firstVision(firstName(character)), SONGS.vision);
      void startMap(map, character);
    },
    cancel: () => showScreen('play'),
  });
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

/** The game's spells, from SPELLSG.65; none when it can't be read, and then nobody casts. */
async function loadSpells(game: GameData): Promise<SpellRecord[]> {
  try {
    return parseSpells(await game.read('SPELLSG.65'));
  } catch (err) {
    console.warn('Could not read the spells from SPELLSG.65:', err);
    return [];
  }
}

async function startMap(name: string, character: Character) {
  if (!data || !creationLoaded) return;
  const made = creationLoaded;
  setEngine(undefined);
  hud.reset();
  playButton.disabled = true;
  try {
    setStatus(`Loading ${name}…`);
    const mif = parseMif(await data.read(name));
    const levelIndex = Math.min(mif.startingLevelIndex, mif.levels.length - 1);
    const infName = mif.levels[levelIndex].info;
    const inf = parseInf(await data.read(infName));
    if (tables === undefined) tables = await loadTables(data);
    const level = buildLevel(mif, levelIndex, inf, tables?.platforms);
    // Arena's first dungeon, under the Imperial Palace.
    if (name === DEFAULT_MAP) level.name = 'Imperial Dungeons';
    const palette = parseCol(await data.read('PAL.COL'));
    if (tables === undefined) tables = await loadTables(data);
    if (spells === undefined) spells = await loadSpells(data);
    const cache = new TextureCache(data, palette);
    const dungeon = new Dungeon(level, tables ?? undefined, Math.random, heroFor(character, made.classes[character.cls]), spells);
    const scene = await buildLevelScene(level, cache);
    const creatures = await CreatureView.create(dungeon.creatures, (stem) => cache.creature(stem), level);
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
      spells: new SpellView(),
    });
    next.onPause = pause;
    next.onMenu = openGameMenu;
    next.onDeath = died;
    next.onWait = openWait;
    next.onDream = (visions) => void dream(visions);
    next.onEscape = escaped;
    next.onMap = (open) => {
      mapScreen.hidden = !open;
      hudEl.hidden = open;
    };
    setEngine(next, name);
    runCharacter = character;
    music?.play(SONGS.dungeons);
    textures = cache;
    $('map-name').textContent = level.name || name;
    if (import.meta.env.DEV) (window as unknown as { arenaEngine?: Engine }).arenaEngine = next;
    if (scene.skippedFlats.length) {
      console.warn(`Could not draw: ${[...new Set(scene.skippedFlats)].join(', ')}`);
    }
    setStatus('');
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
  gameMenus.close();
  menu.hidden = true;
  hudEl.hidden = false;
  engine.start();
}

/** Opens one of the menus over the game: the menu of menus, the items, magic, the character or the favourites. */
function openGameMenu(which: GameMenu) {
  if (!engine || !playing()) return;
  // Paused first, so letting go of the mouse doesn't count as asking for the pause menu.
  engine.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  hudEl.hidden = true;
  gameMenus.open(which);
}

/** Opens the map over the game, from a menu. */
function openMap() {
  if (!engine || !playing()) return;
  gameMenus.close();
  menu.hidden = true;
  engine.openMap();
  engine.start();
}

const gameMenus = new GameMenus($('game-menu'), pad, input, {
  run: () => (engine && playing() && runCharacter && creationLoaded ? { dungeon: engine.dungeon, character: runCharacter, data: creationLoaded } : undefined),
  portraits: () => portraits,
  resume,
  openMap,
  pause: () => pause(),
});

/** Shows the menu over the game, with the run's progress under the options. */
function showMenu(next: Screen) {
  engine?.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  gameMenus.close();
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
}

// ---- Waiting, as Skyrim's wait menu, with Arena's camping ----

const HOURS_MAX = 24;
let waitHours = 8;
const waitRow = screens.wait.querySelector<HTMLElement>('[data-setting="waitHours"]')!;

function showWaitHours() {
  waitRow.querySelector('.value')!.textContent = String(waitHours);
  waitRow.style.setProperty('--fill', String(waitHours / HOURS_MAX));
  waitRow.setAttribute('aria-valuetext', `${waitHours} hours`);
}
waitRow.addEventListener('step', (e) => {
  const { delta, wrap } = (e as StepEvent).detail;
  waitHours = wrap && waitHours + delta > HOURS_MAX ? 1 : Math.min(HOURS_MAX, Math.max(1, waitHours + delta));
  showWaitHours();
});
waitRow.addEventListener('click', () => {
  waitHours = waitHours >= HOURS_MAX ? 1 : waitHours + 1;
  showWaitHours();
});

/** T or View: Skyrim's wait menu, in Arena's words when the game's can be read. */
function openWait() {
  if (!engine || !playing()) return;
  const m = tables?.messages ?? {};
  // Skyrim's wait menu leads with the time and date; these are Arena's.
  const calendar = tables?.calendar ?? FALLBACK_CALENDAR;
  $('wait-time').textContent = formatClock(engine.dungeon.minutes, calendar);
  $('wait-date').textContent = formatDate(engine.dungeon.minutes, calendar);
  $('wait-question').textContent = m.hoursToRest ?? 'How many hours will you rest?';
  $('wait-hours').textContent = m.restForHours ?? 'Rest';
  $('wait-healed').textContent = m.restUntilHealed ?? 'Until healed';
  showWaitHours();
  showMenu('wait');
}

/** Starts camping, or says why not, back in the game. */
function camp(hours: number | 'healed') {
  if (!engine || !playing()) return;
  const refusal = engine.dungeon.camp(hours);
  resume();
  if (refusal) hud.message(refusal);
}
$('wait-hours').addEventListener('click', () => camp(waitHours));
$('wait-healed').addEventListener('click', () => camp('healed'));

/** Ria comes to the sleeping player: her visions play, then the rest goes on. */
async function dream(visions: Vision[]) {
  if (!engine || !runCharacter) return;
  engine.pause();
  if (document.pointerLockElement) document.exitPointerLock();
  hudEl.hidden = true;
  await showCutscene(dreamVisions(visions, firstName(runCharacter)), SONGS.vision);
  music?.play(SONGS.dungeons);
  menu.hidden = true;
  resume();
}

/** The game's words for how the player died (drowning and the like) show first, then Ria Silmane's farewell, as in Arena. */
async function died(cause?: string) {
  $('dead-notes').textContent = cause ?? '';
  if (runCharacter) await showCutscene(deathVision(firstName(runCharacter)), SONGS.vision);
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
  if (cutscenes.isPlaying) cutscenes.frame();
  else if (!menu.hidden) nav.frame(now);
  else if (gameMenus.isOpen) gameMenus.frame(now);
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
    spells = undefined;
    creation = undefined;
    creationLoaded = undefined;
    portraits = new Portraits(data);
    sounds = new SoundBank(data);
    sounds.setVolume(settings.volume);
    sounds.wake();
    music?.play(undefined);
    music = new MusicPlayer(data);
    music.setVolume(settings.music);
    music.wake();
    if (import.meta.env.DEV) (window as unknown as { arenaMusic?: MusicPlayer }).arenaMusic = music;
  } catch (err) {
    folderError.textContent = `Could not read the game data: ${(err as Error).message}`;
    folderError.hidden = false;
    setStatus('');
    return false;
  }
  updatePlayOptions();
  showScreen('play');
  setStatus('');
  // Read the classes now, to say who plays and to have character creation ready.
  void creationFor().then(updatePlayOptions);
  music.play(SONGS.menu);
  if (settings.intro && !openingShown) {
    openingShown = true;
    await showCutscene(OPENING);
  }
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
  music?.play(undefined);
  setEngine(undefined);
  void showBackdrop();
  data = undefined;
  portraits = undefined;
  creation = undefined;
  creationLoaded = undefined;
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
playButton.addEventListener('click', () => enterDungeon(startMapName()));
newCharacterButton.addEventListener('click', () => createCharacter(startMapName()));
mainMenuButton.addEventListener('click', () => {
  // Leave the game for the title screen, as Skyrim's Quit to Main Menu does.
  setEngine(undefined);
  void showBackdrop();
  updatePlayOptions();
  showScreen('play');
});
$('try-again').addEventListener('click', () => engineMap && enterDungeon(engineMap));
$('play-again').addEventListener('click', () => engineMap && enterDungeon(engineMap));

bindSettingRows(screens.controls, settings, (key) => {
  if (key === 'volume') sounds?.setVolume(settings.volume);
  if (key === 'music') music?.setVolume(settings.music);
});
// Browsers start sound only after a click or key press.
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(
    type,
    () => {
      sounds?.wake();
      music?.wake();
    },
    true,
  );
}
fillBindings();
showScreen('folder');
void showBackdrop();
requestAnimationFrame(uiFrame);
