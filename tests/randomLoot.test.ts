import {describe,it,expect} from 'vitest';
import {AFFIXES,eligibleAffix,rollAffixes,itemStats,QUALITY_COLOURS,type LootStats} from '../src/game/affixes';
import {rollEquipment,rollQuality,setBonuses,treasure,EQUIPMENT_SETS,RELICS} from '../src/game/lootRoll';
import {Inventory,makeWeapon,makeArmour,FALLBACK_ARMOUR,makeSteelArrows,itemKey,weaponOf,type NewItem} from '../src/game/items';
import {Dungeon,IDLE_INPUT,type DungeonInput} from '../src/game/dungeon';
import {DEFAULT_HERO} from '../src/game/combat';
import {parseSpells} from '../src/formats/spells';
import {always,fakeCreature,textLevel} from './helpers/level';
import {file,record} from './helpers/spells';
import type {LootRules} from '../src/game/loot';

function rng(seed=37){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
const weapons=Array.from({length:18},(_,type)=>({name:type===1?'Dagger':`Weapon ${type}`,damage:[4,4] as [number,number],twoHanded:false}));
const blade=makeWeapon(weapons,1,1);
const rules={weapons,armour:FALLBACK_ARMOUR,tables:{weaponLevels:new Array(18).fill(1),armourLevels:new Array(3).fill(new Array(11).fill(1)),trinkets:[{name:'Amulet',price:100}],potions:[{name:'Potion of Healing',spell:0,price:20}],weaponEnchantments:[],armourEnchantments:[]}} as unknown as LootRules;
function room(gear?:LootStats){
 const level=textLevel(['#######','#@....#','#######'],{creatures:[{type:0,x:2.1,y:1.5}]});
 const d=new Dungeon(level,{creatures:[fakeCreature({health:[100,100],damage:[10,10]})],weapons},always(.1),{...DEFAULT_HERO,magicka:100});
 d.creatures[0].paralysed=100;
 if(gear){const i=d.inventory.add({...blade,modifiers:gear});d.use(itemKey(i));}
 return d;
}
const click:DungeonInput={...IDLE_INPUT,attack:{pressed:true,released:true,held:false}};
function strike(d:Dungeon){d.update(.01,click);for(let i=0;i<40;i++)d.update(.02,IDLE_INPUT);}

describe('levelled random equipment',()=>{
 it('has the full general-gear catalogue with independent names, weights and useful properties',()=>{
  expect(AFFIXES.filter(a=>a.side==='prefix')).toHaveLength(211);expect(AFFIXES.filter(a=>a.side==='suffix')).toHaveLength(145);
  expect(new Set(AFFIXES.map(a=>a.id)).size).toBe(356);expect(new Set(AFFIXES.map(a=>a.name)).size).toBe(356);
  for(const a of AFFIXES){expect(a.weight).toBeGreaterThan(0);expect(a.range[1]).toBeGreaterThanOrEqual(a.range[0]);expect(a.kinds.length).toBeGreaterThan(0);}
  expect(Object.keys(QUALITY_COLOURS)).toHaveLength(7);
 });
 it('gates tiers by item level, reserves high magic-only tiers and restricts boots and melee speed',()=>{
  const boot=AFFIXES.find(a=>a.stat==='moveSpeed')!,speed=AFFIXES.find(a=>a.stat==='attackSpeed')!,top=AFFIXES.find(a=>a.stat==='damagePct'&&!a.rare)!;
  expect(eligibleAffix(boot,{kind:'armour',type:6},1,false)).toBe(true);expect(eligibleAffix(boot,{kind:'armour',type:0},1,false)).toBe(false);
  expect(eligibleAffix(speed,{kind:'weapon',type:16},30,false)).toBe(false);
  expect(eligibleAffix(top,blade,30,true)).toBe(false);expect(eligibleAffix(top,blade,1,false)).toBe(false);expect(eligibleAffix(top,blade,30,false)).toBe(true);
 });
 it('uses the 25/25/50 magic combinations and 2–6 rare limits without repeated groups',()=>{
  const random=rng(),counts={both:0,prefix:0,suffix:0};
  for(let i=0;i<20000;i++){
   const magic=rollAffixes(blade,30,false,random);expect(magic.length).toBeGreaterThan(0);expect(magic.length).toBeLessThanOrEqual(2);
   const key=magic.length===2?'both':magic[0].side;counts[key]++;
   const rare=rollAffixes(blade,30,true,random);expect(rare.length).toBeGreaterThanOrEqual(2);expect(rare.length).toBeLessThanOrEqual(6);
   for(const side of ['prefix','suffix'])expect(rare.filter(a=>a.side===side).length).toBeLessThanOrEqual(3);
   expect(new Set(rare.map(a=>a.group)).size).toBe(rare.length);
  }
  expect(counts.both/20000).toBeCloseTo(.25,1);expect(counts.prefix/20000).toBeCloseTo(.25,1);expect(counts.suffix/20000).toBeCloseTo(.5,1);
 });
 it('rolls quality independently of material, improves premium drops with find and boss bonuses',()=>{
  for(const quality of ['low','normal','superior','magic','rare','unique'] as const){const item=rollEquipment(blade,{level:30},rng(),quality);expect(item.material).toBe(1);expect(item.quality).toBe(quality);}
  const count=(magicFind:number,boss=false)=>{const random=rng(),counts={magic:0,premium:0};for(let i=0;i<20000;i++){const q=rollQuality({level:10,magicFind,boss},random);if(q==='magic')counts.magic++;if(['rare','set','unique'].includes(q))counts.premium++;}return counts;};
  expect(count(300).premium).toBeGreaterThan(count(0).premium);expect(count(0,true).premium).toBeGreaterThan(count(0).premium);
 });
 it('uses finite eligible treasure pools, independent rolls and rolled-value ranges',()=>{
  const random=rng();for(let i=0;i<100;i++){const drop=treasure(rules,[100,100,100,100],{level:1},random);expect(drop.items).toHaveLength(3);for(const item of drop.items)for(const a of item.affixes??[]){const def=AFFIXES.find(d=>d.id===a.id)!;expect(def.level).toBeLessThanOrEqual(3);for(const value of Object.values(a.stats)){expect(value).toBeGreaterThanOrEqual(def.range[0]);expect(value).toBeLessThanOrEqual(def.range[1]);}}}
 });
 it('names relics with real fixed effects, prevents repeat relics and falls back when unavailable',()=>{
  const context={level:30,foundUniques:new Set<string>()},one=rollEquipment(blade,context,always(.1),'unique'),two=rollEquipment(blade,context,always(.1),'unique');
  expect(one.uniqueId).toBe(RELICS.find(r=>r.kind==='weapon'&&r.type===1)!.id);expect(itemStats(one).damagePct).toBeGreaterThan(0);expect(two.quality).toBe('rare');
  expect(rollEquipment(blade,{level:1},always(.1),'unique').quality).toBe('rare');
 });
 it('activates collection bonuses from distinct worn pieces, not duplicates in a pack',()=>{
  const set=EQUIPMENT_SETS[0],pieces=set.pieces.map(p=>({setId:set.id,setPiece:`${p.kind}:${p.type}`}));
  expect(setBonuses(pieces.slice(0,1))).toEqual({});expect(setBonuses([pieces[0],pieces[0]])).toEqual({});expect(setBonuses(pieces)).toMatchObject({ward:5,maxHealth:20,resistAll:12,critical:8});
 });
});

describe('equipment properties affect combat',()=>{
 it('changes weapon damage and body-part protection while respecting required levels',()=>{
  expect(weaponOf({...blade,id:1,modifiers:{damageFlat:2,damagePct:50}}).damage).toEqual([9,9]);
  const inv=new Inventory(),armour=inv.add({...makeArmour(0,0),modifiers:{armourPct:50,armourFlat:5}});inv.equip(armour);expect(inv.protection()[0]).toBe(65);expect(inv.protection()[1]).toBe(0);
  const high=inv.add({...blade,requiredLevel:5});expect(inv.equip(high).ok).toBe(false);inv.level=5;expect(inv.equip(high).ok).toBe(true);
 });
 it('adds elemental damage and visible criticals, leeches only actual physical loss and applies poison over time',()=>{
  const d=room({fireDamage:5,poisonDamage:8,critical:100,lifeLeech:10,magickaLeech:10});d.stats.health-=10;d.stats.magicka-=20;strike(d);
  expect(d.events.find(e=>e.type==='hit'&&e.damageKind==='physical')).toMatchObject({damage:8,critical:true});expect(d.events.find(e=>e.type==='hit'&&e.damageKind==='fire')).toMatchObject({damage:5});
  expect(d.stats.health).toBeGreaterThan(d.stats.maxHealth-10);expect(d.stats.magicka).toBeGreaterThan(80);
  for(let i=0;i<60;i++)d.update(.05,IDLE_INPUT);expect(d.events.some(e=>e.type==='hit'&&e.damageKind==='poison'&&e.periodic)).toBe(true);
 });
 it('applies range, wounded and critical bonuses only when their conditions hold',()=>{
  const d=room({closeDamage:50,distantDamage:25,woundedDamage:100,critical:100,criticalDamage:50}),c=d.creatures[0];
  const combat=d as unknown as {blowDamage(w:typeof d.stats.weapon,target:typeof d.creatures[0]):{damage:number;critical:boolean}};
  expect(combat.blowDamage(d.stats.weapon,c)).toEqual({damage:15,critical:true});
  c.x=d.player.x+3;expect(combat.blowDamage(d.stats.weapon,c).damage).toBe(13);
  c.health=34;expect(combat.blowDamage(d.stats.weapon,c).damage).toBe(23);
 });
 it('restores flat Health on a damaging weapon hit and grants kill rewards once',()=>{
  const d=room({healthOnHit:2,healthOnKill:7,magickaOnKill:3,experiencePct:50}),c=d.creatures[0];
  d.stats.health=d.stats.maxHealth-20;d.stats.magicka=50;
  const hit=d as unknown as {weaponEnchantments(target:typeof d.creatures[0],n:number):void};hit.weaponEnchantments(c,4);
  expect(d.stats.health).toBe(d.stats.maxHealth-18);
  const magic=d as unknown as {hurtByMagic(target:typeof d.creatures[0],n:number):void};const xp=c.experienceValue!;
  magic.hurtByMagic(c,1000);expect(d.stats.health).toBe(d.stats.maxHealth-11);expect(d.stats.magicka).toBe(53);expect(d.stats.experience).toBe(Math.round(xp*1.5));
  magic.hurtByMagic(c,1000);expect(d.stats.health).toBe(d.stats.maxHealth-11);expect(d.stats.experience).toBe(Math.round(xp*1.5));
 });
 it('keeps an arrows equipped bonuses and attacker stats from release until impact',()=>{
  const d=room({damageFlat:2,fireDamage:3});d.inventory.add(makeSteelArrows(5));d.stats.weapon={...d.stats.weapon,bow:true,material:1};
  const bow=d as unknown as {looseSteelArrow(n:number):void;arrowStrikes(a:typeof d.arrows[0],c:typeof d.creatures[0]):void};
  bow.looseSteelArrow(1);const arrow=d.arrows[0];expect(arrow).toBeDefined();
  const original=d.hero.damageBonus;d.hero.damageBonus=100;
  const plain=d.inventory.add(blade);d.use(itemKey(plain));d.events.length=0;bow.arrowStrikes(arrow,d.creatures[0]);
  expect(d.events.find(e=>e.type==='hit'&&e.damageKind==='physical')).toMatchObject({damage:6+original});
  expect(d.events.find(e=>e.type==='hit'&&e.damageKind==='fire')).toMatchObject({damage:3});
 });
 it('raises vitals and carrying capacity, accelerates melee, regenerates and reverts bonuses on replacing gear',()=>{
  const normal=room({}),d=room({maxHealth:20,maxMagicka:30,maxStamina:40,carryWeight:50,attackSpeed:20,healthRegen:10,magickaRegen:10,staminaRegen:10});
  expect(d.stats.maxHealth).toBe(normal.stats.maxHealth+20);expect(d.stats.maxMagicka).toBe(130);expect(d.stats.maxStamina).toBe(140);expect(d.hero.carry).toBe(250);
  normal.update(.01,click);d.update(.01,click);expect(d.swing!.duration).toBeLessThan(normal.swing!.duration);
  d.stats.health-=10;d.stats.magicka-=10;d.stats.stamina-=10;d.update(.1,IDLE_INPUT);expect(d.stats.health).toBeGreaterThan(d.stats.maxHealth-10);
  const plain=d.inventory.add(blade);d.use(itemKey(plain));expect(d.stats.maxHealth).toBe(normal.stats.maxHealth);expect(d.stats.maxStamina).toBe(100);expect(d.stats.maxMagicka).toBe(100);
 });
 it('reduces spell costs and makes direct spells more damaging without changing their records',()=>{
  const spells=parseSpells(file(record({name:'Fire',target:2,element:0,params:[[10,10,0,0,0,0]],cost:20}))),d=room({spellCost:25,spellPower:50});
  expect(d.spellCost(spells[0])).toBe(15);const recordBefore=JSON.stringify(spells[0]);
  (d as unknown as {onCreature(s:typeof spells[0],c:typeof d.creatures[0],level:number):void}).onCreature(spells[0],d.creatures[0],1);
  expect(d.events.find(e=>e.type==='hit')).toMatchObject({damage:15});expect(JSON.stringify(spells[0])).toBe(recordBefore);
 });
 it('applies resistance, flat reduction and melee thorns from the worn gear',()=>{
  const d=room({resistFire:50,resistAll:10,magicReduction:1,damageReduction:2,thorns:3});
  const hurt=d as unknown as {hurtPlayer(damage:number,from?:typeof d.creatures[0],element?:number,resistanceChecked?:boolean):boolean};
  const hp=d.stats.health;hurt.hurtPlayer(20,undefined,0,true);expect(d.stats.health).toBe(hp-2);
  const before=d.creatures[0].health;hurt.hurtPlayer(10,d.creatures[0]);expect(d.creatures[0].health).toBe(before-3);
 });
});

describe('rolled loot lifecycle',()=>{
 it('keeps rolled equipment, charges, worn bonuses and IDs through storage and rejects invalid snapshots',()=>{
  const d=room({maxHealth:20,fireDamage:3}),rare=rollEquipment(blade,{level:20},rng(),'rare');rare.requiredLevel=0;
  const item=d.inventory.add({...rare,spell:0,charges:7,castLevel:3});d.identify(itemKey(item));d.inventory.setHotkey(0,itemKey(item));
  const next=new Dungeon(d.level,{creatures:[],weapons},always(.1),{...DEFAULT_HERO,magicka:100});
  const state=JSON.parse(JSON.stringify(d.progress()));expect(next.restoreProgress(state)).toBe(true);
  expect(next.inventory.get(item.id)).toMatchObject({name:item.name,affixes:item.affixes,charges:7,unidentified:false});
  expect(next.stats.weapon.damage).toEqual(d.stats.weapon.damage);expect(next.stats.maxHealth).toBe(d.stats.maxHealth);expect(next.inventory.hotkeys[0]).toBe(itemKey(item));
  expect(next.inventory.add(blade).id).toBeGreaterThan(item.id);
  const original=next.inventory.snapshot();state.inventory.items[0].modifiers={maxHealth:'bad'};
  expect(next.restoreProgress(state)).toBe(false);expect(next.inventory.snapshot()).toEqual(original);
 });
 it('records a corpse drop once, preserves remaining entries after closing and permits selective taking',()=>{
  const d=room();d.enableRandomLoot();
  const carried=d as unknown as {carried:Map<number,{gold:number;items:NewItem[]}>;searchBody(c:typeof d.creatures[0]):void};
  const c=d.creatures[0],item=rollEquipment(blade,{level:1},rng(),'magic');c.health=0;c.state='dead';
  carried.carried.set(c.id,{gold:23,items:[item,{...blade}]});carried.searchBody(c);
  const before=d.lootView!;expect(before.entries[1].colour).toBe(QUALITY_COLOURS.magic);d.closeLoot();carried.searchBody(c);expect(d.lootView).toEqual(before);
  d.takeLoot('item:0');expect(d.inventory.items.some(i=>i.name===item.name)).toBe(true);expect(d.lootView!.entries).toHaveLength(2);d.takeLoot();expect(d.lootView).toBeUndefined();expect(d.lootDrops()).toHaveLength(0);
 });
 it('makes loot from creatures without corpses visible and searchable',()=>{
  const d=room();d.enableRandomLoot();const c=d.creatures[0];c.state='dead';c.health=0;c.info={...c.info,noCorpse:true};
  (d as unknown as {carried:Map<number,{gold:number;items:NewItem[]}>}).carried.set(c.id,{gold:12,items:[]});
  expect(d.lootDrops()).toMatchObject([{id:c.id,colour:QUALITY_COLOURS.unique}]);expect(d.target()).toMatchObject({kind:'body',id:c.id});
 });
 it('consumes charges using the normal item-casting path and fires a triggered echo from a hit',()=>{
  const spells=parseSpells(file(record({name:'Spark',target:2,element:3,params:[[2,2,0,0,0,0]],cost:3})));
  const d=new Dungeon(textLevel(['#######','#@....#','#######'],{creatures:[{type:0,x:2.1,y:1.5}]}),{creatures:[fakeCreature({health:[100,100]})],weapons},always(.1),{...DEFAULT_HERO,magicka:100},spells);
  d.creatures[0].paralysed=100;
  const charged=d.inventory.add({...blade,spell:0,castLevel:1,charges:3});expect(d.castWith(itemKey(charged))).toContain('cast');expect(charged.charges).toBe(2);
  const echo=d.inventory.add({...blade,affixes:[{id:'echo',name:'of Spark Echoes',side:'suffix',group:'echo',stats:{},level:1,spell:0,proc:{chance:100,level:1,trigger:'hit'}}]});d.use(itemKey(echo));d.events.length=0;
  strike(d);expect(d.events.some(e=>e.type==='hit'&&e.damageKind==='shock')).toBe(true);
 });
});
