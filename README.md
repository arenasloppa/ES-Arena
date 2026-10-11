# ES Arena

**The Elder Scrolls: Arena (1994), remade by an AI in Three.js.**

ES Arena is an unofficial remake of Bethesda's first Elder Scrolls game. It runs as a desktop app on Mac and Windows,
or in a web browser. It is written by Claude, an AI model made by Anthropic, in TypeScript with Three.js.
You play it with your own copy of Arena: the game reads the original maps, textures and text from your
`ARENA` folder while it runs, so none of Bethesda's files are in this repository.

> I am just the AI's meat puppet in this project.
>
> — arenasloppa, the human

## Who does what

Claude writes everything here: the decoders for Arena's 1994 file formats, the 3D engine, the tests and this page.
arenasloppa brings the ideas and the game files, clicks the buttons Claude asks them to click, and plays the results.

## What works so far

- Choose your `ARENA` folder and the game checks that it has everything it needs.
- Walk the Imperial Dungeons where Arena begins, in first person, or try any of the game's other maps from the menu.
- The original wall, floor and ceiling textures, animated water and lava, raised platforms, doors that slide open,
  decorations such as chains and barrels, and the dungeon's own messages when you reach their squares.

Coming later: creatures and combat, sound and music, cities and the wilderness, character creation and saving.

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

| Key | Action |
|---|---|
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move |
| Mouse | Look (click the view to capture the mouse, or drag where it can't be captured) |
| Arrow keys | Turn and move |
| <kbd>Shift</kbd> | Run |
| <kbd>E</kbd>, <kbd>Space</kbd> or click | Open doors |
| <kbd>Esc</kbd> | Menu |

### Files it reads

The game needs these files from your copy: `GLOBAL.BSA`, `ACD.EXE` (or the floppy version's `A.EXE`), `PAL.COL`,
`TEMPLATE.DAT`, `QUESTION.TXT`, `CITYDATA.65`, `SPELLSG.65`, and a font (`ARENAFNT.DAT` or `FONT_A.DAT`).
Loose files take priority over the copies inside `GLOBAL.BSA`, as in the original. Saves and other files a played
copy creates (`SAVEGAME.0x`, `WILD00x.0x`, `AUTOMAP.0x`, `*.$$$`, `SOUND.CFG`, `VISION.EMS`) are ignored.

## How it works

| Path | What it does |
|---|---|
| `src/formats/` | Readers for Arena's file formats: the BSA archive, COL palettes, IMG/SET/RCI images, MIF maps, INF level definitions, and the LZSS and LZHUF decompressors. No browser or Three.js code. |
| `src/data/` | Finding and reading the player's `ARENA` folder, and checking the required files. |
| `src/game/` | The level model built from a MIF map and its INF file, movement and collision, and the game loop. |
| `src/render/` | Turning a level into Three.js meshes and textures, plus the stand-in hall shown behind the menu, whose textures the remake draws itself. |
| `electron/` | The desktop app: a window that shows the built game and can read the `ARENA` folder you pick, and nothing else on your computer. |
| `tests/` | Unit tests. `tests/helpers/encode.ts` builds fake archives, maps and compressed data, so the tests never need the real game files. |

```sh
npm test            # unit tests
npm run typecheck
npm run build       # static build in dist/
npm run app         # build, then open the desktop app
npm run dist        # build the desktop app for this computer into release/
npx tsx scripts/icon.ts   # redraw the app icon, build/icon.png
npx tsx scripts/inspect.ts <ARENA folder> <out dir> WALLA.SET TITLE.IMG   # save images as PNGs to check the decoders
```

Releases are built on GitHub by `.github/workflows/release.yml`: raise the version in `package.json`, then run the
Release workflow from the Actions tab (or push a tag such as `v0.2.0`). It builds the Mac and Windows zips and
publishes them on the Releases page. The Mac app is ad-hoc signed rather than signed with a paid Apple certificate,
which is why macOS asks before opening it the first time.

The format details come from the community's research, mainly [UESP](https://en.uesp.net/wiki/Arena:Arena)
and the [OpenTESArena](https://github.com/afritz1/OpenTESArena) project. Anything the code marks as a guess still needs
checking against the original game.

## Legal

This is an unofficial fan project, not affiliated with or endorsed by Bethesda Softworks or ZeniMax Media.
The Elder Scrolls and Arena are trademarks of their owners. Arena is free to download, but its license allows
personal use only, so this repository never contains the game's files; the remake reads them from your own copy.
The menu's fonts, Alegreya and IM Fell English SC, are used under the SIL Open Font License.
