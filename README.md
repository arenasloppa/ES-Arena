# ES Arena

A remake of *The Elder Scrolls: Arena* (Bethesda, 1994) in TypeScript and Three.js, for PC and Mac.

**This repository contains no Bethesda game files.** You play with your own copy of Arena:
the game asks for your ARENA folder and reads everything (maps, textures, text) from it at runtime.
Arena is free from Bethesda; its license allows personal use only, so its files must never be committed here.

## Status

First playable milestone:

- Pick your ARENA folder in the browser; the game checks the required files are there.
  In Chrome and Edge it can remember the folder between visits. Before a folder is picked, the menu sits over a
  stand-in hall whose textures the remake generates itself.
- Walk around the starting dungeon (`START.MIF`) in first person, or any other map from the menu.
- Textured walls, floors and ceilings, animated water and lava, raised platforms, doors that open,
  static decorations, and the dungeon's text messages when you step on their trigger squares.

Not yet: creatures and animated sprites, combat, sound and music, the automap, cities and wilderness,
character creation, saving. A desktop wrapper for PC and Mac comes later.

## Running it

Requires Node 20 or newer.

```sh
npm install
npm run dev      # then open the printed localhost URL
```

Click **Choose ARENA folder…** and pick the `ARENA` folder from your copy of the game, the one that holds `GLOBAL.BSA`.
In the free Steam release it sits inside the game's install folder; the GamesNostalgia downloads call it `arena`
(Windows) or `game/Resources/arena` (Mac). Picking a folder above it also works, since the game looks a few folders down,
and file name case doesn't matter. Saves and other files a played copy creates (`SAVEGAME.0x`, `WILD00x.0x`,
`AUTOMAP.0x`, `*.$$$`, `SOUND.CFG`, `VISION.EMS`) are ignored.

Controls: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, mouse to look (click the view to capture it, or drag where the mouse can't be captured),
arrow keys turn, <kbd>Shift</kbd> runs, <kbd>E</kbd> / <kbd>Space</kbd> / click opens doors, <kbd>Esc</kbd> opens the menu.

Other scripts:

```sh
npm test           # unit tests (synthetic data only, no game files needed)
npm run typecheck
npm run build      # static build in dist/
npx tsx scripts/inspect.ts <arena folder> <out dir> WALLA.SET TITLE.IMG   # dump images to PNG for checking decoders
```

## Files the game needs

Required: `GLOBAL.BSA`, `ACD.EXE` (or the floppy `A.EXE`), `PAL.COL`, `TEMPLATE.DAT`, `QUESTION.TXT`,
`CITYDATA.65`, `SPELLSG.65`, and a font (`ARENAFNT.DAT` or `FONT_A.DAT`).
Loose files in the folder take priority over the copies inside `GLOBAL.BSA`, as in the original.

## Code layout

| Path | What it does |
|---|---|
| `src/formats/` | Parsers for Arena's file formats: BSA archive, COL palettes, IMG/SET/RCI images, MIF maps, INF level definitions, and the LZSS/LZHUF decompressors. No browser or Three.js dependencies. |
| `src/data/` | Reading the player's folder (File System Access API or a folder upload) and validating it. |
| `src/game/` | Level model built from MIF + INF, player movement and collision, the game loop. |
| `src/render/` | Turning a level into Three.js meshes and textures. |
| `tests/` | Vitest unit tests. `tests/helpers/encode.ts` builds synthetic BSA/MIF/INF/LZHUF data so tests never need the real files. |

Format notes come from the community's documentation (UESP's Arena file format pages and the OpenTESArena project);
anything marked as a guess in the code still needs checking against the original game.
