/**
 * Random names for Arena's eight races, made two ways. Arena makes them from
 * the name pieces in NAMECHNK.DAT, by rules for each race and gender, and
 * the remake does the same with the player's copy. The remake also makes
 * them by each race's customs as UESP's Lore:Names describes them: Bretons'
 * family names, Nords' patronymics and epithets, Khajiit's prefixes of rank,
 * Argonians' Jel names and the names they take among other races, and so
 * on. Those come from the remake's own syllables and words.
 */
import type { Gender } from './character';
import type { Random } from './combat';

/**
 * How each race's names are put together from the groups of name pieces:
 * a piece from each numbered group in turn, with the words between.
 */
const NAME_RULES: Array<Record<Gender, Array<number | string>>> = [
  { male: [0, 1, ' ', 4, 5], female: [2, 3, ' ', 4, 5] },
  { male: [6, 7, 8, 9], female: [6, 7, 8, 10] },
  { male: [11, 12, ' ', 15, 16, 'sen'], female: [13, 14, ' ', 15, 16, 'sen'] },
  { male: [17, 18, ' ', 21, 22], female: [19, 20, ' ', 21, 22] },
  { male: [23, 24, ' ', 27, 28], female: [25, 26, ' ', 27, 28] },
  { male: [29, 30, ' ', 33, 34], female: [31, 32, ' ', 33, 34] },
  { male: [35, 36], female: [37, 38] },
  { male: [47, 48, 49], female: [47, 48, 49] },
];

/** A name made as Arena makes them, from the game's name pieces; undefined without them. */
export function arenaName(race: number, gender: Gender, random: Random, names?: string[][]): string | undefined {
  const rule = NAME_RULES[race]?.[gender];
  if (!names || !rule || !rule.every((part) => typeof part === 'string' || names[part]?.length)) return undefined;
  const pick = picker(random);
  const name = rule.map((part) => (typeof part === 'string' ? part : pick(names[part]))).join('');
  return name.replace(/(^|\s)([a-z])/g, (_, space: string, c: string) => space + c.toUpperCase()).trim();
}

/** The start and end of a name, put together. */
interface Syllables {
  starts: string[];
  ends: string[];
}

