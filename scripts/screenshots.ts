/**
 * Takes the screenshots on the README page, from your own copy of Arena, so
 * they can be retaken for every release:
 *
 *   npx tsx scripts/screenshots.ts <ARENA folder>
 *
 * It makes a development build (which lets the script move the player about),
 * opens it in the desktop app at 1280x720, makes a character, plays a few
 * staged moments of the first dungeon, opens the menus and saves it all in
 * docs/screenshots/. Shots taken for an earlier version move to
 * docs/screenshots/<that version>/ first, and docs/gallery.md shows every
 * version's. Run `npm run build` afterwards to go back to a normal build. On
 * Linux without a screen, run it under xvfb-run. The shots show the game's
 * own art, so check them before committing; the game's files themselves
 * never go in the repository.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type Page } from 'playwright-core';
import { build } from 'vite';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npx tsx scripts/screenshots.ts <ARENA folder>');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
/** Which version the shots in docs/screenshots were taken for. */
const versionFile = join(out, 'version.txt');
/** The character the app has saved, put back afterwards, so making one for the shots doesn't replace it. */
const SAVED_CHARACTER = 'es-arena.character';

/** What each shot shows, in the order the gallery lists them. */
const CAPTIONS: Record<string, string> = {
  menu: 'The main menu',
  race: 'Choosing a race on the map of Tamriel',
  attributes: 'Sharing out bonus points, beside the paper doll',
  cell: 'Arriving in the cell where Arena begins',
  goblin: 'A goblin raises its axe',
  sneak: 'Sneaking up on a rat',
  items: 'The item menu',
  character: 'The character sheet',
  map: 'The map fills in as you explore',
  wait: 'Waiting, with the date and time in Arena',
};

archive();

process.env.NODE_ENV = 'development';
await build({ root, mode: 'development', logLevel: 'warn' });

// The electron package's main export is the path to its binary.
const electronPath = createRequire(import.meta.url)('electron') as string;
// Linux containers have no GPU and run as root; a separate settings folder keeps the player's own untouched there.
const linux = process.platform === 'linux';
const settings = linux ? mkdtempSync(join(tmpdir(), 'es-arena-shots-')) : undefined;
const app = await electron.launch({
  executablePath: electronPath,
  args: [...(linux ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []), root],
  env: { ...process.env, ...(settings ? { XDG_CONFIG_HOME: settings } : {}) },
});

