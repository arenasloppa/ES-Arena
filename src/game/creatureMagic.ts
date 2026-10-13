import type {Creature} from './creatures';

export interface AttributeModifier {
  attribute:number; points:number; loss:number; every:number; next:number; until:number; growth?:number;
}
export interface CreatureMagic {
  stamina:number; maxStamina:number; magicka:number; maxMagicka:number;
  modifiers:AttributeModifier[]; silencedUntil:number; nextCast:number;
}

/** Keep mutable spell state on the actor, never on the shared native creature table. */
export function creatureMagic(c:Creature):CreatureMagic {
  if(c.magic)return c.magic;
  const base=(i:number)=>Math.round((c.info.attributes?.[i]??128)*100/256);
  const maxStamina=base(0)+base(5),maxMagicka=base(1)*2;
  return c.magic={stamina:maxStamina,maxStamina,magicka:maxMagicka,maxMagicka,modifiers:[],silencedUntil:0,nextCast:0};
}
/** Attribute values in the character sheet's 0–100 units. */
export function creatureAttribute(c:Creature,index:number):number {
  const base=(c.info.attributes?.[index]??(index===3?c.info.agility:undefined)??128)*100/256;
  return Math.max(0,base+(c.magic?.modifiers.filter(m=>m.attribute===index).reduce((n,m)=>n+m.points,0)??0));
}
export function updateCreatureMagic(c:Creature,now:number,dt:number):void {
  const state=c.magic;if(!state)return;
  state.stamina=Math.min(state.maxStamina,state.stamina+dt);
  for(const m of [...state.modifiers]) {
    while(m.growth&&now>=m.next&&m.next<m.until){m.points-=m.growth;m.next+=m.every;}
    while(m.loss>0&&m.points!==0&&now>=m.next) {
      m.points=Math.sign(m.points)*Math.max(0,Math.abs(m.points)-m.loss);m.next+=m.every;
    }
    if(now>=m.until||m.points===0)state.modifiers.splice(state.modifiers.indexOf(m),1);
  }
  state.maxStamina=creatureAttribute(c,0)+creatureAttribute(c,5);
  state.maxMagicka=creatureAttribute(c,1)*2;
  state.stamina=Math.min(state.stamina,state.maxStamina);state.magicka=Math.min(state.magicka,state.maxMagicka);
}
