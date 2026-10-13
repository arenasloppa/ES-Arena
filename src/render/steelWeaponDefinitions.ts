/** Arena's weapon indices are preserved; Steel is material 1, never inferred from a name. */
export type WeaponStyle = 'sword' | 'short' | 'heavy' | 'staff' | 'flail' | 'bow';
export interface SteelWeaponDefinition {
  type: number;
  /** Material defaults to Steel (1) for the existing collection. */
  material?: number;
  key: string;
  name: string;
  style: WeaponStyle;
  grip: [number, number, number];
  axisRoll: number;
  /** Blunt working faces can have their own forward orientation without becoming cutting edges. */
  axisYaw?: number;
  /** Static mesh-facing correction, separate from attack rotation. */
  modelFacingYaw?: number;
  /** Authoring-space cutting edge: signed X, or 0 for a blunt/round weapon. */
  edgeAxis: -1 | 0 | 1;
  twoHanded: boolean;
}
export const STEEL_WEAPON_DEFINITIONS: readonly SteelWeaponDefinition[] = [
  {
    type: 0,
    key: 'staff',
    name: 'Staff',
    style: 'staff',
    grip: [0, -0.32, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 1,
    key: 'dagger',
    name: 'Dagger',
    style: 'short',
    grip: [0, -0.053, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 2,
    key: 'shortsword',
    name: 'Shortsword',
    style: 'sword',
    grip: [0, -0.0775, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 3,
    key: 'broadsword',
    name: 'Broadsword',
    style: 'sword',
    grip: [0, -0.096, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 4,
    key: 'saber',
    name: 'Saber',
    style: 'sword',
    grip: [0.0054, -0.1065, 0],
    edgeAxis: -1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 5,
    key: 'longsword',
    name: 'Longsword',
    style: 'sword',
    grip: [0, -0.118, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 6,
    key: 'claymore',
    name: 'Claymore',
    style: 'sword',
    grip: [0, -0.1715, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 7,
    key: 'tanto',
    name: 'Tanto',
    style: 'short',
    grip: [0, -0.0785, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 8,
    key: 'wakizashi',
    name: 'Wakizashi',
    style: 'sword',
    grip: [-0.002, -0.0935, 0],
    modelFacingYaw: Math.PI,
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 9,
    key: 'katana',
    name: 'Katana',
    style: 'sword',
    grip: [-0.00388, -0.1365, 0],
    edgeAxis: -1,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 10,
    key: 'dai-katana',
    name: 'Dai-Katana',
    style: 'sword',
    grip: [-0.00016, -0.1885, 0],
    edgeAxis: -1,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 11,
    key: 'mace',
    name: 'Mace',
    style: 'heavy',
    grip: [0.00137, -0.02478, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: false,
  },
  {
    type: 12,
    key: 'flail',
    name: 'Flail',
    style: 'flail',
    grip: [-0.41421, -0.00751, 0],
    edgeAxis: 0,
    axisRoll: 1.2217304763960306,
    twoHanded: true,
  },
  {
    type: 13,
    key: 'war-hammer',
    name: 'War Hammer',
    axisYaw: Math.PI / 2,
    style: 'heavy',
    grip: [0, -0.29, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 14,
    key: 'war-axe',
    name: 'War Axe',
    style: 'heavy',
    grip: [0, -0.012, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 15,
    key: 'battle-axe',
    name: 'Battle Axe',
    style: 'heavy',
    // This review uses the original mesh origin and Weapon Bone directly.
    grip: [0, 0, 0],
    edgeAxis: 1,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 16,
    key: 'short-bow',
    name: 'Short Bow',
    style: 'bow',
    grip: [-0.15, 0, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 17,
    key: 'long-bow',
    name: 'Long Bow',
    style: 'bow',
    grip: [-0.15, 0, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: true,
  },
  {
    type: 18,
    key: 'arrow',
    name: 'Arrow',
    style: 'sword',
    grip: [0, 0, 0],
    edgeAxis: 0,
    axisRoll: 0,
    twoHanded: false,
  },
];
export const STEEL_ARROW = STEEL_WEAPON_DEFINITIONS[18];
export function steelWeaponDefinition(weapon: { type?: number; material?: number }): SteelWeaponDefinition | undefined {
  return weapon.material === 1 && weapon.type !== undefined && weapon.type >= 0 && weapon.type < 18
    ? STEEL_WEAPON_DEFINITIONS[weapon.type]
    : undefined;
}
