import type {CreatureInfo} from '../formats/exe';
import type {Weapon} from './combat';

/** Original creature material checks (Combat.md / original program).
 * Golems require Elven, Dwarven and Mithril respectively; the next four
 * requirements are read from the player's executable. Vampires admit Silver.
 * Unarmed attacks bypass the material gate, as in the original.
 */
export function monsterWeaponDamage(damage: number, weapon: Weapon, target: CreatureInfo, undead: number[], requirements?: number[]): number {
  const id=target.id;
  if (id===undefined) return damage;
  if (id===24) return 0; // the final boss cannot be defeated by ordinary weapon damage
  const armed=weapon.type!==undefined;
  const material=weapon.material ?? 1;
  if (armed) {
    const minimum=id>=17&&id<=19 ? 3+id-17 : id>=20&&id<=23 ? requirements?.[id-20] : undefined;
    if (minimum!==undefined && material<minimum && !(id===22&&material===2)) return 0;
  }
  if (weapon.material===2 && undead.includes(id)) damage*=2;
  // Staff, mace and flail keep their full damage against a skeleton.
  if (id===7 && armed && ![0,11,12,13].includes(weapon.type!)) damage=Math.floor(damage/2);
  return damage;
}