let saved: string | null = null;
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  // tsx keeps function names with a helper the page lacks; the functions sent to the page need it.
  await page.evaluate('globalThis.__name = (f) => f');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 720));
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, resolve(folder));
  // The app may reopen the folder it remembers; pick the one asked for either way.
  await page.waitForSelector('#screen-folder:not([hidden]), #screen-play:not([hidden])');
  saved = await page.evaluate((key) => {
    const character = localStorage.getItem(key);
    localStorage.removeItem(key);
    return character;
  }, SAVED_CHARACTER);
  if (await page.isVisible('#screen-play')) await page.click('#change-folder');
  await page.click('#pick-folder');
  await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'menu');

  await page.click('#new-character');
  // The story of how the Emperor was betrayed comes first.
  await page.waitForSelector('#cutscene:not([hidden]), #screen-create:not([hidden])');
  while (await page.isVisible('#cutscene')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await makeCharacter(page);
  await page.waitForSelector('#menu[hidden]', { state: 'attached', timeout: 60_000 });
  await page.evaluate(() => (document.getElementById('tips')!.hidden = true));
  await page.waitForTimeout(1800);
  await shot(page, 'cell');
  // Let the titles across the top finish.
  await page.waitForTimeout(7500);

  await fight(page);
  await shot(page, 'goblin');
  await page.evaluate(() => (window as unknown as Win).arenaEngine.start());

  await sneak(page);
  await shot(page, 'sneak');

  await explore(page);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(600);
  // Out a little, and round, to show the walls.
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(700, 330, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await shot(page, 'map');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(600);

  await menus(page);
  await wait(page);
  writeFileSync(versionFile, `${version}\n`);
  writeGallery();
  console.log(`Saved the screenshots in ${out}. Run "npm run build" for a normal build again.`);
} finally {
  await app
    .firstWindow()
    .then((page) =>
      page.evaluate(
        ([key, character]) => (character === null ? localStorage.removeItem(key!) : localStorage.setItem(key!, character)),
        [SAVED_CHARACTER, saved],
      ),
    )
    .catch(() => undefined);
  await app.close();
  if (settings) rmSync(settings, { recursive: true, force: true });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
}

/** Moves shots taken for an earlier version into a folder of their own, for the gallery. */
function archive(): void {
  const taken = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '';
  const shots = readdirSync(out).filter((f) => f.endsWith('.png'));
  if (!taken || taken === version || !shots.length) return;
  const dir = join(out, taken);
  mkdirSync(dir, { recursive: true });
  for (const f of shots) renameSync(join(out, f), join(dir, f));
  console.log(`Moved the ${taken} screenshots to docs/screenshots/${taken}/`);
}

/** docs/gallery.md: the shots of this version and every earlier one, newest first. */
function writeGallery(): void {
  const older = readdirSync(out, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => compareVersions(b, a));
  const lines = [
    '# Screenshot gallery',
    '',
    'How ES Arena has looked from one release to the next, newest first. The screenshots are taken with',
    '`npm run screenshots`, which keeps the ones it replaces here.',
  ];
  for (const [title, dir] of [[`${version} (latest)`, 'screenshots'], ...older.map((v) => [v, `screenshots/${v}`])]) {
    const names = readdirSync(join(out, '..', dir))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    lines.push('', `## ${title}`, '', '| | |', '|---|---|');
    for (let i = 0; i < names.length; i += 2) {
      const cells = names.slice(i, i + 2).map((n) => `![${CAPTIONS[n] ?? n}](${dir}/${n}.png)<br>${CAPTIONS[n] ?? n}`);
      lines.push(`| ${cells.join(' | ')}${cells.length === 1 ? ' | ' : ''} |`);
    }
  }
  writeFileSync(join(out, '..', 'gallery.md'), `${lines.join('\n')}\n`);
  console.log('gallery.md');
}

function rank(name: string): number {
  const i = Object.keys(CAPTIONS).indexOf(name);
  return i < 0 ? Infinity : i;
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Makes a warrior from Skyrim, from the list of classes, sharing out the bonus points. */
async function makeCharacter(page: Page): Promise<void> {
  const step = (name: string) => page.waitForSelector(`#screen-create[data-step='${name}']`);
  const pick = (text: string) => page.click(`#screen-create .option >> text="${text}"`);
  await page.waitForSelector('#screen-create[data-step]:not([hidden])');
  if ((await page.getAttribute('#screen-create', 'data-step')) === 'method') await pick('Choose from the list');
  await step('classes');
  await pick('Warrior');
  await step('name');
  await page.fill('.create-name', 'Brin Tallow');
  await page.keyboard.press('Enter');
  await step('gender');
  await pick('Male');
  await step('race');
  await page.waitForSelector('.create-map:not([hidden])');
  // Skyrim, the third province.
  await page.focus('#screen-create .create-list .option >> nth=2');
  await page.waitForTimeout(300);
  await shot(page, 'race');
  await page.keyboard.press('Enter');
  await step('home');
  await pick('Yes');
  // Arena's words after the race: who you are, your people, what your class needs, and farewell.
  for (const name of ['knownAs', 'lore', 'needs', 'farewell']) {
    await step(name);
    await pick('Continue');
  }
  await step('attributes');
  // Some points on strength and endurance, then a shot with the rest still to share out.
  const rows = page.locator('#screen-create .option-row');
  for (const [row, points] of [[0, 6], [5, 5]]) {
    await rows.nth(row).focus();
    for (let i = 0; i < points; i++) await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(600);
  await shot(page, 'attributes');
  // The rest of the points, then Arena's choice: keep the attributes.
  for (let row = 0; row < 8 && !(await page.textContent('.create-bonus'))?.endsWith(': 0'); row++) {
    await rows.nth(row).focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  }
  await pick('Done');
  await page.click('#screen-create .create-choice .option >> nth=0');
  await step('face');
  await page.click('#screen-create .create-face .option >> nth=1');
  // Ria's vision after making a character.
  await page.waitForSelector('#cutscene:not([hidden])', { timeout: 20_000 }).catch(() => undefined);
  while (await page.isVisible('#cutscene')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

/** The wait menu, with Arena's date and time over the hours to rest. */
async function wait(page: Page): Promise<void> {
  await page.keyboard.press('KeyT');
  await page.waitForSelector('#screen-wait:not([hidden])');
  await page.waitForTimeout(800);
  await shot(page, 'wait');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

/** The item menu with a piece of armour picked, and the character sheet. */
async function menus(page: Page): Promise<void> {
  await page.keyboard.press('KeyI');
  await page.waitForSelector("#game-menu[data-panel='items']:not([hidden])");
  // Down the list to the first entry with a picture.
  for (let i = 0; i < 6 && !(await page.isVisible('.gm-picture')); i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
  }
  await shot(page, 'items');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowUp');
  await page.waitForSelector("#game-menu[data-panel='character']:not([hidden])");
  await page.waitForTimeout(800);
  await shot(page, 'character');
  await page.keyboard.press('Tab');
}

/** The window's game engine, which development builds expose. */
type Win = Window & { arenaEngine: import('../src/game/engine').Engine };

/** Faces a goblin with no other creature about, hurt a little, as it swings. */
async function fight(page: Page): Promise<void> {
  // The pointer to the middle first: moving it turns the view, so before the player is set looking at the goblin.
  await page.mouse.move(640, 360);
  await page.evaluate(() => {
    const engine = (window as unknown as Win).arenaEngine;
    const d = engine.dungeon;
    const L = d.level;
    const open = (x: number, y: number) => {
      const c = L.cells[Math.floor(y) * L.width + Math.floor(x)];
      return c?.kind === 'empty' && !c.chasm;
    };
    const crowd = (g: (typeof d.creatures)[number]) => d.creatures.filter((c) => c !== g && Math.hypot(c.x - g.x, c.y - g.y) < 8).length;
    const goblins = d.creatures.filter((c) => c.info.name === 'Goblin').sort((a, b) => crowd(a) - crowd(b));
    for (const g of goblins) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!open(g.x + dx, g.y + dy) || !open(g.x + dx * 1.6, g.y + dy * 1.6)) continue;
        engine.teleport(g.x + dx * 1.6, g.y + dy * 1.6, Math.atan2(-dy, -dx));
        d.player.pitch = -0.05;
        d.stats.health = Math.round(d.stats.maxHealth * 0.7);
        // Tough enough to live through the blow.
        g.health = g.maxHealth = 20;
        return;
      }
    }
  });
  // One blow lands, so its health shows under the compass (swinging again after a miss); then hold still
  // mid-swing, before the goblin's blow lands.
  for (let tries = 0; tries < 4; tries++) {
    await page.mouse.down();
    await page.mouse.up();
    const hit = await page
      .waitForFunction(() => (window as unknown as Win).arenaEngine.dungeon.creatures.some((c) => c.health < c.maxHealth), undefined, { timeout: 1500 })
      .then(
        () => true,
        () => false,
      );
    if (hit) break;
  }
  await page.waitForFunction(
    () => {
      const engine = (window as unknown as Win).arenaEngine;
      const swinging = engine.dungeon.creatures.some((c) => c.health < c.maxHealth && c.state === 'attack' && c.time > 0.25 && c.time < 0.38);
      if (swinging) engine.pause();
      return swinging;
    },
    undefined,
    { timeout: 10_000 },
  );
}

/** Creeps up behind a rat, sneaking, with the eye half open. */
async function sneak(page: Page): Promise<void> {
  // Until the goblin's health has gone from under the compass.
  await page.waitForTimeout(4200);
  await page.keyboard.press('KeyC');
  await page.evaluate(() => {
    const engine = (window as unknown as Win).arenaEngine;
    const d = engine.dungeon;
    const L = d.level;
    d.stats.health = d.stats.maxHealth;
    // On dry floor, so the rat isn't down in the water.
    const open = (x: number, y: number) => {
      const c = L.cells[Math.floor(y) * L.width + Math.floor(x)];
      return c?.kind === 'empty' && !c.chasm;
    };
    const crowd = (r: (typeof d.creatures)[number]) => d.creatures.filter((c) => c !== r && Math.hypot(c.x - r.x, c.y - r.y) < 8).length;
    const rats = d.creatures.filter((c) => c.info.name === 'Rat' && c.state !== 'dead' && open(c.x, c.y)).sort((a, b) => crowd(a) - crowd(b));
    for (const rat of rats) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!open(rat.x + dx, rat.y + dy) || !open(rat.x + dx * 1.7, rat.y + dy * 1.7)) continue;
        Object.assign(rat, { state: 'look', time: 0, span: 60, awareness: 0.5, facing: Math.atan2(-dy, -dx) });
        engine.teleport(rat.x + dx * 1.7, rat.y + dy * 1.7, Math.atan2(-dy, -dx));
        d.player.pitch = -0.05;
        return;
      }
    }
  });
  await page.waitForTimeout(400);
}

