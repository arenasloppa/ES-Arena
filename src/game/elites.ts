import type {Creature} from './creatures';
import type {Random} from './combat';
import type {DamageKind} from './combatText';

export const ELITE_AFFIXES = ['strong','swift','flame','frost','storm','spellward','siphon','volley','prismatic','stonehide','curse','blink','aura'] as const;
export type EliteAffix=typeof ELITE_AFFIXES[number];
export const CHAMPIONS=['champion','berserker','fanatic','ghostly','possessed'] as const;
export type Champion=typeof CHAMPIONS[number];
export const ELITE_AURAS=['might','flame','aim','frost','storm','weakening','fury'] as const;
export type EliteAura=typeof ELITE_AURAS[number];
export const AFFIX_LABELS:Record<EliteAffix,string>={strong:'Giant Strength',swift:'Windrunner',flame:'Flamebound',frost:'Winterbound',storm:'Stormbound',spellward:'Spellwarded',siphon:'Magicka Thief',volley:'Spell Volley',prismatic:'Prismatic Strikes',stonehide:'Stonehide',curse:'Hex Bearer',blink:'Voidstep',aura:'Aura Bearer'};
export const CHAMPION_LABELS:Record<Champion,string>={champion:'Champion',berserker:'Berserker',fanatic:'Frenzied',ghostly:'Spectral',possessed:'Daedra Possessed'};
export const AURA_LABELS:Record<EliteAura,string>={might:'Might',flame:'Flame',aim:'True Aim',frost:'Winter',storm:'Storm',weakening:'Frailty',fury:'Fury'};
export interface EliteState {
 tier:'champion'|'unique'|'minion'; champion?:Champion; name?:string; leader?:number;
 affixes:EliteAffix[]; aura?:EliteAura; baseHealth:number; baseDamage:[number,number];
 physicalResist:number; resist:Partial<Record<DamageKind,number>>; pace:number; attackRate:number; curseImmune:boolean;
 chilledUntil?:number; nextPulse:number; nextStorm:number; nextBlink:number; deathTriggered:boolean;
}
const first=['Ash','Grave','Iron','Night','Stone','Dusk','Frost','Ember','Blood','Void','Storm','Bone','Moon','Dread','Thorn','Fell'];
const last=['Watcher','Reaver','Binder','Fang','Warden','Caller','Claw','Harvester','Breaker','Whisper','Maw','Stalker','Heart','Reaper'];
const pick=<T>(values:readonly T[],random:Random)=>values[Math.min(values.length-1,Math.floor(Math.max(0,random())*values.length))];
export function rollEliteAffixes(c:Creature,random:Random):EliteAffix[]{
 const pool=ELITE_AFFIXES.filter(a=>a!=='volley'||!!c.info.spells?.length);
 const result:EliteAffix[]=[];
 for(let i=0;i<(c.info.level>=20?3:c.info.level>=10?2:1);i++){
  const eligible=pool.filter(a=>!result.includes(a));result.push(pick(eligible,random));
 }
 return result;
}
/** Per-actor changes leave the native tables, art and sounds intact. */
export function makeElite(c:Creature,tier:EliteState['tier'],random:Random,options:{champion?:Champion;affixes?:EliteAffix[];aura?:EliteAura;leader?:number}={}):void {
 if(c.elite||c.info.boss||c.info.id===24)return;
 const kind=tier==='champion'?options.champion??pick(CHAMPIONS,random):undefined;
 const affixes=tier==='unique'?[...(options.affixes??rollEliteAffixes(c,random))]:tier==='minion'?[...(options.affixes??[])].filter(a=>a==='swift'||a==='strong'):[];
 const e:EliteState={tier,champion:kind,leader:options.leader,affixes,baseHealth:c.maxHealth,baseDamage:[...c.info.damage],physicalResist:0,resist:{},pace:1,attackRate:1,curseImmune:kind==='possessed',nextPulse:0,nextStorm:0,nextBlink:0,deathTriggered:false};
 if(tier==='unique')e.name=pick(first,random)+pick(last,random).toLowerCase();
 if(affixes.includes('aura'))e.aura=options.aura??pick(ELITE_AURAS.filter(a=>a!=='storm'||c.info.level>=20),random);
 const hp=tier==='minion'?2:tier==='unique'?4:kind==='berserker'?.75:kind==='possessed'?6:3;
 let damage=tier==='champion'?kind==='berserker'?3.7:1.9:1;
 let agility=tier==='champion'?kind==='berserker'?3.7:1.67:1;
 if(kind==='champion'||kind==='possessed')e.pace=1.2;
 if(kind==='fanatic'){e.pace=2;e.physicalResist=-30;}
 if(kind==='ghostly'){e.physicalResist=80;e.resist.frost=50;}
 if(affixes.includes('strong')){damage+=tier==='minion'?.67:1.35;agility+=tier==='minion'?.45:.9;}
 if(affixes.includes('swift'))e.pace*=2;
 if(affixes.includes('stonehide'))e.physicalResist+=50;
 if(affixes.includes('spellward'))for(const k of ['fire','frost','shock'] as const)e.resist[k]=40;
 for(const [a,k]of [['flame','fire'],['frost','frost'],['storm','shock'],['siphon','magic']] as const)if(affixes.includes(a))e.resist[k]=a==='siphon'?20:75;
 if(affixes.includes('prismatic'))for(const k of ['fire','frost','shock'] as const)e.resist[k]=Math.max(e.resist[k]??0,40);
 const info=c.info;c.info={...info,level:info.level+(tier==='champion'?2:3),damage:info.damage.map(n=>Math.max(1,Math.round(n*damage))) as [number,number],attributes:info.attributes?[...info.attributes]:undefined,agility:Math.min(255,Math.round((info.agility??128)*agility))};
 if(c.info.attributes)c.info.attributes[3]=c.info.agility!;
 c.health=c.maxHealth=Math.max(1,Math.round(c.maxHealth*hp));
 c.experienceValue=Math.round((c.experienceValue??0)*(tier==='champion'&&kind!=='berserker'?3:5));c.elite=e;
}
export function creatureName(c:Creature):string{return c.elite?.name??(c.elite?.tier==='champion'?`${CHAMPION_LABELS[c.elite.champion!]} ${c.info.name}`:c.elite?.tier==='minion'?`${c.info.name} Retainer`:c.info.name);}
export function eliteDescription(c:Creature):string {
 const e=c.elite;if(!e)return '';
 return [e.tier==='unique'?c.info.name:e.tier==='minion'?'Retainer':undefined,...e.affixes.map(a=>a==='aura'?`${AURA_LABELS[e.aura!]} Aura`:AFFIX_LABELS[a])].filter(Boolean).join(' · ');
}
export function eliteResistance(c:Creature,damage:number,kind:DamageKind):number {
 const e=c.elite;if(!e)return damage;
 const resistance=kind==='physical'?e.physicalResist:e.resist[kind]??0;
 return Math.max(0,damage*(1-Math.min(90,resistance)/100));
}
