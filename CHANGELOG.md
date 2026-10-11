# Update log

Every release of ES Arena, newest first. Each one is on the
[Releases page](https://github.com/arenasloppa/ES-Arena/releases) with its downloads.

## 0.5.0 (2026-10-11)

Magic, Arena's music and cutscenes, its dungeons built as it builds them, camping, and character creation checked against the original game itself.

Magic, with Arena's own spells.

- The spells come from your copy of Arena (SPELLSG.65), and do what the game's own spellmaker says of them: damage and healing that grow with your level, chances to paralyze or poison, shields, sanctuary, invisibility, light, opening locks and regeneration, lasting as many rounds as the game gives (a round is five seconds). 30 of the 64 can be cast so far; the rest need things the remake doesn't have yet, such as levitating, curing and resistances.
- Spellcasting classes have spell points as in Arena: Intelligence times their class's multiplier (three for a Sorcerer, two for a Mage or Healer, and so on). A spell costs its cost divided by your level, so spells get cheaper as you rise. Spell points come back slowly over time and with rest, except a Sorcerer's.
- You start as Arena starts you, with a healing spell and an offensive one: Light Heal and Fire Dart. As in Arena, more are bought at the Mages Guild, not learnt by levelling.
- The magic menu (P, or left from Tab's menu) lists your spells with what each does at your level, its cost, target and element. Ready one and cast it with the block button (right mouse button or LT), as with a spell in Skyrim's left hand. Spells can be favourites and go on number keys and the D-pad.
- Bolts fly glowing in their element's colour and burst where they land; Fireball and the like catch everything near the burst, and touch spells work on the creature in reach.
- A magicka bar at the bottom left, as in Skyrim, with the readied spell and its cost above it and the spells working on you, such as a shield's points left.

Music and cutscenes.

- Arena's music, as it sounded on an AdLib or Sound Blaster in 1994: the remake emulates the FM chip and its sound driver, and plays the game's own songs with the game's own instruments (SAMPLE.AD). The main menu plays its theme, character creation its own, Ria Silmane's visions theirs, and each dungeon one of Arena's five dungeon songs. Set the music's volume on the Controls screen.
- The opening when you open your Arena folder: the book, the title, the quote and the scroll of how the Empire came to be. Turn it off on the Controls screen, or watch it again from the main menu.
- Before a new character, the scroll and the nine pages of how Jagar Tharn betrayed the Emperor.
- After making your character, Ria Silmane's vision in your cell, and her farewell when you die, in her own voice from the CD version, with her words beneath and your name in them.
- In a cutscene, Enter, Space, a click or A goes on to the next picture or line, and Esc, B or Start skips the rest.

The Imperial Dungeons as Arena builds them.

- Heights from the game's own data: the ceiling, the room height and the thickness of raised platforms come from each level's INF file and the program's platform tables, so ledges, slabs and overhangs stand at Arena's heights. The ceiling has its own texture instead of the floor's.
- Step up anything up to Arena's step height and jump onto what is higher; walk under platforms high enough to clear.
- Water is swum in: you drop in, swim at half speed (Argonians at full speed), tire thirty times as fast (Argonians twelve), and drown when your fatigue runs out. Pits are a full room deep. Climb out of either by walking into the edge, as in Arena.
- Lava burns. Doors raise, swing, slide or split as the map says, and fences, see-through walls and solid decorations block the way as they should.
- The main menu is like Skyrim's: Continue, New, Settings and Quit, with no map list; the folder is chosen in Settings.

Camping and Ria's dreams.

- Wait as in Skyrim (T, or View on a controller), with Arena's date and time at the top ("12:00 noon", "Tirdas, 1st of Hearthfire in the year 3E 389", from the game's own calendar and its starting time), and camp as in Arena: "How many hours do you wish to rest?", then "Camp for a while..." or "Until fully healed". As in the original, the clock runs on 20 minutes at a time, quickly ("3 hours remaining..." counts down in a moment, as it does in the original), and each hour health, fatigue and spell points come back by the program's sums: more with a good heal mod, more for a Healer, the heal mod again for a Barbarian, and no spell points for a Sorcerer. You can't move or look about while camping; T or View again wakes you.
- Arena's refusals, in its words: "You can't camp. Enemies are nearby!!!" with a monster within eight cells, "You can't camp here." in water, climbing or in the air, and "You don't need to rest." when nothing needs healing.
- Each hour of rest, monsters may come upon you: 20 percent an hour in the Imperial Dungeons, from the game's own encounter tables, by Arena's rules for which monsters and how many, appearing on open floor around you. If they're close, "There are enemies nearby..." and the rest is over. Encounters of people rather than creatures bring nobody yet, as the remake has no human foes so far.
- Once the first rest after reaching level 2 is over (as the program shows the main quest's vision after resting), Ria Silmane comes to your dreams, as UESP describes: the Staff of Chaos (STAFF.FLC, the game's text #1500 in her voice), then where its first piece lies, Fang Lair (#1294). As in the original, a player who reaches level 3 before resting only hears of Fang Lair.
- The map moves to the menu of menus on a controller, as in Skyrim, where View is the wait button.
- Every cutscene is checked against the original's order: the opening (book, title, quote, scroll), the story before a new character, Ria's vision after making one, her dreams, and on death her farewell, or Jagar Tharn's taunt once the player holds a piece of the Staff (none can in the Imperial Dungeons). Leaving the Imperial Dungeons plays nothing in Arena either; it takes you to a town of your home province, which the remake doesn't have yet.

Sounds and triggers as the levels give them.

- Doors make the sounds their level's INF lists for their kind: the Imperial Dungeons' raising doors grind like the portcullis they are (PORTC), sliding doors grind (GRIND), and swinging doors creak open and thud once shut.
- A map's messages show each time you step on them, as in Arena; only those the INF marks to show once ("You awaken to the drip of water...") show just once.

Character creation by Arena's rules.

Checked against the original itself: the remake now runs your copy of Arena in DOSBox to compare, and reads its program where the wikis and OpenTESArena disagree with what it shows.

- Attributes are rolled as the program rolls them: your race and gender's own values in the game, on Arena's scale of 0 to 255, plus a roll of 20 and one more, where Arena's dice are dice of six or five counting from 0. Bonus points are a roll of 25, health is 25 plus a roll of your class's hit die plus Endurance's bonus, and gold is 50 to 199. 88 sheets rolled in the original all fit.
- The sheet's numbers are worked out as the original shows them: Damage from Strength on Arena's own scale, Magic Def, To Hit, To Defend and Charisma a step for every five points from 50, Health and Heal Mod a step for every ten from 45. (OpenTESArena holds some of these at 0 or -1 for low values; the original doesn't: Strength 39 shows Damage -1.) Spell points show as now and most, 0/0.
- The steps come in Arena's order, in its words: class, then name, then gender, then your province on a map with no Exit (covered, as in Arena, by the game's own NOEXIT.IMG), its shadow following the parchment's torn edges; after your race is confirmed, "Know ye this also:" and your race's description from the game, what your class needs, and "Go ye now in peace" before the attributes.
- The attribute sheet shows what Arena's does: Damage and Max Kilos beside Strength, Spell Pts beside Intelligence, Magic Def beside Willpower, To Hit and To Defend beside Agility, Health and Heal Mod beside Endurance, Charisma beside Personality, and your health, fatigue, gold, experience and level. Done always asks Arena's "Which dost thou choose?"; Save stats with points left says "You must distribute all your bonus points.", and Reroll stats rolls everything again.
- You start as the original starts you: one plain weapon by your class (a dagger for the six spellcasting classes, a shortsword for the next six, a broadsword for the rest), no armour and no potions, your rolled gold and 700 experience. Spellcasters start with Fire Dart and Light Heal, and, as in Arena, learn no more by levelling.
- A level is given as Arena gives it: checked each game minute, and only with no monsters near and you not resting, so a level won in a fight comes once it's over. Each adds a roll of the hit die and Endurance's bonus to health; fatigue doesn't grow with level, being Strength plus Endurance.
- Luck does what UESP says, out of sight as in Arena (its row on the sheet is blank there; the remake borrows Oblivion's words: it has an effect on everything you do): a little toward dodging blows, picking locks, landing critical hits and the gold you find. Its exact sums in the original aren't known.
- In play, fatigue (stamina) is Strength plus Endurance, Strength's damage bonus and Max Kilos are Arena's, and Speed sets your pace by Arena's formula.

## 0.4.1 (2026-10-11)

Skyrim's plus-shaped menu, and a steady map in character creation.

- The menu of menus (Tab, or B on a controller) is now Skyrim's separated plus instead of a ring, with magic to the left and your items to the right as in Skyrim. Pushing a way opens its menu straight away.
- The map of Tamriel stays still while you move between provinces in character creation. Only the diamond moves.

## 0.4.0 (2026-10-11)

Character creation as in Arena, and Skyrim's menus for your items, favourites and character.

- Make your character as Arena does, in its own words: answer ten questions or choose from the eighteen classes, pick a gender and a name (or a random one made from the game's names), choose your race by its province on the map of Tamriel, share out bonus points among your rolled attributes, and pick one of ten faces. The game remembers your character, and New character in the menu makes another.
- Your class and attributes now count. The class sets your health each level, the experience you need, and which armour, shields and weapons you can use. Thieves can pick locks, and some classes land critical strikes. Strength adds to your blows and to what you can carry, Endurance to your health, Speed to your pace, Agility to dodging, Willpower to how fast your stamina comes back, and Luck to the gold you find.
- You start with your class's own weapon and armour, and find armour and shields as well as weapons in chests and on bodies. The armour you wear takes blows down. Everything has a weight, and carrying more than your Strength allows stops you running.
- Tab, or B on a controller, opens Skyrim's menu of menus: your character above, your items to the left, magic to the right and the map below.
- The item menu lists what you carry by kind, with the game's picture of the picked piece and its armour or damage, weight and value. Equip it or take it off, drink a potion, make it a favourite, or drop it. I opens it straight away.
- The character sheet shows Arena's paper doll wearing what you wear, beside your attributes, health, damage and experience.
- Favourites, as in Skyrim: Q, or up or down on the D-pad, lists them down the left of the screen. Put any favourite on a number key from 1 to 8, or on the D-pad's left or right, to use it mid-fight. The healing potion starts on 1, so 1, or left on the D-pad, now drinks one.
- The pause menu says who you are playing, and the menus fit on smaller windows such as 1280x720.
- A [gallery](https://github.com/arenasloppa/ES-Arena/blob/main/docs/gallery.md) keeps the screenshots of earlier versions.

## 0.3.1 (2026-10-11)

Fixes for the first dungeon, a plainer minimap and a Ko-fi button.

- Rats and goblins coming straight at you no longer flick from side to side.
- Coming back from the map or the menu no longer shows the last title across the top again, such as your level.
- Closing the map or the menu with Esc now waits for the key to come back up before taking the mouse again, so the browser doesn't let go of it and bring the menu back.
- The minimap is now one plain circle with the map in it, without the compass letter.
- A Ko-fi button in the top corner of the main menu, for anyone who would like to support the project.

## 0.3.0 (2026-10-11)

The first dungeon, playable from your cell to the Shift Gate, with monsters, combat and sound.

- Rats and goblins now roam the Imperial Dungeons, where the original game puts them, drawn with Arena's own pictures and using its stats. They wander, notice you when they see you, chase you round corners and fight back.
- Fight with Arena's weapons and swings, using Skyrim's controls: attack with the left mouse button or RT, hold it for a power attack, block with the right mouse button or LT, and attack while blocking to bash an enemy off balance.
- Sneak up on a creature that hasn't noticed you for a sneak attack that does three times the damage. While you sneak, an eye shows how close the creatures nearby are to noticing you. They notice you more slowly from behind.
- Health and stamina bars, a health bar for the creature you're fighting, healing potions (Q, or up on the D-pad), and levels that raise your health and stamina.
- Your cell door is locked: find its key, or keep hitting the lock until it breaks. Search bodies and chests, and pick up gold, potions and better weapons.
- Step through the Shift Gate to escape, and see your time, what you slew and how much you explored. If you die, you can try again.
- Quest objectives in the corner, with markers on the compass for the next objective and for the creatures nearby.
- A 3D map that fills in as you explore (M, or View on a controller), and a minimap in a frame at the top right.
- Arena's own sound effects, each coming from where it happens in the dungeon. Set the volume on the Controls screen.
- More of Skyrim's touches: the dungeon's name as you arrive, a banner when you level up or clear a dungeon, fades in and out, a wider view while you sprint, and blood on the screen when your blow lands.
- Decorations are drawn at their proper size, things on raised platforms stand on them, barred doors can be seen through, and walls and doors use the textures the original gives them.
- The README now has screenshots of the game, retaken for every release.

## 0.2.0 (2026-10-11)

Controllers, and a new look in the style of Skyrim.

- Play with a controller: Xbox, PlayStation, Switch Pro and most others. The buttons are Skyrim's: the left stick moves, the right stick looks, A opens doors, Y jumps, LB sprints, clicking the left stick sneaks, and B or Start opens the menu.
- The menus work with a controller too, and the on-screen prompts show your controller's own buttons, or your keys when you use the keyboard.
- A new menu and HUD styled after Skyrim's, with a compass, a prompt when you look at a door, and the dungeon's messages along the bottom of the screen.
- You can now jump, sneak and sprint. On the keyboard, E opens doors, Space jumps, C sneaks, Shift sprints, and Esc or Tab opens the menu.
- A Controls screen lists every key and button and sets look speed, inverted look and vibration. The game remembers your settings.
- The game pauses if your controller is unplugged.
- Dungeons are no longer mirrored: they are laid out as in the original game, so directions in their messages, such as "go west", match the compass.

## 0.1.0 (2026-10-11)

The first release.

- Walk the Imperial Dungeons where Arena begins, in first person, or pick any other map in the game from the menu.
- The original wall, floor and ceiling textures, animated water and lava, raised platforms, doors that slide open, decorations such as chains and barrels, and the dungeon's own messages when you reach their squares.
- Plays from your own copy of Arena: choose the `ARENA` folder from the Steam or GamesNostalgia release and the game checks it has everything it needs. Save files are left alone.
- A desktop app for Mac (Apple chip and Intel) and Windows that remembers your folder and works offline.
