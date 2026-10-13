import {describe, it, expect} from 'vitest';
import {effectTimer, effectClockProgress, statusEffectsKey} from '../src/game/statusEffects';
import {Dungeon} from '../src/game/dungeon';
import {textLevel} from './helpers/level';

describe('status effect clocks', () => {
  it('counts down whole seconds without ending early and formats longer effects', () => {
    const effect = {id: 'paralysis', name: 'Paralyzed', icon: 'paralysis', kind: 'debuff' as const, dispelType: 'poison' as const, remaining: .1};
    expect(effectTimer(effect)).toBe('1s');
    expect(effectTimer({...effect, remaining: 60.00000000000001})).toBe('1:00');
    expect(effectTimer({...effect, remaining: 61.2})).toBe('1:02');
    expect(effectTimer({...effect, remaining: 3661})).toBe('1h 1m');
    expect(effectTimer({...effect, remaining: -1})).toBe('0s');
    expect(statusEffectsKey([effect])).toBe(statusEffectsKey([{...effect, remaining: .9}]));
    expect(statusEffectsKey([effect])).not.toBe(statusEffectsKey([{...effect, remaining: 1.1}]));
  });
  it('never invents an expiry for a permanent disease or points-based shield', () => {
    expect(effectTimer({id: 'plague', name: 'Plague', icon: 'plague', kind: 'debuff', dispelType: 'disease'})).toBe('');
    expect(effectTimer({id: 'shield', name: 'Shield', icon: 'shield', kind: 'buff', persistentLabel: '12 HP'})).toBe('12 HP');
  });
  it('uses the actual dungeon clock and removes expired paralysis from both HUD and magic menu', () => {
    const d = new Dungeon(textLevel(['###', '#@#', '###']), undefined);
    (d as unknown as {paralyse(seconds: number): void}).paralyse(10);
    expect(d.statusEffects()).toEqual([{id: 'paralysis', name: 'Paralyzed', icon: 'paralysis', kind: 'debuff' as const, dispelType: 'poison' as const, remaining: 10,duration:10}]);
    d.time += 3.25;
    expect(effectTimer(d.statusEffects()[0])).toBe('7s');
    expect(d.activeEffects()).toEqual(['Paralyzed']);
    d.time += 6.75;
    expect(d.statusEffects()).toEqual([]);
    expect(d.activeEffects()).toEqual([]);
  });
  it('uses the original duration for the radial sweep, refreshes cleanly and handles untimed effects',()=>{
    const effect={id:'light',name:'Light',icon:'light',kind:'buff' as const,duration:60,remaining:30};
    expect(effectClockProgress(effect)).toBe(.5);
    expect(effectClockProgress({...effect,remaining:60})).toBe(0);
    expect(effectClockProgress({...effect,remaining:-1})).toBe(1);
    expect(effectClockProgress({...effect,remaining:undefined})).toBe(0);
    expect(effectClockProgress({...effect,duration:0})).toBe(0);
    expect(statusEffectsKey([effect])).not.toBe(statusEffectsKey([{...effect,remaining:30.3}]));
  });

});
