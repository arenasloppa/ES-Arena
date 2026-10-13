import type {Character} from './character';
import type {Dungeon} from './dungeon';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(c:Character)=>'es-arena.progress:'+JSON.stringify([c.name,c.gender,c.race,c.cls,c.face]);
function storage():Store|undefined{try{return window.localStorage;}catch{return undefined;}}
export function saveProgress(c:Character,d:Dungeon,store=storage()):void {
 if(d.practiceMode||d.outcome)return;
 try{store?.setItem(key(c),JSON.stringify(d.progress()));}catch{/* The current run continues if storage is unavailable. */}
}
export function loadProgress(c:Character,d:Dungeon,store=storage()):boolean {
 if(d.practiceMode)return false;
 try{const raw=store?.getItem(key(c));return !!raw&&d.restoreProgress(JSON.parse(raw));}catch{return false;}
}
export function clearProgress(c:Character,store=storage()):void {try{store?.removeItem(key(c));}catch{/* No stored run to clear. */}}
