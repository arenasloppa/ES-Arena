import type {Random} from './combat';
import type {Loot,LootRules} from './loot';
import type {LootChances} from '../formats/loot';
import {makeWeapon,makeArmour,makeShield,PLATE,type Item,type NewItem} from './items';
import {addStats,rollAffixes,weighted,describeStats,type AffixDefinition,type ItemQuality,type LootStats} from './affixes';
import {DAMAGE,CONTINUOUS_DAMAGE,CAUSE,CURE,DRAIN,ELEMENTAL_RESISTANCE,FORTIFY,HEAL,TRANSFER,INVISIBILITY,LIGHT,REGENERATE,SILENCE,SPELL_ABSORPTION,SPELL_REFLECTION,SPELL_RESISTANCE} from './magic';

export interface LootContext {level:number;magicFind?:number;goldFind?:number;boss?:boolean;foundUniques?:Set<string>;}
interface Relic {id:string;name:string;level:number;kind:Item['kind'];type:number;stats:LootStats;weight:number;}
const RELIC_WEAPONS=['Pilgrim\'s Last Word','The Quiet Promise','Watchman\'s Answer','Oath of the Ruby Throne','Dustwalker\'s Mercy','Winter\'s Measure','The Long Vigil','Needle of the Dawn','Whisper of the Wind','Evening Oath','The Unbroken Line','Stoneheart\'s Voice','The Last Petition','The Gatekeeper','Vanguard\'s Reach','Voice of the Mountain','The Far Promise','Swift Horizon'];
export const RELICS:readonly Relic[]=[
 ...RELIC_WEAPONS.map((name,type)=>({id:`relic-weapon-${type}`,name,level:6+Math.floor(type/3)*2,kind:'weapon' as const,type,stats:{damagePct:40+type*2,critical:5,...(type%3===0?{magicDamage:5}:type%3===1?{lifeLeech:5}:{undeadDamage:40})},weight:1})),
 ...['Doorward','Watchtower Oath','The Ruby Bastion','Citadel of the Faithful'].map((name,type)=>({id:`relic-shield-${type}`,name,level:6+type*2,kind:'shield' as const,type,stats:{armourPct:40,blockReduction:12,resistAll:8},weight:1})),
 ...['Vanguard\'s Heart','Grasp of the Smith','Roadwarden\'s Stride','The Faithful Shoulder','The Steadfast Shoulder','Crown of the Watch','Steps of the Wanderer'].map((name,type)=>({id:`relic-armour-${type}`,name,level:8+type,kind:'armour' as const,type,stats:{armourPct:35,maxHealth:20,resistAll:8,...(type===6?{moveSpeed:12}:{thorns:4})},weight:1})),
 ...['Bracelet of the Dawn Road','Belt of the Long March','Torc of Quiet Stars','Amulet of the Hidden Spring'].map((name,type)=>({id:`relic-trinket-${type}`,name,level:10+type*2,kind:'trinket' as const,type,stats:{maxHealth:15,maxMagicka:20,magicFind:15,...(type%2?{magickaRegen:8}:{healthRegen:8})},weight:1})),
];
export interface EquipmentSet {id:string;name:string;level:number;pieces:Array<{kind:Item['kind'];type:number;name:string;stats:LootStats}>;bonuses:Array<{count:number;stats:LootStats}>;}
export const EQUIPMENT_SETS:readonly EquipmentSet[]=[
 {id:'ruby-watch',name:'The Ruby Watch',level:5,pieces:[{kind:'armour',type:0,name:'Watch Cuirass',stats:{armourPct:20}},{kind:'armour',type:5,name:'Watch Helm',stats:{maxHealth:12}},{kind:'shield',type:1,name:'Watch Shield',stats:{blockReduction:6}},{kind:'weapon',type:3,name:'Watch Broadsword',stats:{damagePct:20}}],bonuses:[{count:2,stats:{ward:5}},{count:3,stats:{maxHealth:20}},{count:4,stats:{resistAll:12,critical:8}}]},
 {id:'star-seekers',name:'The Star Seekers',level:8,pieces:[{kind:'trinket',type:3,name:'Star Amulet',stats:{maxMagicka:20}},{kind:'armour',type:1,name:'Star Gauntlets',stats:{spellCost:8}},{kind:'armour',type:5,name:'Star Helm',stats:{spellPower:15}},{kind:'weapon',type:0,name:'Star Staff',stats:{magicDamage:5}}],bonuses:[{count:2,stats:{magickaRegen:6}},{count:3,stats:{maxMagicka:30}},{count:4,stats:{spellPower:20,resistMagic:20}}]},
 {id:'silent-path',name:'The Silent Path',level:6,pieces:[{kind:'weapon',type:1,name:'Path Dagger',stats:{critical:8}},{kind:'armour',type:6,name:'Path Boots',stats:{moveSpeed:8}},{kind:'armour',type:1,name:'Path Gauntlets',stats:{agility:5}},{kind:'trinket',type:1,name:'Path Belt',stats:{carryWeight:20}}],bonuses:[{count:2,stats:{maxStamina:20}},{count:3,stats:{magicFind:15}},{count:4,stats:{critical:12,staminaRegen:10}}]},
 {id:'dawn-pilgrim',name:'The Dawn Pilgrim',level:10,pieces:[{kind:'weapon',type:11,name:'Pilgrim Mace',stats:{undeadDamage:30}},{kind:'armour',type:0,name:'Pilgrim Cuirass',stats:{maxHealth:20}},{kind:'trinket',type:2,name:'Pilgrim Torc',stats:{healthRegen:5}},{kind:'shield',type:2,name:'Pilgrim Shield',stats:{resistAll:8}}],bonuses:[{count:2,stats:{resistPoison:15}},{count:3,stats:{healthRegen:10}},{count:4,stats:{undeadDamage:40,resistAll:12}}]},
];
export function setBonuses(worn:readonly Pick<Item,'setId'|'setPiece'>[]):LootStats {
 const result:LootStats={};
 for(const set of EQUIPMENT_SETS){const count=new Set(worn.filter(i=>i.setId===set.id&&i.setPiece).map(i=>i.setPiece)).size;for(const bonus of set.bonuses)if(count>=bonus.count)addStats(result,bonus.stats);}
 return result;
}
const RARE_FIRST=['Dawn','Dusk','Ash','Rune','Star','Storm','Oath','Grave','Moon','Iron','Ruby','Frost','Ember','Stone','Thorn','Mist'];
const RARE_LAST=['Promise','Vigil','Whisper','Answer','Oath','Mercy','Ward','Song','Resolve','Heart','Warden','Witness','Echo','Crown','Voice','Fate'];
const index=(random:Random,length:number)=>Math.floor(Math.max(0,Math.min(.999999999,random()))*length);
/** Independent quality checks apply find bonuses after the base item has been chosen. */
export function rollQuality(context:LootContext,random:Random):ItemQuality {
 const find=Math.max(0,context.magicFind??0),bonus=context.boss?4:1,level=Math.max(1,context.level);
 const findFactor=(cap:number)=>1+(cap*find/(cap+find||1))/100;
 if(random()<Math.min(.3,(1/320+level/16000)*bonus*findFactor(250)))return 'unique';
 if(random()<Math.min(.4,(1/180+level/12000)*bonus*findFactor(500)))return 'set';
 if(random()<Math.min(.6,(1/28+level/1800)*bonus*findFactor(600)))return 'rare';
 if(random()<Math.min(.9,(.18+level/500)*(context.boss?2:1)*(1+find/100)))return 'magic';
 if(random()<.15+Math.min(.2,level/100))return 'superior';
 return random()<Math.max(.03,.15-level/300)?'low':'normal';
}
export function nativeAffixes(kind:Item['kind'],level:number,rules?:Pick<LootRules,'tables'|'spells'>):AffixDefinition[]{
 const extra:AffixDefinition[]=[],table=rules?(kind==='weapon'?rules.tables.weaponEnchantments:rules.tables.armourEnchantments):[];
  for(const e of table)if(e.spell>=0&&e.spell<193)for(const proc of [false,true]){
    const record=rules?.spells?.find(spell=>spell.index===e.spell);
    if(rules?.spells&&!record)continue;
    if(proc&&(!record||!record.effects.some(effect=>[DAMAGE,CONTINUOUS_DAMAGE,CAUSE,CURE,DRAIN,ELEMENTAL_RESISTANCE,FORTIFY,HEAL,TRANSFER,INVISIBILITY,LIGHT,REGENERATE,SILENCE,SPELL_ABSORPTION,SPELL_REFLECTION,SPELL_RESISTANCE].includes(effect.effect))))continue;
    extra.push({id:`suffix-${proc?'echo':'charge'}-${e.spell}`,name:proc?`${e.name} Echoes`:e.name,side:'suffix',group:proc?'suffix-echo':'suffix-charge',stat:'spellPower',level:e.level,weight:2,range:[0,0],rare:true,kinds:[kind],spell:e.spell,castLevel:Math.max(1,Math.min(14,Math.floor(level/2))),...(proc?{procChance:10,procTrigger:kind==='weapon'?'hit' as const:'struck' as const}:{})});
  }
 return extra;
}
export function rollEquipment(base:NewItem,context:LootContext,random:Random,forced?:ItemQuality,rules?:LootRules):NewItem {
 const item:NewItem={...base,itemLevel:Math.max(1,Math.floor(context.level)),quality:forced??rollQuality(context,random)};
 if(item.kind==='trinket'&&['low','normal','superior'].includes(item.quality!))item.quality='magic';
 if(item.quality==='unique'){
  const relic=weighted(RELICS.filter(r=>r.kind===item.kind&&r.type===item.type&&r.level<=context.level&&!context.foundUniques?.has(r.id)),random);
  if(relic){context.foundUniques?.add(relic.id);return {...item,name:relic.name,plainName:base.name,unidentified:true,uniqueId:relic.id,modifiers:{...relic.stats},requiredLevel:Math.floor(relic.level*.75),value:base.value*12+relic.level*50};}
  item.quality='rare';
 }
 if(item.quality==='set'){
  const pieces=EQUIPMENT_SETS.flatMap(set=>set.level<=context.level?set.pieces.filter(p=>p.kind===item.kind&&p.type===item.type).map(p=>({set,p,weight:1})):[]);
  const selected=weighted(pieces,random);
  if(selected)return {...item,name:selected.p.name,plainName:base.name,unidentified:true,setId:selected.set.id,setPiece:`${selected.p.kind}:${selected.p.type}`,modifiers:{...selected.p.stats},requiredLevel:Math.floor(selected.set.level*.75),value:base.value*8+selected.set.level*30};
  item.quality='magic';
 }
 if(item.quality==='magic'||item.quality==='rare'){
  const extra=nativeAffixes(item.kind,context.level,rules);
  item.affixes=rollAffixes(item,context.level,item.quality==='rare',random,extra);
  const charged=item.affixes.find(a=>a.charges!==undefined);
  if(charged){item.spell=charged.spell;item.castLevel=Math.max(1,Math.min(14,Math.floor(context.level/2)));item.charges=charged.charges;}
  if(item.quality==='rare')item.name=`${RARE_FIRST[index(random,RARE_FIRST.length)]} ${RARE_LAST[index(random,RARE_LAST.length)]}`;
  else item.name=[item.affixes.find(a=>a.side==='prefix')?.name,base.name,item.affixes.find(a=>a.side==='suffix')?.name].filter(Boolean).join(' ');
  item.requiredLevel=Math.floor(Math.max(0,...item.affixes.map(a=>a.level))*.75);item.plainName=base.name;item.unidentified=true;
  item.value=Math.round(base.value*(item.quality==='rare'?4:2)+item.affixes.reduce((sum,a)=>sum+a.level*12,0));
 }else if(item.quality==='low'||item.quality==='superior'){
  const superior=item.quality==='superior',key=item.kind==='weapon'?'damagePct':'armourPct';
  item.modifiers={[key]:superior?5+index(random,11):-25};item.name=`${superior?'Superior':'Worn'} ${base.name}`;item.value=Math.max(1,Math.round(base.value*(superior?1.3:.6)));
 }
 return item;
}
export function treasure(rules:LootRules,chances:LootChances,context:LootContext,random:Random):Loot {
 const level=Math.max(1,Math.floor(context.level)),pool:Array<{item:NewItem;weight:number}>=[];
 const metals=rules.armour.materialChances.map((chance,i)=>({metal:i,weight:Math.max(0,chance-(rules.armour.materialChances[i-1]??0))})).filter(m=>m.metal<=Math.min(7,Math.floor((level+3)/3)));
 const material=()=>weighted(metals,random)?.metal??1;
 rules.weapons.forEach((_,type)=>{if((rules.tables.weaponLevels[type]??Infinity)<=level)pool.push({item:makeWeapon(rules.weapons,type,material(),rules.armour),weight:8});});
 rules.tables.armourLevels.forEach((levels,armour)=>levels.forEach((minimum,type)=>{
  if(minimum>level)return;
  if(type<7)pool.push({item:makeArmour(armour,type,armour===PLATE?material():undefined,rules.armour),weight:type===0?6:4});
  else if(armour===PLATE)pool.push({item:makeShield(type-7,material(),rules.armour),weight:5});
 }));
 rules.tables.trinkets.forEach((info,type)=>pool.push({item:{kind:'trinket',trinket:'attribute',name:info.name,type,weight:0,value:Math.max(10,Math.floor(info.price/10))},weight:3}));
 const loot:Loot={gold:0,items:[]};
 const drops=chances.map(chance=>random()*100<chance);
 if(drops[0])loot.gold=Math.max(1,Math.round((1+index(random,10))*level*(1+Math.max(0,context.goldFind??0)/100)));
 if(drops[1]&&rules.tables.potions.length){const type=index(random,rules.tables.potions.length),p=rules.tables.potions[type];loot.items.push({kind:'potion',name:p.name,type,spell:p.spell,castLevel:15,weight:.5,value:p.price,plainName:p.name.split(' of ')[0],unidentified:true});}
 for(const dropsGear of drops.slice(2))if(dropsGear){const base=weighted(pool,random)?.item;if(base)loot.items.push(rollEquipment(base,context,random,undefined,rules));}
 return loot;
}
export function itemProperties(item:Item,worn:readonly Item[]=[]):string[]{
 const lines:string[]=[];
 for(const a of item.affixes??[])if(a.proc)lines.push(`${a.proc.chance}% chance to cast ${a.name.replace(/^of /,'').replace(/ Echoes$/,'')} ${a.proc.trigger==='struck'?'when struck':'on striking'} at level ${a.proc.level}`);
 const set=EQUIPMENT_SETS.find(set=>set.id===item.setId);
 if(set){const count=new Set(worn.filter(i=>i.setId===set.id).map(i=>i.setPiece)).size;lines.push(`${set.name} (${count}/${set.pieces.length})`,...set.pieces.map(p=>`${worn.some(i=>i.setId===set.id&&i.setPiece===`${p.kind}:${p.type}`)?'✓':'□'} ${p.name}`),...set.bonuses.map(b=>`${count>=b.count?'Active':'Requires'} ${b.count} pieces: ${describeStats(b.stats).join(', ')}`));}
 return lines;
}
