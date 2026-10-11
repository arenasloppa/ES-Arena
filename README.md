# ES Arena

**The Elder Scrolls: Arena (1994), remade by an AI in Three.js.**

ES Arena is an unofficial remake of Bethesda's first Elder Scrolls game. It runs as a desktop app on Mac and Windows,
or in a web browser. It is written by Claude, an AI model made by Anthropic, in TypeScript with Three.js.
You play it with your own copy of Arena: the game reads the original maps, textures, creatures, sounds and text from your
`ARENA` folder while it runs, so none of Bethesda's files are in this repository.

> I am just the AI's meat puppet in this project.
>
> — arenasloppa, the human

[![Support arenasloppa on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N0C328KVIG)

## Who does what

Claude writes everything here: the decoders for Arena's 1994 file formats, the 3D engine, the tests and this page.
arenasloppa brings the ideas and the game files, clicks the buttons Claude asks them to click, and plays the results.

## Screenshots

![A goblin raises its axe at the player in the Imperial Dungeons, with its health under the compass, the minimap at the top right and the player's health at the bottom](docs/screenshots/goblin.png)

| | |
|---|---|
| ![The cell where the game begins, with the dungeon's name across the top and the first objective in the corner](docs/screenshots/cell.png)<br>Arriving in the cell where Arena begins | ![Sneaking up behind a rat, with the eye that shows how close it is to noticing](docs/screenshots/sneak.png)<br>Sneaking up on a rat |
| ![The 3D map of the Imperial Dungeons, showing the parts explored so far](docs/screenshots/map.png)<br>The map fills in as you explore | ![The main menu, over a hall the remake draws itself](docs/screenshots/menu.png)<br>The main menu |

The screenshots are taken from the game as it stands with `npm run screenshots` and retaken for every release.
They show Arena's own art, which the remake reads from a copy of the game.

## What works so far

- Choose your `ARENA` folder and the game checks that it has everything it needs.
- Escape the Imperial Dungeons where Arena begins: get out of your locked cell, get past the rats and goblins, and
  find the Shift Gate. Or try any of the game's other maps from the menu.
- Monsters with Arena's own pictures and stats. They wander, notice you when they see you, chase you round corners
  and fight.
- Combat in Skyrim's style with Arena's weapons and swings: power attacks, blocking, bashing, and sneak attacks for
  three times the damage. While you sneak, an eye shows how close the creatures nearby are to noticing you.
- Health, stamina, healing potions and levels. Search bodies and chests for gold, potions and better weapons, and open
  locked doors with their key or break them down.
- A 3D map that fills in as you explore, a minimap, quest objectives, and markers on the compass for the next
  objective and the creatures nearby.
- Arena's own sound effects, each coming from where it happens in the dungeon.
- The original wall, floor and ceiling textures, animated water and lava, raised platforms, doors that slide open,
  barred doors you can see through, decorations such as chains and barrels, and the dungeon's own messages when you
  reach their squares.
- Play with a controller or the keyboard and mouse, with Skyrim's controls, menu and HUD: a compass, button prompts
  that match your controller, jumping, sneaking and sprinting, the dungeon's name as you arrive, and a banner when you
  level up.

Coming later: cities and the wilderness, character creation, spells, music and saving.

## Play it

You need your own copy of Arena; it's free on Steam.

### Download the app

Get the zip for your computer from the [Releases page](https://github.com/arenasloppa/ES-Arena/releases/latest).
The "Source code" downloads there are for programmers and won't open by double-clicking.
The app needs macOS 13 (Ventura) or newer, or Windows 10 or newer.

| Your computer | Download |
|---|---|
| Mac with an Apple chip (M1 or newer) | `ES-Arena-<version>-Mac-Apple-silicon.zip` |
| Mac with an Intel chip | `ES-Arena-<version>-Mac-Intel.zip` |
| Windows PC | `ES-Arena-<version>-Windows.zip` |

- **Mac:** double-click the zip, then double-click ES Arena. The first time, macOS says it could not verify the app,
  because it isn't signed with a paid Apple developer certificate. Click Done, open System Settings, go to
  Privacy & Security, scroll down to the message about ES Arena and click Open Anyway.
- **Windows:** right-click the zip, choose Extract All, open the new folder and double-click ES Arena.
  If Windows says it protected your PC, click More info, then Run anyway.

When the game opens, click **Choose ARENA folder…** and pick the `ARENA` folder, the one that holds `GLOBAL.BSA`.
In the Steam release it sits inside the game's install folder; the GamesNostalgia downloads call it `arena` (Windows)
or `game/Resources/arena` (Mac). Picking a folder above it also works, since the game looks a few folders down,
and file name case doesn't matter. The app remembers the folder for next time. Your files never leave your computer.

### Run it from the source code

You need [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run dev     # then open the address it prints in your browser
npm run app     # or open it as the desktop app
```

### Controls

The controls follow Skyrim's. Any controller the browser or app recognises works, including Xbox, PlayStation and
Switch Pro controllers, and the on-screen prompts show its own buttons. Below, buttons are named as on an Xbox
controller, with the PlayStation button in brackets.

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Move | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Left stick |
| Look | Mouse (click the view to capture it) | Right stick |
| Turn and walk | Arrow keys | |
| Attack, hold for a power attack | Left mouse button | RT (R2) |
| Block, attack while blocking to bash | Right mouse button | LT (L2) |
| Use, take, open | <kbd>E</kbd> | A (✕) |
| Jump | <kbd>Space</kbd> | Y (△) |
| Sprint | <kbd>Shift</kbd> | LB (L1) |
| Sneak | <kbd>C</kbd> | Click the left stick (L3) |
| Drink a healing potion | <kbd>Q</kbd> | Up on the D-pad |
| Map | <kbd>M</kbd> | View (Share) |
| Menu | <kbd>Esc</kbd> or <kbd>Tab</kbd> | B or Start (○ or Options) |

On the map, move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the left stick, drag with the mouse or use
the right stick to turn it, and zoom with the mouse wheel or the triggers.

In the menus, move with the arrow keys, the D-pad or the left stick, choose with <kbd>Enter</kbd> or A, change a setting
with left and right, and go back with <kbd>Esc</kbd> or B. LB and RB, or <kbd>Page Up</kbd> and <kbd>Page Down</kbd>,
skip ten maps at a time. The Controls screen sets look speed, inverted look, sound volume and vibration.

### Files it reads

The game needs these files from your copy: `GLOBAL.BSA`, `ACD.EXE` (or the floppy version's `A.EXE`), `PAL.COL`,
`TEMPLATE.DAT`, `QUESTION.TXT`, `CITYDATA.65`, `SPELLSG.65`, and a font (`ARENAFNT.DAT` or `FONT_A.DAT`).
The monsters' and weapons' stats come from the game's program, `ACD.EXE` or `A.EXE`, which the remake unpacks in
memory; the pictures, animations and sounds come from `GLOBAL.BSA`. Loose files take priority over the copies inside
`GLOBAL.BSA`, as in the original. Saves and other files a played
copy creates (`SAVEGAME.0x`, `WILD00x.0x`, `AUTOMAP.0x`, `*.$$$`, `SOUND.CFG`, `VISION.EMS`) are ignored.

## How it works

| Path | What it does |
|---|---|
| `src/formats/` | Readers for Arena's file formats: the BSA archive, COL palettes, IMG/SET/RCI images, CIF and CFA animations, VOC sounds, MIF maps, INF level definitions, the game's program (unpacking it and reading the creature and weapon tables), and the LZSS and LZHUF decompressors. No browser or Three.js code. |
| `src/data/` | Finding and reading the player's `ARENA` folder, and checking the required files. |
| `src/game/` | The level model built from a MIF map and its INF file, movement and collision, the monsters, combat, items, the quest, what the player has explored, and the game loop. |
| `src/audio/` | Arena's sound effects, played through the Web Audio API so each comes from where it happens. |
| `src/input/` | Controllers, read through the browser's Gamepad API. |
| `src/ui/` | The Skyrim-style menu and HUD: moving through the menu, the compass, the minimap, button prompts and the settings. |
| `src/render/` | Turning a level into Three.js meshes and textures, the creatures, the weapon in hand, the 3D map, and the stand-in hall shown behind the menu, whose textures the remake draws itself. |
| `electron/` | The desktop app: a window that shows the built game and can read the `ARENA` folder you pick, and nothing else on your computer. |
| `scripts/` | Tools for working on the remake: redrawing the app icon, saving the game's images as PNGs, and taking the screenshots. |
| `tests/` | Unit tests. `tests/helpers/encode.ts` builds fake archives, maps and compressed data, so the tests never need the real game files. |

```sh
npm test            # unit tests
npm run typecheck
npm run build       # static build in dist/
npm run app         # build, then open the desktop app
npm run dist        # build the desktop app for this computer into release/
npx tsx scripts/icon.ts   # redraw the app icon, build/icon.png
npx tsx scripts/inspect.ts <ARENA folder> <out dir> WALLA.SET TITLE.IMG   # save images as PNGs to check the decoders
npm run screenshots -- <ARENA folder>   # retake the screenshots in docs/screenshots (then npm run build)
```

Every release is logged in [CHANGELOG.md](CHANGELOG.md). Releases are built on GitHub by
`.github/workflows/release.yml`: add the version's entry to the update log, raise the version in `package.json`, retake
the screenshots, then run the Release workflow from the Actions tab (or push a tag such as `v0.3.0`). The release notes
come from the log. It builds the Mac and Windows zips and
publishes them on the Releases page. The Mac app is ad-hoc signed rather than signed with a paid Apple certificate,
which is why macOS asks before opening it the first time.

The format details come from the community's research, mainly [UESP](https://en.uesp.net/wiki/Arena:Arena)
and the [OpenTESArena](https://github.com/afritz1/OpenTESArena) project. Anything the code marks as a guess still needs
checking against the original game.

## Support

If you enjoy it, you can buy arenasloppa a coffee on Ko-fi.

[![Support arenasloppa on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N0C328KVIG)

## Legal

This is an unofficial fan project, not affiliated with or endorsed by Bethesda Softworks or ZeniMax Media.
The Elder Scrolls and Arena are trademarks of their owners. Arena is free to download, but its license allows
personal use only, so this repository never contains the game's files; the remake reads them from your own copy.
The screenshots show the game's art as the remake draws it from a copy of the game.
The menu's fonts, Cinzel and Barlow Condensed, are used under the SIL Open Font License.
