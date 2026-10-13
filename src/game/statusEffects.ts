export type StatusDispelType = 'magic' | 'poison' | 'disease' | 'curse';

/** HUD descriptions; game rules own the effect and its clock. */
export interface ActiveStatusEffect {
  id: string;
  name: string;
  icon: string;
  kind: 'buff' | 'debuff';
  /** How the harmful effect is classified; the glow belongs to the UI, not the artwork. */
  dispelType?: StatusDispelType;
  /** Seconds of active play remaining. Omitted for effects without an expiry. */
  remaining?: number;
  /** Total lifetime, used for the clock hand and radial grayscale sweep. */
  duration?: number;
  /** Optional non-timer quantity, such as remaining shield points. */
  persistentLabel?: string;
}

export function effectTimer(effect: ActiveStatusEffect): string {
  if (effect.remaining === undefined) return effect.persistentLabel ?? '';
  const seconds = Math.max(0, Math.ceil(effect.remaining - 1e-9));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** Fraction of the original lifetime elapsed; untimed effects have no clock. */
export function effectClockProgress(effect:ActiveStatusEffect):number {
  if(effect.remaining===undefined || effect.duration===undefined || effect.duration<=0)return 0;
  return Math.max(0,Math.min(1,1-effect.remaining/effect.duration));
}

/** Timer text and one-degree clock steps avoid rebuilding on every frame. */
export function statusEffectsKey(effects: ActiveStatusEffect[]): string {
  return JSON.stringify(effects.map(e => [e.id, e.name, e.icon, e.kind, e.dispelType, effectTimer(e),Math.round(effectClockProgress(e)*360)]));
}
