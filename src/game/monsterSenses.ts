/** Native AI invisibility exceptions (NPCs.md / IsPlayerInvisible). */
export function monsterSeesInvisible(id: number | undefined): boolean {
  return id!==undefined && [12,15,20,22,23,24].includes(id);
}
