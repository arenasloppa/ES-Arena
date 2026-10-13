export interface TestEffect {id:string;name:string;kind:'buff'|'debuff'}
export const TEST_BUFFS:readonly TestEffect[]=[
 {id:'shield',name:'Shield',kind:'buff'}, {id:'sanctuary',name:'Sanctuary',kind:'buff'},
 {id:'invisibility',name:'Invisibility',kind:'buff'}, {id:'light',name:'Light',kind:'buff'},
 {id:'regeneration',name:'Regeneration',kind:'buff'}, {id:'fortify',name:'Fortify Strength',kind:'buff'},
 ...['Levitation','Resist Fire','Resist Cold','Resist Shock','Resist Poison','Spell Absorption','Spell Reflection','Spell Resistance'].map(name=>({id:name.toLowerCase().replace(/ /g,'-'),name,kind:'buff' as const})),
];
/** Available gameplay effects and every disease read from the original data. */
export const TEST_DEBUFFS:readonly TestEffect[]=[
 {id:'poison',name:'Poison',kind:'debuff'}, {id:'paralysis',name:'Paralysis',kind:'debuff'},
 {id:'silence',name:'Silence',kind:'debuff'}, {id:'drain',name:'Spell Point Drain',kind:'debuff'},
 {id:'fire',name:'Fire Damage',kind:'debuff'}, {id:'frost',name:'Frost Damage',kind:'debuff'},
 {id:'shock',name:'Shock Damage',kind:'debuff'}, {id:'curse',name:'Curse',kind:'debuff'},
 ...['Witch Pox','Plague','Yellow Fever','Stomach Rot','Consumption','Brain Fever','Swamp Rot','Calirons Curse','Cholera','Leprosy','Wound Rot','Red Death','Blood Rot','Typhoid Fever','Dementia','Chrondiasis','Wizard Fever'].map((name,i)=>({id:`disease:${i+10}`,name,kind:'debuff' as const})),
];
export type TestAreaMode='weapons'|'effects';
export const TEST_SECTION_NAMES:Record<TestAreaMode,string>={weapons:'Weapon Testing',effects:'Effect Testing'};

export function testEffectDescription(id:string):string {
 return ({
  shield:'Absorbs 60 points of incoming damage',
  sanctuary:'Makes creatures ignore you; their spells can still reach you',
  invisibility:'Makes you invisible to creatures that cannot see invisible targets',
  light:'Extends your vision in dark areas',
  regeneration:'Restores 3 health every 2 seconds',
  fortify:'Raises Strength by 10 points',
  levitation:'Allows you to cross pits and water',
  'resist-fire':'Resists fire damage', 'resist-cold':'Resists cold damage',
  'resist-shock':'Resists shock damage', 'resist-poison':'Resists poison',
  'spell-absorption':'Converts incoming spells to spell points',
  'spell-reflection':'Reflects incoming spells back to their caster',
  'spell-resistance':'Resists incoming spells',
  paralysis:'Prevents movement, attacks and casting',
  poison:'Deals damage every 2 seconds',
  silence:'Prevents spellcasting',
  drain:'Drains 2 spell points every 2 seconds',
  fire:'Deals periodic fire damage',
  frost:'Deals periodic frost damage',
  shock:'Deals periodic shock damage',
  curse:'Lowers Strength by 10 points',
 } as Record<string,string>)[id]??'';
}
