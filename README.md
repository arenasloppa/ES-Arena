# ES Arena

**The Elder Scrolls: Arena (1994), remade by an AI in Three.js.**

ES Arena is an unofficial remake of Bethesda's first Elder Scrolls game that runs in a web browser.
It is written by Claude, an AI model made by Anthropic, in TypeScript with Three.js.
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

Coming later: creatures and combat, sound and music, cities and the wilderness, character creation, saving,
and a desktop app for PC and Mac.

## Play it

You need a copy of Arena (it's free on Steam) and [Node.js](https://nodejs.org) 20 or newer.

```sh
npm install
npm run dev
```

Open the address it prints, click **Choose ARENA folder…** and pick the `ARENA` folder, the one that holds `GLOBAL.BSA`.
In the Steam release it sits inside the game's install folder; the GamesNostalgia downloads call it `arena` (Windows)
or `game/Resources/arena` (Mac). Picking a folder above it also works, since the game looks a few folders down,
and file name case doesn't matter. Your files are read in the browser and never uploaded anywhere.

| Key | Action |
|---|---|
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move |
| Mouse | Look (click the view to capture the mouse, or drag where it can't be captured) |
| Arrow keys | Turn and move |
| <kbd>Shift</kbd> | Run |
| <kbd>E</kbd>, <kbd>Space</kbd> or click | Open doors |
| <kbd>Esc</kbd> | Menu |

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
| `tests/` | Unit tests. `tests/helpers/encode.ts` builds fake archives, maps and compressed data, so the tests never need the real game files. |

```sh
npm test            # unit tests
npm run typecheck
npm run build       # static build in dist/
npx tsx scripts/inspect.ts <ARENA folder> <out dir> WALLA.SET TITLE.IMG   # save images as PNGs to check the decoders
```

The format details come from the community's research, mainly [UESP](https://en.uesp.net/wiki/Arena:Arena)
and the [OpenTESArena](https://github.com/afritz1/OpenTESArena) project. Anything the code marks as a guess still needs
checking against the original game.

## Legal

This is an unofficial fan project, not affiliated with or endorsed by Bethesda Softworks or ZeniMax Media.
The Elder Scrolls and Arena are trademarks of their owners. Arena is free to download, but its license allows
personal use only, so this repository never contains the game's files; the remake reads them from your own copy.
