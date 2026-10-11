/**
 * Takes the screenshots on the README page, from your own copy of Arena, so
 * they can be retaken for every release:
 *
 *   npx tsx scripts/screenshots.ts <ARENA folder>
 *
 * It makes a development build (which lets the script move the player about),
 * opens it in the desktop app at 1280x720, plays a few staged moments of the
 * first dungeon and saves them in docs/screenshots/. Run `npm run build`
 * afterwards to go back to a normal build. On Linux without a screen, run it
 * under xvfb-run. The shots show the game's own art, so check them before
 * committing; the game's files themselves never go in the repository.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  if (await page.isVisible('#screen-play')) await page.click('#change-folder');
  await page.click('#pick-folder');
  await page.waitForSelector('#screen-play:not([hidden])', { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'menu');

  await page.click('#play');
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
  console.log(`Saved the screenshots in ${out}. Run "npm run build" for a normal build again.`);
} finally {
  await app.close();
  if (settings) rmSync(settings, { recursive: true, force: true });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}.png`);
}

/** The window's game engine, which development builds expose. */
type Win = Window & { arenaEngine: import('../src/game/engine').Engine };

/** Faces a goblin with no other creature about, hurt a little, as it swings. */
async function fight(page: Page): Promise<void> {
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
  // One blow lands, so its health shows under the compass; then hold still mid-swing, before its blow lands.
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    () => {
      const engine = (window as unknown as Win).arenaEngine;
      const swinging = engine.dungeon.creatures.some((c) => c.state === 'attack' && c.time > 0.25 && c.time < 0.38);
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