const BRETON = {
  male: { starts: ['Ad', 'Al', 'Bel', 'Cas', 'Ed', 'Gar', 'Gil', 'Jul', 'Lu', 'Mar', 'Ren', 'Rob', 'Ser', 'Tib', 'Yv', 'Fer', 'Ber', 'Gau', 'Mau', 'Ger'], ends: ['ric', 'bert', 'mond', 'ard', 'ien', 'el', 'ain', 'ot', 'vin', 'ance', 'iel', 'ard'] },
  female: { starts: ['Ad', 'Al', 'Bel', 'Cel', 'El', 'Gen', 'Is', 'Jul', 'Lis', 'Mar', 'Ros', 'Syl', 'Yv', 'An', 'Mir', 'Ger'], ends: ['ine', 'ette', 'elle', 'aine', 'ienne', 'ise', 'eline', 'anne', 'ore', 'ie'] },
  family: { starts: ['Bel', 'Dur', 'Mar', 'Ver', 'Lan', 'Fon', 'Mont', 'Rou', 'Gal', 'Cor', 'Val', 'Ber', 'Sen', 'Vos', 'Del'], ends: ['ence', 'eau', 'ard', 'ier', 'ois', 'ac', 'elle', 'oux', 'enne', 'ault', 'ane', 'ille'] },
};
const REDGUARD = {
  male: { starts: ['Ba', 'Da', 'Ha', 'Ka', 'Ma', 'Na', 'Sa', 'Ta', 'Za', 'Ja', 'Ra', 'Ya', 'Ke', 'Ze', 'Ku', 'Ab', 'Ish', 'Om'], ends: ['shir', 'dir', 'mal', 'zan', 'hir', 'ram', 'tu', 'jid', 'sim', 'kim', 'ruk', 'reem', 'mad', 'dul'] },
  female: { starts: ['A', 'Ba', 'Da', 'Ha', 'Ka', 'Ma', 'Na', 'Sa', 'Za', 'Ja', 'Ya', 'Ise', 'Ze', 'Lei'], ends: ['ra', 'ia', 'dia', 'ima', 'na', 'isha', 'eda', 'iya', 'una', 'zara', 'mira', 'ena'] },
};
const NORD = {
  male: { starts: ['Hal', 'Ing', 'Sig', 'Thor', 'Ulf', 'Vig', 'Har', 'Gun', 'Hro', 'Ska', 'Bru', 'Ein', 'Ste', 'Tor', 'Kjel', 'Ragn', 'Arn', 'Os'], ends: ['ar', 'mund', 'geir', 'rik', 'vald', 'gar', 'stein', 'bjorn', 'ulf', 'mar', 'leif', 'grim', 'vard'] },
  female: { starts: ['As', 'Bri', 'Fri', 'Gud', 'Hel', 'Ing', 'Sig', 'Ast', 'Ran', 'Thor', 'Sol', 'Lyd', 'Ulf', 'Svan', 'Rag', 'Ey', 'Kel'], ends: ['a', 'rid', 'dis', 'hild', 'veig', 'run', 'unn', 'frid', 'gerd', 'borg', 'ja'] },
  /** Epithets, as many Nords go by in place of a father's name. */
  epithets: { starts: ['Frost', 'Snow', 'Stone', 'Iron', 'Storm', 'Battle', 'Wolf', 'Ice', 'Bear', 'Ash', 'Grey', 'Raven', 'Oak', 'Elk'], ends: ['Mane', 'Shield', 'Heart', 'Hand', 'Brow', 'Mantle', 'Fist', 'Blood', 'Song', 'Eye', 'Beard', 'Axe'] },
};
const DARK_ELF = {
  male: { starts: ['Dre', 'Ald', 'Bra', 'Fal', 'Gal', 'Mer', 'Nel', 'Ral', 'Tel', 'Vel', 'Dral', 'Sad', 'Ul', 'Var', 'Ath', 'Tal'], ends: ['vis', 'yn', 'as', 'os', 'ar', 'ed', 'im', 'ys', 'ros', 'van', 'dyn', 'eth'] },
  female: { starts: ['Ad', 'Bre', 'Dra', 'Ess', 'Gil', 'Ili', 'Mal', 'Nel', 'Ser', 'Tir', 'Vel', 'Ald', 'Sul', 'Mer'], ends: ['ise', 'ya', 'asa', 'yne', 'ena', 'is', 'ra', 'ys', 'eth', 'ana', 'ura'] },
  family: { starts: ['And', 'Dar', 'Hla', 'Ind', 'Lleth', 'Mor', 'Nel', 'Rav', 'Sar', 'Tel', 'Uvi', 'Vel', 'Dral', 'Ser', 'Ath', 'Gal'], ends: ['ano', 'ri', 'oran', 'eth', 'ys', 'ani', 'vel', 'aren', 'ilu', 'ethi', 'ur', 'ion', 'eni', 'oro'] },
};
const HIGH_ELF = {
  male: { starts: ['Aic', 'Cal', 'Ear', 'Ela', 'Ent', 'Ond', 'Faer', 'Lar', 'Nar', 'Qua', 'Tar', 'Ulu', 'Var', 'Hal', 'Sin', 'Orm'], ends: ['ano', 'ion', 'ilmo', 'emar', 'indil', 'atir', 'orion', 'amo', 'arel', 'andil', 'imo', 'anwe'] },
  female: { starts: ['Ael', 'Ar', 'Cal', 'El', 'Fai', 'Lir', 'Nel', 'Tar', 'Yav', 'Am', 'Ilm', 'Sar', 'Ond', 'Fin'], ends: ['wen', 'anya', 'iel', 'ire', 'ilde', 'ara', 'enwe', 'ya', 'esse', 'inde', 'iriel', 'ane'] },
  family: { starts: ['Al', 'Ca', 'Lan', 'Ser', 'Tel', 'Va', 'Ar', 'Fa', 'Ond', 'Sun', 'Mer', 'Hel'], ends: ['inor', 'ellin', 'arion', 'andil', 'orne', 'atir', 'enar', 'imo', 'iel'] },
};
const WOOD_ELF = {
  male: { starts: ['Ael', 'Bel', 'Cyl', 'Ein', 'Faen', 'Gal', 'Hen', 'Laer', 'Nir', 'Ran', 'Thal', 'Gwil', 'Ner', 'Anor', 'Elr', 'Ur'], ends: ['dal', 'rin', 'ion', 'ath', 'ir', 'nil', 'dir', 'on', 'las', 'dor', 'uin', 'aen'] },
  female: { starts: ['Ae', 'Ber', 'Cel', 'Ely', 'Fae', 'Gwe', 'Lin', 'Mae', 'Nia', 'Sil', 'Thi', 'Yel', 'Ara', 'Wy'], ends: ['nia', 'wen', 'riel', 'lyn', 'dra', 'na', 'ira', 'eth', 'wyn', 'mie'] },
  family: { starts: ['Moss', 'Oak', 'Fern', 'Elm', 'Thorn', 'Leaf', 'Brook', 'Ash', 'Wild', 'Green', 'Briar', 'Pine'], ends: ['wood', 'shade', 'glen', 'song', 'bough', 'root', 'dale', 'whisper', 'runner', 'hollow'] },
};
const KHAJIIT = {
  /** Prefixes of rank and age, which change as the Khajiit's place in life does. */
  prefixes: ["J'", "Ri'", "Ra'", "Dro'", "M'", "S'", "Do'", "Ma'", "Dar'", "Ja'"],
  male: { starts: ['zar', 'has', 'mad', 'kir', 'shaz', 'rid', 'jor', 'ahz', 'kha', 'nas', 'bik', 'tsa', 'sha', 'bar', 'zah', 'qa'], ends: ['go', 'ari', 'an', 'ash', 'ir', 'ad', 'uk', 'abi', 'iz', 'jo', 'hi', 'ran', 'kar'] },
  female: { starts: ['zay', 'ahk', 'shan', 'kaj', 'ni', 'ras', 'tsa', 'ka', 'ma', 'sa', 'ri', 'jha'], ends: ['a', 'iba', 'ara', 'ri', 'ira', 'ina', 'sa', 'ani', 'ha', 'iya', 'jhi'] },
  /** Endings some take as they rise: a warrior's, a thief's, a youngster's. */
  suffixes: ['do', 'dar', 'ji'],
};
const ARGONIAN = {
  jel: { starts: ['Tee', 'Jee', 'Hei', 'Wee', 'Dee', 'Mee', 'Nee', 'Xee', 'Bei', 'Sei', 'Gu', 'Ja', 'Ree', 'Ux', 'Ka', 'Ta', 'Ma', 'Vu', 'Oka', 'Ash'], ends: ['ba', 'ja', 'lar', 'sha', 'tei', 'ra', 'ko', 'ruk', 'nai', 'zei', 'meen', 'wan', 'ka', 'xul', 'lus', 'tul'] },
  /** Names taken among the other races, saying what the Argonian does. */
  does: ['Swims', 'Walks', 'Hides', 'Reads', 'Sings', 'Waits', 'Wades', 'Dreams', 'Climbs', 'Sleeps', 'Hunts', 'Speaks', 'Counts', 'Follows', 'Watches', 'Drinks', 'Runs', 'Gathers'],
  how: ['in', 'with', 'under', 'through', 'beneath', 'by', 'among', 'at', 'before', 'over'],
  what: ['Reeds', 'Mud', 'Rain', 'Shadows', 'Roots', 'Water', 'Stars', 'Mist', 'Stones', 'Marsh', 'Moss', 'Night', 'Tides', 'Ash', 'Leaves', 'Rivers'],
};

