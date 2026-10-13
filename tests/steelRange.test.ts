import { describe, it, expect } from 'vitest';
import { GamepadInput, BUTTON } from '../src/input/gamepad';
import { rangeGamepad, AttackHold } from '../src/input/rangeGamepad';
import { steelAttackDuration } from '../src/game/weaponHandling';
import { steelTestRoom, rangeSpawn } from '../src/game/steelTestRoom';
import { Dungeon, IDLE_INPUT } from '../src/game/dungeon';
import { makeSteelArrows, itemKey } from '../src/game/items';
import type { Creature } from '../src/game/creatures';
import type { CreatureInfo } from '../src/formats/exe';
function controller() {
  const buttons = Array.from({length:16},()=>({pressed:false,touched:false,value:0}));
  const pad = {connected:true,id:'Xbox',timestamp:0,axes:[0,0,0,0],buttons};
  return {pad,input:new GamepadInput(()=>pad.connected?[pad as unknown as Gamepad]:[]),set:(name:keyof typeof BUTTON,value:number)=>{buttons[BUTTON[name]]={pressed:value>.5,touched:value>0,value};}};
}
describe('Steel proving ground',()=>{
  it('maps sticks, actions and drifting neutral sticks consistently with the game',()=>{
    const c=controller();c.pad.axes[1]=-1;c.pad.axes[2]=1;c.set('A',1);c.set('Y',1);c.set('LS',1);c.set('RS',1);
    const frame=rangeGamepad(c.input,1,.1);
    expect(frame.forward).toBe(1);expect(frame.yaw).toBeCloseTo(.32);expect(frame.use&&frame.jump&&frame.sprint&&frame.sneak).toBe(true);
    expect(rangeGamepad(c.input,2,.1).use).toBe(false);
    c.pad.axes[0]=.08;c.pad.axes[1]=.07;c.pad.axes[2]=.05;
    expect(rangeGamepad(c.input,3,.1).forward).toBeCloseTo(0);
  });
  it('uses the new stick-click sneak/sprint bindings without using ability buttons for movement',()=>{
    const c=controller();c.set('LS',1);c.set('RS',1);
    const first=rangeGamepad(c.input,1,.02);expect(first.sprint).toBe(true);expect(first.sneak).toBe(true);
    expect(rangeGamepad(c.input,2,.02).sneak).toBe(false);
    c.set('LS',0);c.set('RS',0);c.set('RB',1);c.set('Right',1);
    const second=rangeGamepad(c.input,3,.02);expect(second.sprint||second.sneak).toBe(false);expect(second.hotkey).toBe(1);
    expect(second).not.toHaveProperty('next');expect(second).not.toHaveProperty('target');
  });
  it('honours the app trigger thresholds, inverted look and saved sensitivity',()=>{
    const c=controller();c.pad.axes[2]=1;c.pad.axes[3]=1;c.set('RT',.2);c.set('LT',.2);
    const first=rangeGamepad(c.input,1,.02);expect(first.attack||first.block).toBe(false);
    c.set('RT',.6);c.set('LT',.4);
    const normal=rangeGamepad(c.input,2,.02,{lookSpeed:1,invertLook:false}),inverted=rangeGamepad(c.input,3,.02,{lookSpeed:2,invertLook:true});
    expect(normal.attack&&normal.block).toBe(true);expect(inverted.yaw).toBeCloseTo(normal.yaw*2);expect(inverted.pitch).toBeCloseTo(-normal.pitch*2);
  });
  it('uses both shift keys and the app arrow-key movement',async()=>{
    const {keyboardMovement}=await import('../src/input/gameplayControls');
    expect(keyboardMovement(new Set(['ArrowUp','ArrowRight','ShiftRight']))).toEqual({forward:1,strafe:0,sprint:true,turn:1});
    expect(keyboardMovement(new Set(['KeyW','ArrowUp','KeyS','KeyD','KeyA']))).toEqual({forward:0,strafe:0,sprint:false,turn:0});
  });
  it('combines holds without repeat presses and creates exactly one release',()=>{
    const hold=new AttackHold();
    expect(hold.sample(true)).toEqual({held:true,pressed:true,released:false});
    expect(hold.sample(true)).toEqual({held:true,pressed:false,released:false});
    expect(hold.sample(false)).toEqual({held:false,pressed:false,released:true});
    expect(hold.sample(false)).toEqual({held:false,pressed:false,released:false});
    hold.sample(true);hold.reset();expect(hold.sample(false).released).toBe(false);
  });
  it('a controller holds a bow without spending ammo and fires on release',()=>{
    const d=new Dungeon(steelTestRoom(), undefined);const bow=d.inventory.add({kind:'weapon',name:'Steel Short Bow',type:16,material:1,damage:[2,4],twoHanded:true,weight:1,value:1});d.use(itemKey(bow));d.inventory.add(makeSteelArrows(2));
    const c=controller(),hold=new AttackHold();c.set('RT',1);
    for(let i=0;i<180;i++){const f=rangeGamepad(c.input,i,1/120);d.update(1/120,{...IDLE_INPUT,block:f.block,attack:hold.sample(f.attack)});}
    expect(d.arrows).toHaveLength(0);expect(d.inventory.steelArrowCount()).toBe(2);
    c.set('RT',0);const f=rangeGamepad(c.input,181,1/120);d.update(1/120,{...IDLE_INPUT,attack:hold.sample(f.attack)});
    for(let i=0;i<24;i++)d.update(1/120,IDLE_INPUT);
    expect(d.arrows).toHaveLength(1);expect(d.inventory.steelArrowCount()).toBe(1);
  });
  it('controller disconnection clears both analog triggers and movement',()=>{
    const c=controller();c.set('RT',1);c.set('LT',1);c.pad.axes[1]=-1;rangeGamepad(c.input,1,.02);c.pad.connected=false;
    const f=rangeGamepad(c.input,2,.02);expect(f.attack||f.block).toBe(false);expect(f.forward).toBeCloseTo(0);
  });
  it('spawns real creatures only on free floor, caps the crowd and assigns stable ids',()=>{
    const level=steelTestRoom(),player={...level.start,yaw:-Math.PI/2},info={name:'Rat',health:[2,4],damage:[1,2],animation:'RAT'} as CreatureInfo;
    const actors: Creature[]=[];for(let i=0;i<16;i++){const c=rangeSpawn(level,player,actors,info);if(c){expect(level.cells[Math.floor(c.y)*level.width+Math.floor(c.x)].kind).toBe('empty');expect(actors.every(a=>a.id!==c.id)).toBe(true);actors.push(c);}}
    expect(actors.length).toBeGreaterThan(2);
    const occupied=Array.from({length:16},(_,id)=>({...actors[0],id}));expect(rangeSpawn(level,player,occupied,info)).toBeUndefined();
  });
  it('weight profiles extend heavy recovery while retaining legacy timings',()=>{
    const w={name:'Test',cif:'SWORD.CIF',material:1,damage:[1,4] as [number,number]};
    expect(steelAttackDuration({...w,type:13},false)).toBeGreaterThan(steelAttackDuration({...w,type:1},false));
    expect(steelAttackDuration({...w,type:13},true)).toBeGreaterThan(steelAttackDuration({...w,type:13},false));
    expect(steelAttackDuration({...w,type:13,material:0},false)).toBe(.4);
  });
});
