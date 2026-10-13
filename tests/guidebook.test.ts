import {describe,it,expect} from 'vitest';
import {guideEntries,searchGuide} from '../src/game/guidebook';
import {AFFIXES} from '../src/game/affixes';
import {ELITE_AFFIXES,ELITE_AURAS,CHAMPIONS} from '../src/game/elites';
import {nativeAffixes} from '../src/game/lootRoll';
import type {LootRules} from '../src/game/loot';
import {parseSpells} from '../src/formats/spells';
import {file,record} from './helpers/spells';

describe('guidebook matches available affixes',()=>{
 it('includes every weapon affix and all other equipment affixes, without ammo or armour-only weapon entries',()=>{
  const weapons=guideEntries('weapons'),other=guideEntries('equipment');
  expect(weapons.map(e=>e.id).sort()).toEqual(AFFIXES.filter(a=>a.kinds.includes('weapon')).map(a=>a.id).sort());
  for(const a of AFFIXES)expect([...weapons,...other].some(e=>e.id===a.id)).toBe(true);
  expect(weapons.some(e=>e.id.startsWith('suffix-moveSpeed'))).toBe(false);
  for(const e of [...weapons,...other]){expect(e.description).not.toContain('undefined');expect(e.notes.join(' ')).not.toContain('undefined');expect(e.name).toBeTruthy();}
 });
 it('describes rolled ranges, equipment levels and useful caps from real definitions',()=>{
  const weapons=guideEntries('weapons'),other=guideEntries('equipment');
  expect(weapons.find(e=>e.id==='prefix-fireDamage-0')?.description).toContain('+1–3 Fire damage');
  expect(weapons.find(e=>e.id==='prefix-aetherial')?.description).toContain('all eight attributes');
  expect(other.find(e=>e.id==='suffix-moveSpeed-0')?.notes.join(' ')).toContain('Boots only');
  expect(weapons.find(e=>e.id==='prefix-damagePct-5')?.notes.join(' ')).toContain('cannot roll on Rare');
  expect(other.find(e=>e.id==='prefix-lightRadius-0')?.description).toContain('110–110%');
 });
 it('includes all monster affixes, aura types and champion kinds',()=>{
  const entries=guideEntries('monsters');
  for(const id of ELITE_AFFIXES)expect(entries.some(e=>e.id===`monster-${id}`)).toBe(true);
  for(const id of ELITE_AURAS)expect(entries.some(e=>e.id===`aura-${id}`)).toBe(true);
  for(const id of CHAMPIONS)expect(entries.some(e=>e.id===`champion-${id}`)).toBe(true);
  expect(entries).toHaveLength(27);expect(entries.find(e=>e.id==='monster-volley')?.description).toContain('already cast spells');
 });
 it('filters case-insensitively by multiple name and effect terms, keeping an empty query complete',()=>{
  const entries=guideEntries('monsters');expect(searchGuide(entries,'')).toHaveLength(entries.length);
  expect(searchGuide(entries,'STORM bolts').map(e=>e.id)).toEqual(['monster-storm']);expect(searchGuide(entries,'doesnotexist')).toEqual([]);
 });
 it('shows only spell enchantments the loot generator can actually select',()=>{
  const spells=parseSpells(file(record({name:'Embers',params:[[2,4,0,0,0,0]]}),record({name:'Open',effects:[19]})));
  const rules={spells,tables:{weaponEnchantments:[{name:'of Embers',spell:0,level:3},{name:'of Opening',spell:1,level:1},{name:'Missing',spell:99,level:1}],armourEnchantments:[]}} as unknown as Pick<LootRules,'tables'|'spells'>;
  const definitions=nativeAffixes('weapon',24,rules),guide=guideEntries('weapons',rules);
  for(const a of definitions)expect(guide.some(e=>e.id===a.id)).toBe(true);
  expect(definitions.filter(a=>a.procChance)).toHaveLength(1);expect(guide.find(e=>e.id==='suffix-charge-0')?.description).toContain('Embers');
  expect(guide.find(e=>e.id==='suffix-echo-0')?.description).toContain('10% chance');expect(guide.some(e=>e.id==='suffix-charge-99')).toBe(false);
 });
});