/** A name by the race's customs, as UESP describes them, from the remake's own syllables and words. */
export function loreName(race: number, gender: Gender, random: Random): string {
  const pick = picker(random);
  const chance = (p: number) => random() < p;
  const make = (s: Syllables) => {
    const start = pick(s.starts);
    let end = pick(s.ends);
    // No letter doubled where the two meet.
    if (end[0] === start[start.length - 1].toLowerCase()) end = end.slice(1);
    return start + end;
  };
  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (race) {
    case 0: // Bretons: a given name and a family name, after High Rock's courtly ways.
      return `${make(BRETON[gender])} ${make(BRETON.family)}`;
    case 1: // Redguards: a single Yokudan name.
      return make(REDGUARD[gender]);
    case 2: {
      // Nords: a given name and their father's with -sen, as Arena has them, or an epithet.
      const second = chance(0.5) ? `${make(NORD.male)}sen` : `${pick(NORD.epithets.starts)}-${pick(NORD.epithets.ends)}`;
      return `${make(NORD[gender])} ${second}`;
    }
    case 3: // Dark Elves: a given name and a house's or family's.
      return `${make(DARK_ELF[gender])} ${make(DARK_ELF.family)}`;
    case 4: {
      // High Elves: long, flowing names, the family's often left off.
      const name = make(HIGH_ELF[gender]);
      return chance(0.5) ? `${name} ${make(HIGH_ELF.family)}` : name;
    }
    case 5: {
      // Wood Elves: short names, some with a family name of the forest.
      const name = make(WOOD_ELF[gender]);
      return chance(0.5) ? `${name} ${make(WOOD_ELF.family)}` : name;
    }
    case 6: {
      // Khajiit: a name, often with a prefix of rank before it, sometimes an ending after.
      let name = make(KHAJIIT[gender]);
      if (gender === 'male' && chance(0.2)) name += pick(KHAJIIT.suffixes);
      return chance(0.6) ? pick(KHAJIIT.prefixes) + name : capital(name);
    }
    case 7: {
      // Argonians: a name in Jel, or one taken among the other races.
      if (chance(0.5)) return `${pick(ARGONIAN.does)}-${pick(ARGONIAN.how)}-${pick(ARGONIAN.what)}`;
      const name = make(ARGONIAN.jel);
      return chance(0.5) ? `${name}-${capital(pick(ARGONIAN.jel.ends))}` : name;
    }
    default:
      return make(BRETON[gender]);
  }
}

/**
 * A random name for the race and gender: half the time Arena's own, from
 * the game's name pieces, and otherwise by the race's customs; by the
 * customs alone without the pieces.
 */
export function randomName(race: number, gender: Gender, random: Random, names?: string[][]): string {
  const arena = names && random() < 0.5 ? arenaName(race, gender, random, names) : undefined;
  return arena ?? loreName(race, gender, random);
}

function picker(random: Random): (list: string[]) => string {
  return (list) => list[Math.floor(random() * list.length)] ?? '';
}
