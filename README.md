# ES Arena

[![Support ES Arena on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N0C328KVIG)
[![Support ES Arena on Patreon](https://img.shields.io/badge/Support%20ES%20Arena%20on-Patreon-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/cw/Arenasloppa)

**The Elder Scrolls: Arena (1994), remade in Three.js.**

ES Arena is an unofficial remake of Bethesda's first Elder Scrolls game. It runs as a desktop app on Mac and Windows,
or in a web browser. It is written in TypeScript with Three.js by AI: Claude, made by Anthropic, and ChatGPT, made
by OpenAI.
You play it with your own copy of Arena: the game reads the original maps, textures, creatures, sounds and text from your
`ARENA` folder while it runs, so none of Bethesda's files are in this repository.

## Screenshots

![A goblin raises its axe at the player in the Imperial Dungeons, with its health under the compass, the minimap at the top right and the player's health at the bottom](docs/screenshots/goblin.png)

| | |
|---|---|
| ![Choosing a race on Arena's map of Tamriel, with Skyrim picked and the provinces listed beside the map](docs/screenshots/race.png)<br>Choosing a race on the map of Tamriel | ![Sharing out bonus points among the attributes, beside the paper doll of a Nord warrior](docs/screenshots/attributes.png)<br>Sharing out bonus points |
| ![The item menu, with the broadsword the character starts with picked, its picture from the game and its damage, weight and value](docs/screenshots/items.png)<br>The item menu | ![The character sheet, with the paper doll beside the attributes, health, damage and experience](docs/screenshots/character.png)<br>The character sheet |
| ![The cell where the game begins, with the dungeon's name across the top and the first objective in the corner](docs/screenshots/cell.png)<br>Arriving in the cell where Arena begins | ![Sneaking up behind a rat, with the eye that shows how close it is to noticing](docs/screenshots/sneak.png)<br>Sneaking up on a rat |
| ![The 3D map of the Imperial Dungeons, showing the parts explored so far](docs/screenshots/map.png)<br>The map fills in as you explore | ![The main menu, over a hall the remake draws itself](docs/screenshots/menu.png)<br>The main menu |
| ![The wait menu, with Arena's time and date over the hours to rest and Arena's two ways to camp](docs/screenshots/wait.png)<br>Waiting, with the date and time in Arena | ![The character sheet after two levels gained, with bonus points to share out and some already on Endurance](docs/screenshots/level.png)<br>A level gained, with bonus points to share out |
| ![The menu of menus, Skyrim's separated plus, with the items arm and its name lit as the player aims at it](docs/screenshots/tween.png)<br>The menu of menus, aiming at the items | |

The screenshots are taken from the game as it stands with `npm run screenshots` and retaken for every release.
They show Arena's own art, which the remake reads from a copy of the game. The [gallery](docs/gallery.md) keeps the
screenshots of earlier versions.

## What works so far

- Choose your `ARENA` folder and the game checks that it has everything it needs.
- Make your character in Skyrim's order, in Arena's own words: choose your gender, race and face together, with your
  race's province marked on Arena's map of Tamriel; pick a name (or a random one in your race's style, Arena's own or by
  the race's customs in the lore); answer ten questions or choose from the eighteen classes; and share out bonus points
  among attributes rolled by Arena's rules on a sheet that shows what the original's does. Arena's paper doll shows you
  as you are so far beside every step, and tries on each class's clothes and gear as you look through them. Your race,
  class and attributes count in play: they set your health, fatigue, damage, pace and how much you can carry, which
  armour and weapons you can use, and whether you can pick locks; and each race and class has its gifts from Arena,
  such as the Redguard's way with weapons, the Khajiit's climbing, the Argonian's swimming, the High Elf's immunity to
  paralysis, the Acrobat's leaps and the Ranger's extra damage.
- Escape the Imperial Dungeons where Arena begins: get out of your locked cell, get past the rats and goblins, and
  find the Shift Gate.
- Monsters with Arena's own pictures and stats. They wander, notice you when they see you, chase you round corners
  and fight, landing their blows by Arena's rule: the armour where they strike, your Agility against theirs and the
  levels on both sides decide whether a blow lands. Lizard Men and Spiders can paralyse you, as in Arena.
- Combat in Skyrim's style with Arena's weapons and swings: power attacks, blocking, bashing, and sneak attacks for
  three times the damage. While you sneak, an eye shows how close the creatures nearby are to noticing you.
- Arena's own spells, read from your copy: Fire Dart, Fireball, Shock, Heal, Light, Shield, Invisibility, Open,
  Medusa's Gaze and the rest of the Mages Guild's list that the remake can do so far (30 of its 64). Spellcasting
  classes have spell points as in Arena, by their class and Intelligence, and spells cost less at each level. Ready a
  spell in the magic menu and cast it with the block button, as with a spell in Skyrim's left hand; bolts fly, area
  spells burst, and paralysis, poison, shields and light last as many rounds as the game says.
- Camp as in Arena, from a wait menu like Skyrim's: rest some hours or until healed, by Arena's healing sums and in its
  words, though not with monsters near, and monsters may come upon you while you sleep. The first rest after reaching
  level 2 brings Ria Silmane's dream of the Staff of Chaos and of Fang Lair, in her own voice.
- Level up as in Arena: its experience for each level, your class's hit die for health, and 3 to 6 bonus points a
  level to share out among your attributes on the character sheet. Endurance's health bonus counts for every level you
  have, so raising it late is worth as much as raising it early.
- Health, stamina and healing potions. Search bodies and chests for gold, potions, weapons and armour, and open locked
  doors with their key, pick their locks or break them down.
- Skyrim's menus: a menu of menus for your character, items, magic and the map, where you aim at one and let go to
  open it; an item menu with the game's picture of each piece, where you equip, drink, favourite and drop things; a
  character sheet with Arena's paper doll wearing what you wear; and favourites you can put on number keys or the
  D-pad to use mid-fight.
- A 3D map that fills in as you explore, a minimap, quest objectives, and markers on the compass for the next
  objective and the creatures nearby.
- Arena's own sound effects, each coming from where it happens in the dungeon.
- Arena's own music, played as on a 1994 AdLib or Sound Blaster: the remake emulates the FM chip and plays the game's
  songs with the game's own instruments. The main menu, character creation, the visions and each dungeon have their
  songs, as in Arena.
- Arena's cutscenes: the opening with the book, the title and the scroll; the story of the Emperor's betrayal before
  you make a character; and Ria Silmane's visions, spoken by the CD version's voices with the words beneath, when you
  wake in your cell and when you die.
- The original wall, floor and ceiling textures, animated water and lava, raised platforms, doors that slide open,
  barred doors you can see through, decorations such as chains and barrels, and the dungeon's own messages when you
  reach their squares.
- Play with a controller or the keyboard and mouse, with Skyrim's controls, menu and HUD: a compass, button prompts
  that match your controller, jumping, sneaking and sprinting, and the dungeon's name as you arrive.

Coming later: cities and the wilderness, the Mages Guild and the spellmaker, and saving.

## Play it

You need your own copy of Arena; it's free on Steam and GOG.

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
| Block, attack while blocking to bash; with a spell readied, cast it | Right mouse button | LT (L2) |
| Use, take, open | <kbd>E</kbd> | A (✕) |
| Jump | <kbd>Space</kbd> | Y (△) |
| Sprint | <kbd>Shift</kbd> | LB (L1) |
| Sneak | <kbd>C</kbd> | Click the left stick (L3) |
| Favourites | <kbd>Q</kbd> | Up or down on the D-pad |
| Use the favourite on a number key | <kbd>1</kbd> to <kbd>8</kbd> (the healing potion starts on <kbd>1</kbd>) | Left or right on the D-pad, for 1 and 2 |
| Character, items, magic and map | <kbd>Tab</kbd> | B (○) |
| Items, magic | <kbd>I</kbd>, <kbd>P</kbd> | |
| Map | <kbd>M</kbd> | Down from the menu of menus (B) |
| Wait: camp for some hours or until healed (again to wake) | <kbd>T</kbd> | View (Share) |
| Pause menu | <kbd>Esc</kbd> | Start (Options) |

In the menu of menus, push a way with the arrow keys, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, the left stick
or the D-pad to light it, and let go to open it; <kbd>Enter</kbd> or A opens the lit one, and the mouse lights one by
pointing at it.

In the magic menu (<kbd>P</kbd>, or left from the menu of menus), ready a spell with <kbd>E</kbd> or A, make it a
favourite with <kbd>F</kbd> or Y, or put it on a number key by pressing the number.

In the item menu, pick a kind of item on the left (LB and RB also change it), then use or equip the picked one with
<kbd>E</kbd> or A, make it a favourite with <kbd>F</kbd> or Y, and drop it with <kbd>R</kbd> or X. Pressing a number
key puts it on that key. In the favourites, <kbd>1</kbd> to <kbd>8</kbd>, or left and right on the D-pad, do the same.
<kbd>Esc</kbd> or B goes back, and <kbd>Tab</kbd> goes straight back to the game.

On the map, move with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or the left stick, drag with the mouse or use
the right stick to turn it, and zoom with the mouse wheel or the triggers.

In the main menu and character creation, move with the arrow keys, the D-pad or the left stick, choose with
<kbd>Enter</kbd> or A, change a setting with left and right, and go back with <kbd>Esc</kbd> or B. The Settings screen
sets look speed, inverted look, sound and music volume, whether the opening plays and vibration, and changes the
ARENA folder.

In a cutscene, <kbd>Enter</kbd>, <kbd>Space</kbd>, a click or A goes on to the next picture or line, and <kbd>Esc</kbd>,
B or Start skips the rest.

### Files it reads

The game needs these files from your copy: `GLOBAL.BSA`, `ACD.EXE` (or the floppy version's `A.EXE`), `PAL.COL`,
`TEMPLATE.DAT`, `QUESTION.TXT`, `CITYDATA.65`, `SPELLSG.65`, and a font (`ARENAFNT.DAT` or `FONT_A.DAT`).
The monsters' and weapons' stats come from the game's program, `ACD.EXE` or `A.EXE`, which the remake unpacks in
memory; the pictures, animations and sounds come from `GLOBAL.BSA`. Character creation reads its questions, classes,
names and words from `QUESTION.TXT`, `CLASSES.DAT`, `NAMECHNK.DAT` and the game's program, the map of Tamriel from
`TAMRIEL.MNU`, and the faces, clothes and armour of the paper doll from `GLOBAL.BSA`; without them it offers three
classes of its own. The spells come from `SPELLSG.65`. The music is in `GLOBAL.BSA` and its instruments in `SAMPLE.AD`
(or `SAMPLE.OPL`); without them the game is silent. The cutscenes are the CD version's loose `.FLC` animations and the
pictures in `GLOBAL.BSA`, with the visions' words from `TEMPLATE.DAT` and their voices from the `SPEECH` folder; any
that are missing are left out. Loose files take priority over the copies inside `GLOBAL.BSA`, as in the original. Saves and other
files a played copy creates (`SAVEGAME.0x`, `WILD00x.0x`, `AUTOMAP.0x`, `*.$$$`, `SOUND.CFG`, `VISION.EMS`) are ignored.

## How it works

| Path | What it does |
|---|---|
| `src/formats/` | Readers for Arena's file formats: the BSA archive, COL palettes, IMG/SET/RCI images, CIF and CFA animations, VOC sounds, MIF maps, INF level definitions, the game's program (unpacking it and reading the creature, weapon, armour and class tables and the character creation words), the class questions and name pieces, the LZSS and LZHUF decompressors, the spells, the XMI music and its instruments, the FLC cutscenes and the game's texts. No browser or Three.js code. |
| `src/data/` | Finding and reading the player's `ARENA` folder, and checking the required files. |
| `src/game/` | The level model built from a MIF map and its INF file, movement and collision, the character and what their class and attributes do, the monsters, combat, the inventory, the quest, what the player has explored, and the game loop. |
| `src/audio/` | Arena's sound effects, played through the Web Audio API so each comes from where it happens, and its music: an emulated AdLib FM chip, a sound driver that plays the songs on it as the game's did, and a player that makes each song into sound in the background and loops it. |
| `src/input/` | Controllers, read through the browser's Gamepad API. |
| `src/ui/` | The Skyrim-style menu and HUD: moving through the menu, character creation, the menus over the game, the compass, the minimap, button prompts and the settings. |
| `src/render/` | Turning a level into Three.js meshes and textures, the creatures, the weapon in hand, the 3D map, the paper doll and item pictures, the film of the first dungeon behind the main menu, and the stand-in hall shown there without the game, whose textures the remake draws itself. |
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
npm run screenshots -- <ARENA folder>   # retake the screenshots in docs/screenshots, keeping the old ones for the gallery (then npm run build)
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

ES Arena is free. If you enjoy it, you can support it on Ko-fi.

Your support helps buy the AI tokens that Claude and ChatGPT use to write the game, which means more time spent working
on it and more of Arena, sooner. Every little bit helps. Thank you!

[![Support ES Arena on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N0C328KVIG)
[![Support ES Arena on Patreon](https://img.shields.io/badge/Support%20ES%20Arena%20on-Patreon-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/cw/Arenasloppa)

## Legal

This is an unofficial fan project, not affiliated with or endorsed by Bethesda Softworks or ZeniMax Media.
The Elder Scrolls and Arena are trademarks of their owners. Arena is free to download, but its license allows
personal use only, so this repository never contains the game's files; the remake reads them from your own copy.
The screenshots show the game's art as the remake draws it from a copy of the game.
The menu's fonts, Cinzel and Barlow Condensed, are used under the SIL Open Font License.
