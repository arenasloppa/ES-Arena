import type {CreatureInfo,WeaponInfo} from '../formats/exe';
import {isDefeated,type Creature} from './creatures';
import type {Dungeon} from './dungeon';
import {rangeSpawn} from './steelTestRoom';
import {makeWeapon,makeSteelArrows,itemKey,MATERIALS} from './items';
import {TEST_BUFFS,TEST_DEBUFFS,type TestAreaMode} from './testEffects';

/** Inventory and replenishing encounters for the main game's practice room. */
export class TestArea {
 private readonly dead=new Map<Creature,number>();
 private missingSince:number|undefined;
 private nextType=0;
 private readonly enemyTypes:CreatureInfo[];
 private nextId=0;
 private buffIndex=0;
 private debuffIndex=0;
 private nextBuff=8;
 private nextDebuff=8;
 autoBuffs=true;
 autoDebuffs=true;
 get nextBuffName():string{return TEST_BUFFS[this.buffIndex].name;}
 get nextDebuffName():string{return this.debuffs[this.debuffIndex]?.name??'No debuffs';}
 private readonly debuffs:typeof TEST_DEBUFFS;
 constructor(readonly dungeon:Dungeon,creatures:CreatureInfo[],weapons:WeaponInfo[],readonly mode:TestAreaMode='weapons'){
  dungeon.practiceMode=true;
  dungeon.readied=undefined;
  dungeon.learnAllPracticeSpells();
  dungeon.player.yaw=-Math.PI/2;
  dungeon.surfaceMaterials={'WALLA.SET':'stone','WALLB.SET':'stone','DOOR_2.IMG':'wood','DOOR_6.IMG':'metal','IFLOOR4.IMG':'wood','T_NGRASS.IMG':'soft'};
  // Use a separate practice inventory; the saved character and normal run are untouched.
  for(const item of [...dungeon.inventory.items])dungeon.inventory.remove(item);
  for(let material=0;material<MATERIALS.length;material++)for(let type=0;type<weapons.length;type++)dungeon.inventory.add(makeWeapon(weapons,type,material));
  dungeon.inventory.add(makeSteelArrows(200));
  const sword=dungeon.inventory.items.find(i=>i.kind==='weapon'&&i.type===3&&i.material===1)!;
  if(sword)dungeon.use(itemKey(sword));
  dungeon.hero.carry=Math.max(dungeon.hero.carry,10000);
  this.enemyTypes=mode==='weapons'?[...creatures]:[];
  this.debuffs=TEST_DEBUFFS.filter(e=>!e.id.startsWith('disease:') || dungeon.availablePracticeDiseases.includes(Number(e.id.slice(8))));
  dungeon.practiceKeepVitalsFull=mode==='weapons';
  this.nextBuff=this.nextDebuff=dungeon.time+8;
  this.nextId=Math.max(-1,...dungeon.creatures.map(c=>c.id))+1;
  this.update(0,true);
 }
 update(dt:number,initial=false):void {
  if(dt<=0&&!initial)return;
  const d=this.dungeon,now=d.time;
  d.hero.carry=Math.max(d.hero.carry,10000);
  if(this.mode==='effects'){
   if(!initial && this.autoBuffs && now>=this.nextBuff)this.addBuff();
   if(!initial && this.autoDebuffs && now>=this.nextDebuff)this.addDebuff();
   return;
  }
  for(const c of d.creatures){
   if(isDefeated(c)&&!this.dead.has(c))this.dead.set(c,now);
  }
  for(const [c,at] of this.dead){
   if(now-at<5)continue;
   d.removePracticeCreature(c);this.dead.delete(c);
  }
  // A regenerating knockdown is still the current opponent, not a kill.
  if(d.creatures.some(c=>!isDefeated(c))){this.missingSince=undefined;return;}
  if(this.missingSince===undefined)this.missingSince=now;
  if(!initial&&now-this.missingSince<1.5)return;
  const info=this.enemyTypes[this.nextType];if(!info)return;
  const creature=rangeSpawn(d.level,d.player,d.creatures,info);if(!creature)return;
  creature.id=this.nextId++;creature.awareness=0;creature.state='idle';
  d.addPracticeCreature(creature);
  if(!initial)d.events.push({type:'spawned',creature});
  this.nextType=(this.nextType+1)%this.enemyTypes.length;
  this.missingSince=undefined;

 }
 addBuff():void {
  if(this.mode!=='effects')return;
  const effect=TEST_BUFFS[this.buffIndex];
  this.dungeon.applyPracticeEffect(effect.id);
  this.buffIndex=(this.buffIndex+1)%TEST_BUFFS.length;this.nextBuff=this.dungeon.time+8;
 }
 addDebuff():void {
  if(this.mode!=='effects'||!this.debuffs.length)return;
  const effect=this.debuffs[this.debuffIndex];
  this.dungeon.applyPracticeEffect(effect.id);
  this.debuffIndex=(this.debuffIndex+1)%this.debuffs.length;this.nextDebuff=this.dungeon.time+8;
 }
 clearEffects():void {
  if(this.mode!=='effects')return;
  this.dungeon.clearPracticeEffects();this.buffIndex=this.debuffIndex=0;
  this.autoBuffs=this.autoDebuffs=false;this.nextBuff=this.nextDebuff=this.dungeon.time+8;
 }
 toggleAutoBuffs():void{this.autoBuffs=!this.autoBuffs;this.nextBuff=this.dungeon.time+8;}
 toggleAutoDebuffs():void{this.autoDebuffs=!this.autoDebuffs;this.nextDebuff=this.dungeon.time+8;}

}
