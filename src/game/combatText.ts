export type DamageKind = 'physical' | 'fire' | 'frost' | 'poison' | 'shock' | 'magic';
export const DAMAGE_COLOURS: Record<DamageKind, string> = {
  physical: '#f2ede2', fire: '#ff9b55', frost: '#91dfff', poison: '#a0e36a', shock: '#c1a0ff', magic: '#71e4d6',
};
export const CRITICAL_COLOUR = '#ffd35a';
export function spellDamageKind(element: number): DamageKind {
  return (['fire', 'frost', 'poison', 'shock', 'magic'] as const)[element] ?? 'magic';
}
export interface CombatLabel {
  id: number;
  amount: number;
  kind: DamageKind;
  critical: boolean;
  periodic: boolean;
  x: number;
  y: number;
  opacity: number;
}
interface HitText {
  id: number;
  amount: number;
  kind: DamageKind;
  critical: boolean;
  periodic: boolean;
  point: [number, number, number];
  born: number;
  lane: number;
}
const LIFE = 1.15;
const MAX_LABELS = 64;

/** Impact positions stay in the world while the camera moves and the text rises. */
export class CombatText {
  private hits: HitText[] = [];
  private nextId = 0;
  add(amount: number, point: [number, number, number], now: number, kind: DamageKind = 'physical', critical = false, periodic = false): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const id = this.nextId++;
    this.hits.push({id,amount,point:[...point],born:now,kind,critical,periodic,lane:((id % 5)-2)*16});
    if (this.hits.length > MAX_LABELS) this.hits.shift();
  }
  frame(now: number, project: (point: [number, number, number]) => {x:number;y:number;visible:boolean}): CombatLabel[] {
    this.hits = this.hits.filter(hit => now-hit.born < LIFE);
    return this.hits.flatMap(hit => {
      const age = Math.max(0, now-hit.born), position = project(hit.point);
      if (!position.visible) return [];
      return [{id:hit.id,amount:hit.amount,kind:hit.kind,critical:hit.critical,periodic:hit.periodic,
        x:position.x+hit.lane*(1-Math.exp(-age*9)),y:position.y-18-age*52,
        opacity:Math.min(1,(LIFE-age)/.3)}];
    });
  }
  clear(): void {this.hits=[];}
}
