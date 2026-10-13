import type {SpellRecord} from '../formats/spells';
/** Existing frame-free artwork represents spell effects; frames and controls belong to the HUD. */
export function abilityIcon(spell:SpellRecord):string {
 const e=spell.effects[0];
 const icon:Record<number,string>={0:'poison',2:'shield',6:'calirons-curse',10:'sanctuary',11:'fortify',12:'regeneration',14:'paralysis',15:'invisibility',17:'light',19:'light',20:'regeneration',21:'silence',22:'shield',23:'shield',24:'sanctuary'};
 return icon[e?.effect]??['fire','frost','poison','shock','calirons-curse'][spell.element]??'shield';
}