/** Looks around a good part of the dungeon, so the map has something to show. */
async function explore(page: Page): Promise<void> {
  await page.evaluate(() => {
    const engine = (window as unknown as Win).arenaEngine;
    const d = engine.dungeon;
    const L = d.level;
    const start = Math.floor(L.start.y) * L.width + Math.floor(L.start.x);
    const steps = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const i = queue.shift()!;
      const n = steps.get(i)!;
      if (n >= 60) continue;
      for (const j of [i - 1, i + 1, i - L.width, i + L.width]) {
        const c = L.cells[j];
        if (!c || steps.has(j) || (c.kind !== 'empty' && c.kind !== 'door' && c.kind !== 'raised')) continue;
        steps.set(j, n + 1);
        queue.push(j);
      }
    }
    for (const [i] of steps) {
      if (L.cells[i].kind === 'door') d.openDoors.add(i);
      d.explored.look((i % L.width) + 0.5, Math.floor(i / L.width) + 0.5, d.openDoors);
    }
    for (const i of [...d.openDoors]) if (d.doors.get(i)?.target !== 1) d.openDoors.delete(i);
    for (const c of d.creatures) c.state = 'dead';
    engine.teleport(L.start.x - 6, L.start.y - 3);
  });
  await page.keyboard.press('KeyC');
}
