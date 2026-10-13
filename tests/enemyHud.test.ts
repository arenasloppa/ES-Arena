import {describe,it,expect} from 'vitest';
import {Hud} from '../src/ui/hud';

/** Only the enemy widget's DOM surface, so its update/fade logic runs without WebGL. */
function widget(){
 const classes=new Set<string>(),properties=new Map<string,string>();
 const hud=Object.create(Hud.prototype) as {enemy: Hud["enemy"]; enemyEl: any; enemyName: any; enemyBar: any; enemyKey: string; enemyUntil: number};
 hud.enemyEl={hidden:true,classList:{remove:(name:string)=>classes.delete(name)}};
 hud.enemyName={textContent:''};hud.enemyBar={style:{setProperty:(key:string,value:string)=>properties.set(key,value)}};
 hud.enemyKey='';hud.enemyUntil=0;
 return{hud,classes,properties};
}
describe('enemy health widget',()=>{
 it('reopens a faded bar even when the new hit has the same name and health values',()=>{
  const {hud,classes,properties}=widget();hud.enemy('Rat',4,8,1);classes.add('faded');hud.enemyEl.hidden=true;
  hud.enemy('Rat',4,8,1);expect(hud.enemyEl.hidden).toBe(false);expect(classes.has('faded')).toBe(false);expect(properties.get('--fill')).toBe('0.5');
 });
 it('updates partial damage, death and a different same-named respawn',()=>{
  const {hud,properties}=widget();hud.enemy('Goblin',10,10,1);expect(properties.get('--fill')).toBe('1');
  hud.enemy('Goblin',6,10,1);expect(properties.get('--fill')).toBe('0.6');
  hud.enemy('Goblin',0,10,1);expect(properties.get('--fill')).toBe('0');
  hud.enemy('Goblin',10,10,2);expect(properties.get('--fill')).toBe('1');expect(hud.enemyKey).toBe('2:10:10');
 });
 it('keeps the visual fraction finite and in range',()=>{
  const {hud,properties}=widget();hud.enemy('Rat',-3,8);expect(properties.get('--fill')).toBe('0');
  hud.enemy('Rat',12,8);expect(properties.get('--fill')).toBe('1');
  hud.enemy('Rat',0,0);expect(properties.get('--fill')).toBe('0');
 });
});
