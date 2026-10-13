import {AFFIXES,describeStats,type AffixDefinition} from './affixes';
import {nativeAffixes} from './lootRoll';
import type {LootRules} from './loot';
import {AFFIX_LABELS,CHAMPION_LABELS,AURA_LABELS,type EliteAffix,type Champion,type EliteAura} from './elites';
import {describe as describeSpell} from './magic';
import {PIECES} from './items';
export type GuideCategory='weapons'|'equipment'|'monsters';
export interface GuideEntry {id:string;name:string;group:string;description:string;notes:string[];}
const monsterEffects:Record<EliteAffix,string>={
 strong:'Deals 135% extra physical damage and gains 90% extra attack accuracy. Retainers inherit 67% extra damage and 45% extra accuracy.',
 swift:'Moves at twice its normal speed. Retainers inherit the speed bonus.',
 flame:'Adds fire damage equal to roughly 83% of physical strike damage and gains 75% fire resistance. On death, explodes within 2.65 metres for 11.25–18.75% of its original Health, split between physical and fire damage.',
 frost:'Adds frost damage equal to roughly 83% of physical strike damage and gains 75% frost resistance. A damaging frost hit slows movement by 35% for 4 seconds plus 0.2 seconds per monster level. On death, releases a frost nova within 2.65 metres.',
 storm:'Adds shock damage equal to roughly 83% of physical strike damage and gains 75% shock resistance. Taking damage releases eight shock bolts, at most once every 0.6 seconds. Bolts collide with creatures and terrain.',
 spellward:'Gains 40% resistance to fire, frost and shock damage.',
 siphon:'Steals Magicka equal to roughly 83% of strike damage on a landed melee hit or damaging missile spell, and gains 20% magic resistance.',
 volley:'Fires three spell missiles instead of one, with the side missiles angled outward. Only monsters that already cast spells can receive this affix.',
 prismatic:'Gains at least 40% resistance to fire, frost and shock. Each landed melee hit adds one randomly chosen magic, fire, shock, frost or poison effect. Poison lasts 4 seconds; damaging frost hits also slow movement.',
 stonehide:'Takes 50% less physical damage. Physical resistance from elite properties is capped at 90%.',
 curse:'Landed melee hits and damaging missile spells have a 75% chance to apply Frailty Hex for 8 seconds. The hex doubles physical damage taken and can be removed by a curse cure.',
 blink:'When below 30% Health, or when a spellcaster has a nearby opponent, teleports to reachable, unoccupied ground at least 2 metres from the player. A wounded teleport restores 25% of the monster’s original Health. Cooldown: 8 seconds.',
 aura:'Projects one of seven auras. Allied bonuses and hostile pulses reach 3 metres and require line of sight. Auras stop when the bearer dies or is paralysed. Elemental pulses and weakening refresh once per second.',
};
const championEffects:Record<Champion,string>={
 champion:'3× normal Health, 90% extra damage, 67% extra accuracy and 20% faster movement. Level +2; experience ×3.',
 berserker:'75% of normal Health, 270% extra damage and 270% extra accuracy. Level +2; experience ×5. Health is rounded to a whole point, with a minimum of 1.',
 fanatic:'3× normal Health, 90% extra damage, 67% extra accuracy and twice the normal movement speed. Takes 30% extra physical damage. Level +2; experience ×3.',
 ghostly:'3× normal Health, 90% extra damage and 67% extra accuracy. Resists 80% of physical damage and 50% of frost damage, and adds frost damage equal to 40% of its physical strike. Level +2; experience ×3.',
 possessed:'6× normal Health, 90% extra damage, 67% extra accuracy and 20% faster movement. Immune to curse effects. Level +2; experience ×3.',
};
const auraEffects:Record<EliteAura,string>={
 might:'Nearby allies deal 30% extra physical damage.',
 flame:'Deals a fire pulse to the player once per second within 3 metres. Damage grows with the bearer’s level and is reduced by the player’s normal saves and resistances.',
 aim:'Nearby allies gain 50% extra attack accuracy.',
 frost:'Deals a frost pulse once per second. A damaging pulse slows movement by 35% for 2 seconds; the slow refreshes while in range.',
 storm:'Deals a shock pulse once per second. Damage grows with the bearer’s level and respects the player’s saves and resistances. Randomly available to monsters of base level 20 or above.',
 weakening:'Applies Frailty Aura within 3 metres, increasing physical damage taken by 30% for 2 seconds. Refreshes while in range. The strongest active vulnerability applies; vulnerabilities do not add together.',
 fury:'Nearby allies deal 20% extra physical damage, move faster and attack more quickly.',
};
function effectRange(a:AffixDefinition):string {
 if(a.id==='prefix-aetherial')return `+${a.range[0]}–${a.range[1]} to all eight attributes.`;
 const text=describeStats({[a.stat]:a.range[1]})[0];
 return text.replace(`+${a.range[1]}`,`+${a.range[0]}–${a.range[1]}`)+'.';
}
function equipmentEntry(a:AffixDefinition,rules?:Pick<LootRules,'tables'|'spells'>):GuideEntry {
 const notes=[a.side==='prefix'?'Prefix':'Suffix'];
 notes.push(`Appears from item level ${Math.max(1,a.level-2)}. This affix contributes an equipment level requirement of ${Math.floor(a.level*.75)}; other affixes may raise it.`);
 notes.push(`Found on ${a.kinds.join(', ')}${a.piece===undefined?'':` (${PIECES[a.piece]??'specific piece'} only)`}${a.melee?' (melee weapons only)':''}.`);
 if(!a.rare)notes.push('Enchanted items only; cannot roll on Rare items.');
 let description=a.spell!==undefined?'':a.stat==='lightRadius'?`Sets minimum light reach to ${100+a.range[0]*10}–${100+a.range[1]*10}% of normal. Combined equipment light reach is capped at 200%; stronger light spells can reach farther.`:effectRange(a);
 if(a.spell!==undefined){
  const spell=rules?.spells?.find(s=>s.index===a.spell);
  description=a.procChance?`${a.procChance}% chance to cast ${spell?.name??a.name} ${a.procTrigger==='struck'?'when struck':'on striking'}.`:`Casts ${spell?.name??a.name} when used, consuming one charge.`;
  notes.push(a.procChance?'Triggered spells have a 0.5-second cooldown. Casting level is half the item level, rounded down, from level 1 to 14.':'Starts with 12 charges plus half the item level, rounded down. Casting level is half the item level, from level 1 to 14.');
  if(spell){const level=a.castLevel??1;notes.push(`Example spell effects at casting level ${level}:`,...describeSpell(spell,level));}
 }
 const caps:Record<string,string>={resistAll:'Combined equipment resistance is capped at 75% per element.',resistFire:'Combined equipment resistance is capped at 75% per element.',resistFrost:'Combined equipment resistance is capped at 75% per element.',resistShock:'Combined equipment resistance is capped at 75% per element.',resistPoison:'Combined equipment resistance is capped at 75% per element.',resistMagic:'Combined equipment resistance is capped at 75% per element.',attackSpeed:'Combined equipment attack speed is capped at 60%.',moveSpeed:'Combined equipment movement speed is capped at 50%.',spellCost:'Combined spell cost reduction is capped at 60%.',lifeLeech:'Returns a percentage of actual physical Health loss, not overkill. Combined leech is capped at 30%.',magickaLeech:'Returns a percentage of actual physical Health loss, not overkill. Combined leech is capped at 30%.',closeDamage:'Applies within 2 metres.',distantDamage:'Applies beyond 2 metres.',woundedDamage:'Applies when the enemy is below 35% Health.',criticalDamage:'Adds to the normal double-damage critical multiplier.',blockReduction:'A successful block still lets through at least 5% damage.',magicFind:'Improves quality chances, with diminishing returns for Rare, Set and Relic items. Does not improve the base material.',healthRegen:'Restores Health over active play; cannot revive a dead character.'};
 if(caps[a.stat]&&a.spell===undefined)notes.push(caps[a.stat]);
 return {id:a.id,name:a.name,group:a.spell!==undefined?'Spell enchantments':a.side==='prefix'?'Prefixes':'Suffixes',description,notes};
}
export function guideEntries(category:GuideCategory,rules?:Pick<LootRules,'tables'|'spells'>):GuideEntry[]{
 if(category==='monsters')return [
  {id:'named-elites',name:'Named elites',group:'Encounter types',description:'4× normal Health, level +3 and experience ×5. Receive 1 affix below base level 10, 2 at level 10–19, and 3 at level 20 or above. Eligible affixes have equal selection chances and cannot repeat.',notes:['Travel with 3–6 retainers where space permits. Elite leaders gain an extra guaranteed equipment and gold roll, with improved quality chances.','Leaders are chilled instead of paralysed. Staggering power strikes have a 10% chance to interrupt them.']},
  {id:'retainers',name:'Retainers',group:'Encounter types',description:'2× normal Health, level +3 and experience ×5. May inherit Giant Strength and Windrunner from their leader.',notes:['Ordinary paralysis still works. Retainers do not receive the leader’s extra guaranteed loot roll.']},
  ...Object.entries(championEffects).map(([id,description])=>({id:`champion-${id}`,name:CHAMPION_LABELS[id as Champion],group:'Champions',description,notes:['Champion groups contain 2–4 monsters where space permits. Champions are chilled instead of paralysed and resist staggering power strikes.']})),
  ...Object.entries(monsterEffects).map(([id,description])=>({id:`monster-${id}`,name:AFFIX_LABELS[id as EliteAffix],group:'Monster affixes',description,notes:['Elite properties combine with the monster’s usual attacks and abilities.']})),
  ...Object.entries(auraEffects).map(([id,description])=>({id:`aura-${id}`,name:`${AURA_LABELS[id as EliteAura]} Aura`,group:'Auras',description,notes:['Requires a living, unparalysed bearer and line of sight. Range: 3 metres.']})),
 ];
 const kinds=category==='weapons'?['weapon']:['armour','shield','trinket'];
 const defs=AFFIXES.filter(a=>a.kinds.some(kind=>kinds.includes(kind)));
 if(rules)for(const kind of kinds)for(const a of nativeAffixes(kind as 'weapon'|'armour'|'shield'|'trinket',24,rules))if(!defs.some(b=>b.id===a.id))defs.push(a);
 return defs.map(a=>equipmentEntry(a,rules)).sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name));
}
export function searchGuide(entries:readonly GuideEntry[],query:string):GuideEntry[]{
 const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return entries.filter(e=>terms.every(term=>[e.name,e.group,e.description,...e.notes].join(' ').toLocaleLowerCase().includes(term)));
}
