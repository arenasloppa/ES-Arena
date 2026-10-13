import type {Item,ItemKind} from './items';
import type {Random} from './combat';

export type ItemQuality = 'low'|'normal'|'superior'|'magic'|'rare'|'set'|'unique';
export const QUALITY_COLOURS:Record<ItemQuality,string>={low:'#aaa59c',normal:'#eee9dd',superior:'#eee9dd',magic:'#8faeff',rare:'#ffe16a',set:'#83dc8a',unique:'#d7b375'};
export const QUALITY_NAMES:Record<ItemQuality,string>={low:'Worn',normal:'Common',superior:'Superior',magic:'Enchanted',rare:'Rare',set:'Set',unique:'Relic'};
export type LootStat = 'damagePct'|'damageFlat'|'maxHealth'|'maxMagicka'|'maxStamina'|'fireDamage'|'frostDamage'|'shockDamage'|'poisonDamage'|'magicDamage'|'resistFire'|'resistFrost'|'resistShock'|'resistPoison'|'resistMagic'|'resistAll'|'armourPct'|'armourFlat'|'strength'|'intelligence'|'willpower'|'agility'|'speed'|'endurance'|'personality'|'luck'|'spellPower'|'magicFind'|'goldFind'|'undeadDamage'|'daedraDamage'|'lightRadius'|'healthRegen'|'magickaRegen'|'staminaRegen'|'lifeLeech'|'magickaLeech'|'critical'|'attackSpeed'|'moveSpeed'|'carryWeight'|'blockReduction'|'damageReduction'|'magicReduction'|'thorns'|'spellCost'|'ward'|'closeDamage'|'distantDamage'|'woundedDamage'|'healthOnHit'|'healthOnKill'|'magickaOnKill'|'experiencePct'|'criticalDamage';
export type LootStats=Partial<Record<LootStat,number>>;
export interface RolledAffix {id:string;name:string;side:'prefix'|'suffix';group:string;stats:LootStats;level:number;spell?:number;charges?:number;proc?:{chance:number;level:number;trigger?:'hit'|'struck'};}
export interface AffixDefinition {id:string;name:string;side:'prefix'|'suffix';group:string;stat:LootStat;level:number;weight:number;range:[number,number];rare:boolean;kinds:readonly ItemKind[];piece?:number;melee?:boolean;spell?:number;procChance?:number;castLevel?:number;procTrigger?:'hit'|'struck';}
const ALL:ItemKind[]=['weapon','armour','shield','trinket'];
const DEFENCE:ItemKind[]=['armour','shield','trinket'];
const WEAPON:ItemKind[]=['weapon'];
interface Family {stat:LootStat;names:string;range:[number,number];kinds?:ItemKind[];piece?:number;melee?:boolean;magicTop?:boolean;}
const prefixes:Family[]=[
 {stat:'closeDamage',names:'Closefighting|Pressing|Vanguard|Frontline|Ironfront|Siegebreaking',range:[3,6],kinds:WEAPON},
 {stat:'distantDamage',names:'Farseeing|Farstriking|Longsighted|Eagleeyed|Horizonstriking|Horizonpiercing',range:[3,6],kinds:WEAPON},
 {stat:'woundedDamage',names:'Opportunist|Merciless|Pitiless|Finishing|Deathmarking|Finaljudgment',range:[3,6],kinds:WEAPON},
 {stat:'damagePct',names:'Honed|Tempered|Keenforged|Battleforged|Warforged|Masterforged',range:[5,12],kinds:WEAPON,magicTop:true},
 {stat:'damageFlat',names:'Serrated|Sharp|Piercing|Rending|Ravaging|Sundering',range:[1,2],kinds:WEAPON},
 {stat:'maxHealth',names:'Hardy|Vital|Lifebound|Heartbound|Bloodbound|Lifeweaver',range:[4,8],kinds:DEFENCE},
 {stat:'maxMagicka',names:'Arcane|Attuned|Spellbound|Runebound|Magebound|Aetherbound',range:[5,10],magicTop:true},
 {stat:'maxStamina',names:'Tireless|Stalwart|Resolute|Unflagging|Unyielding|Indefatigable',range:[4,8]},
 {stat:'fireDamage',names:'Emberkissed|Cinderforged|Flamewrought|Blazebound|Infernal|Sunforged',range:[1,3],kinds:WEAPON,magicTop:true},
 {stat:'frostDamage',names:'Rimekissed|Iceforged|Frostwrought|Winterbound|Glacial|Winterheart',range:[1,3],kinds:WEAPON,magicTop:true},
 {stat:'shockDamage',names:'Sparkkissed|Staticforged|Stormwrought|Thunderbound|Tempestforged|Stormheart',range:[1,3],kinds:WEAPON,magicTop:true},
 {stat:'poisonDamage',names:'Bitter|Venomkissed|Venomwrought|Blightbound|Toxic|Deathblossom',range:[2,4],kinds:WEAPON},
 {stat:'magicDamage',names:'Glimmering|Spellforged|Runewrought|Mystic|Voidbound|Aetherwrought',range:[1,3],kinds:WEAPON},
 {stat:'resistFire',names:'Ashwarded|Cinderwarded|Flamewarded|Blazewarded|Firesealed|Sunwarded',range:[2,4],kinds:DEFENCE},
 {stat:'resistFrost',names:'Rimewarded|Icewarded|Frostwarded|Winterwarded|Coldsealed|Glacierwarded',range:[2,4],kinds:DEFENCE},
 {stat:'resistShock',names:'Sparkwarded|Staticwarded|Stormwarded|Thunderwarded|Stormsealed|Tempestwarded',range:[2,4],kinds:DEFENCE},
 {stat:'resistPoison',names:'Bitterwarded|Venomwarded|Blightwarded|Toxinwarded|Venomsealed|Purified',range:[2,4],kinds:DEFENCE},
 {stat:'resistMagic',names:'Spellwarded|Runewarded|Mysticwarded|Voidwarded|Spellsealed|Aetherwarded',range:[2,4],kinds:DEFENCE},
 {stat:'resistAll',names:'Sheltering|Guarded|Warded|Spellguarded|Aegisbound|Aegisforged',range:[1,3],kinds:DEFENCE,magicTop:true},
 {stat:'armourPct',names:'Reinforced|Hardened|Ironclad|Bulwarked|Fortressforged|Citadelforged',range:[4,9],kinds:['armour','shield']},
 {stat:'armourFlat',names:'Padded|Braced|Guardforged|Shieldwrought|Rampartforged|Bastionforged',range:[1,2],kinds:DEFENCE},
 {stat:'strength',names:'Brawny|Forceful|Mighty|Ogrebound|Giantbound|Strengthwoven',range:[1,2]},
 {stat:'intelligence',names:'Learned|Astute|Insightful|Sagebound|Scholarbound|Wisdomwoven',range:[1,2]},
 {stat:'willpower',names:'Steadfast|Determined|Ironwilled|Ascetic|Indomitable|Willwoven',range:[1,2]},
 {stat:'agility',names:'Nimble|Deft|Graceful|Surefooted|Catbound|Gracewoven',range:[1,2]},
 {stat:'speed',names:'Brisk|Fleet|Swift|Windbound|Galeswift|Windwoven',range:[1,2]},
 {stat:'endurance',names:'Robust|Stout|Tenacious|Bearbound|Stoneheart|Endurancewoven',range:[1,2]},
 {stat:'personality',names:'Charming|Persuasive|Compelling|Regal|Majestic|Presencewoven',range:[1,2],kinds:DEFENCE},
 {stat:'luck',names:'Fortunate|Favoured|Auspicious|Fatebound|Starfavoured|Fatewoven',range:[1,2]},
 {stat:'spellPower',names:'Spellwise|Spellshaped|Spellwrought|Magewrought|Magnusbound|Aetherchannelled',range:[3,6]},
 {stat:'magicFind',names:'Seeking|Divining|Relicseeking|Relicsighted|Treasurewise|Fatesighted',range:[2,4],kinds:DEFENCE},
 {stat:'goldFind',names:'Prosperous|Gilded|Coinblessed|Prosperitybound|Tributebound|Royalminted',range:[4,8],kinds:DEFENCE},
 {stat:'undeadDamage',names:'Consecrated|Hallowed|Gravewarded|Dawnblessed|Dawnbound|Dawncleansed',range:[6,12],kinds:WEAPON},
 {stat:'daedraDamage',names:'Oathbound|Banishing|Oblivionwarded|Sigilbreaking|Voidbreaking|Oathforged',range:[6,12],kinds:WEAPON},
 {stat:'lightRadius',names:'Candlelit|Lamplit|Torchlit|Lanternbound|Dawnlit|Beaconbound',range:[1,1],kinds:DEFENCE},
];
const suffixes:Family[]=[
 {stat:'healthOnHit',names:'Life Drawing|Blood Renewal|Living Strikes|Blood Mending|Vital Strikes',range:[1,2],kinds:WEAPON},
 {stat:'healthOnKill',names:'Last Breath|Life Reaping|Vital Spoils|Blood Harvest|Life Harvest',range:[2,4]},
 {stat:'magickaOnKill',names:'Spell Gathering|Magicka Gathering|Arcane Spoils|Soul Gathering|Aether Harvest',range:[1,3]},
 {stat:'experiencePct',names:'Learning|Battle Lessons|Seasoned Practice|Hardwon Wisdom|Mastery',range:[2,4],kinds:DEFENCE},
 {stat:'criticalDamage',names:'Deep Cuts|Severe Strikes|Crushing Strikes|Ruinous Strikes|Mortal Strikes',range:[3,6],kinds:WEAPON},
 {stat:'strength',names:'the Brawler|the Ogre|the Giant|the Mountain|Unbroken Might',range:[1,2]},
 {stat:'intelligence',names:'the Student|the Scholar|the Sage|the Seer|Clear Insight',range:[1,2]},
 {stat:'willpower',names:'Resolve|the Pilgrim|the Ascetic|the Unbowed|Iron Resolve',range:[1,2]},
 {stat:'agility',names:'Balance|the Acrobat|the Cat|the Dancer|Perfect Grace',range:[1,2]},
 {stat:'speed',names:'the Breeze|the Runner|the Wind|the Gale|Swift Passage',range:[1,2]},
 {stat:'endurance',names:'Vigour|the Oxheart|the Bear|the Sentinel|Enduring Stone',range:[1,2]},
 {stat:'personality',names:'Charm|the Envoy|the Diplomat|the Crown|Royal Presence',range:[1,2],kinds:DEFENCE},
 {stat:'luck',names:'Good Fortune|the Lucky Star|the Guiding Star|Favourable Fate|Blessed Fortune',range:[1,2]},
 {stat:'healthRegen',names:'Mending|Renewal|Restoration|Living Blood|Unfading Life',range:[1,3],kinds:DEFENCE},
 {stat:'magickaRegen',names:'Meditation|Attunement|Flowing Magicka|the Wellspring|Aetheric Renewal',range:[1,3]},
 {stat:'staminaRegen',names:'Recovery|Restful Breath|Second Wind|Endless Breath|Unending Vigour',range:[2,4]},
 {stat:'lifeLeech',names:'Thirst|Bloodletting|the Leech|Blood Drinking|Hungry Night',range:[1,2],kinds:WEAPON},
 {stat:'magickaLeech',names:'Spell Thirst|Magicka Siphoning|the Spell Drinker|Aetheric Thirst|Arcane Hunger',range:[1,2],kinds:WEAPON},
 {stat:'critical',names:'Precision|the Hunter|the Duelist|the Executioner|Decisive Strikes',range:[1,3]},
 {stat:'attackSpeed',names:'Quick Strikes|the Skirmisher|the Bladedance|Relentless Strikes|the Whirlwind',range:[2,5],kinds:WEAPON,melee:true},
 {stat:'moveSpeed',names:'Light Steps|Fleet Steps|the Traveller|Windwalking|the Unseen Path',range:[1,3],kinds:['armour'],piece:6},
 {stat:'carryWeight',names:'the Porter|the Hauler|the Caravan|the Packmaster|the Burdenless',range:[3,6],kinds:DEFENCE},
 {stat:'blockReduction',names:'Parrying|the Watch|the Protector|the Warder|the Iron Guard',range:[1,3],kinds:['weapon','shield']},
 {stat:'damageReduction',names:'Padding|Deflection|the Rampart|the Bulwark|the Bastion',range:[1,2],kinds:DEFENCE},
 {stat:'magicReduction',names:'Spell Deflection|the Spell Ward|the Mageguard|the Spellbreaker|the Null Ward',range:[1,2],kinds:DEFENCE},
 {stat:'thorns',names:'Briars|Thorns|the Bramble|the Thornwall|the Briarheart',range:[1,2],kinds:DEFENCE},
 {stat:'spellCost',names:'Concentration|Clarity|Spell Economy|Arcane Control|Perfect Focus',range:[1,3]},
 {stat:'goldFind',names:'Coin Seeking|the Prospector|the Goldseeker|the Merchant Prince|Golden Fortune',range:[4,8],kinds:DEFENCE},
 {stat:'magicFind',names:'Discovery|the Delver|the Relic Hunter|Treasure Seeking|Hidden Wonders',range:[2,4],kinds:DEFENCE},
];
function expand(families:Family[],side:'prefix'|'suffix'):AffixDefinition[]{
 return families.flatMap(f=>f.names.split('|').map((name,t)=>({id:`${side}-${f.stat}-${t}`,name:side==='suffix'?`of ${name}`:name,side,group:`${side}-${f.stat}`,stat:f.stat,level:[1,3,6,10,15,20][t],weight:[12,10,8,5,3,1][t],range:[t*f.range[1]+f.range[0],(t+1)*f.range[1]] as [number,number],rare:!(f.magicTop&&t===5),kinds:f.kinds??ALL,piece:f.piece,melee:f.melee})));
}
export const AFFIXES:readonly AffixDefinition[]=[...expand(prefixes,'prefix'),{id:'prefix-aetherial',name:'Aetherial',side:'prefix',group:'prefix-all-attributes',stat:'luck',level:20,weight:1,range:[1,3],rare:false,kinds:ALL},...expand(suffixes,'suffix')];
export const ATTRIBUTE_STATS:LootStat[]=['strength','intelligence','willpower','agility','speed','endurance','personality','luck'];
export function eligibleAffix(a:AffixDefinition,item:Pick<Item,'kind'|'type'>,level:number,rare:boolean):boolean{return a.level<=level+2&&(!rare||a.rare)&&a.kinds.includes(item.kind)&&(a.piece===undefined||item.type===a.piece)&&(!a.melee||!([16,17].includes(item.type)));}
export function weighted<T extends {weight:number}>(pool:readonly T[],random:Random):T|undefined{
 const total=pool.reduce((sum,a)=>sum+Math.max(0,a.weight),0);if(total<=0)return undefined;
 let cursor=Math.min(.999999999,Math.max(0,random()))*total;
 for(const a of pool){cursor-=Math.max(0,a.weight);if(cursor<0)return a;}return pool.at(-1);
}
export function rollAffixes(item:Pick<Item,'kind'|'type'>,level:number,rare:boolean,random:Random,extra:readonly AffixDefinition[]=[]):RolledAffix[]{
 const eligible=[...AFFIXES,...extra].filter(a=>eligibleAffix(a,item,level,rare));
 const used=new Set<string>(),counts={prefix:0,suffix:0},result:RolledAffix[]=[];
 const pick=(side:'prefix'|'suffix')=>{
  if(rare&&counts[side]>=3)return false;
  const a=weighted(eligible.filter(a=>a.side===side&&!used.has(a.group)),random);if(!a)return false;
  const value=a.range[0]+Math.floor(Math.min(.999999999,Math.max(0,random()))*(a.range[1]-a.range[0]+1));
  const stats:LootStats=a.spell!==undefined?{}:a.id==='prefix-aetherial'?Object.fromEntries(ATTRIBUTE_STATS.map(stat=>[stat,value])):{[a.stat]:value};
  result.push({id:a.id,name:a.name,side:a.side,group:a.group,level:a.level,stats,...(a.spell===undefined?{}:{spell:a.spell,...(a.procChance?{proc:{chance:a.procChance,level:a.castLevel??1,trigger:a.procTrigger??'hit'}}:{charges:12+Math.floor(level/2)})})});used.add(a.group);counts[side]++;return true;
 };
 if(!rare){const choice=random();if(choice<.5)pick('prefix');if(choice<.25||choice>=.5)pick('suffix');}
 else{
  const count=2+Math.floor(Math.min(.999999999,Math.max(0,random()))*5);
  for(let i=0;i<count;i++){let side:'prefix'|'suffix'=random()<.5?'prefix':'suffix';if(counts[side]>=3)side=side==='prefix'?'suffix':'prefix';if(!pick(side)&&!pick(side==='prefix'?'suffix':'prefix'))break;}
 }
 return result;
}
export function addStats(to:LootStats,from:LootStats):LootStats{for(const [stat,n]of Object.entries(from))to[stat as LootStat]=(to[stat as LootStat]??0)+n;return to;}
export function itemStats(item:Pick<Item,'affixes'|'modifiers'>):LootStats{const stats={...item.modifiers};for(const a of item.affixes??[])addStats(stats,a.stats);return stats;}
export function itemColour(item:Pick<Item,'quality'|'spell'|'attribute'|'plainName'|'kind'>):string{return QUALITY_COLOURS[item.quality??(item.kind!=='potion'&&item.kind!=='ammunition'&&item.plainName?'magic':'normal')];}
const STAT_NAMES:Record<LootStat,string>={damagePct:'weapon damage',damageFlat:'physical damage',maxHealth:'maximum Health',maxMagicka:'maximum Magicka',maxStamina:'maximum Stamina',fireDamage:'Fire damage',frostDamage:'Frost damage',shockDamage:'Shock damage',poisonDamage:'Poison damage over 4 seconds',magicDamage:'Magic damage',resistFire:'Fire resistance',resistFrost:'Frost resistance',resistShock:'Shock resistance',resistPoison:'Poison resistance',resistMagic:'Magic resistance',resistAll:'all elemental resistances',armourPct:'armour protection',armourFlat:'armour protection',strength:'Strength',intelligence:'Intelligence',willpower:'Willpower',agility:'Agility',speed:'Speed',endurance:'Endurance',personality:'Personality',luck:'Luck',spellPower:'spell damage',magicFind:'chance to find enchanted items',goldFind:'gold found',undeadDamage:'damage to undead',daedraDamage:'damage to Daedra',lightRadius:'light radius',healthRegen:'Health restored per 10 seconds',magickaRegen:'Magicka restored per 10 seconds',staminaRegen:'Stamina restored per 10 seconds',lifeLeech:'physical damage returned as Health',magickaLeech:'physical damage returned as Magicka',critical:'critical strike chance',attackSpeed:'attack speed',moveSpeed:'movement speed',carryWeight:'carrying capacity',blockReduction:'damage blocked',damageReduction:'physical damage reduced per hit',magicReduction:'spell damage reduced per hit',thorns:'damage reflected to melee attackers',spellCost:'spell cost reduction',ward:'protection for every body part',closeDamage:'damage within 2 metres',distantDamage:'damage beyond 2 metres',woundedDamage:'damage to enemies below 35% Health',healthOnHit:'Health on a damaging weapon hit',healthOnKill:'Health on a kill',magickaOnKill:'Magicka on a kill',experiencePct:'experience gained',criticalDamage:'critical damage'};
const PERCENT=new Set<LootStat>(['closeDamage','distantDamage','woundedDamage','experiencePct','criticalDamage','damagePct','resistFire','resistFrost','resistShock','resistPoison','resistMagic','resistAll','armourPct','spellPower','magicFind','goldFind','undeadDamage','daedraDamage','lifeLeech','magickaLeech','critical','attackSpeed','moveSpeed','blockReduction','spellCost']);
export function describeStats(stats:LootStats):string[]{return Object.entries(stats).filter(([,n])=>n!==0).map(([key,n])=>`${n>=0?'+':''}${n}${PERCENT.has(key as LootStat)?'%':key==='carryWeight'?' kg':''} ${STAT_NAMES[key as LootStat]}`);}
