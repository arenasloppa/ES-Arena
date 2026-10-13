/**
 * The minimap in the corner: a round window on the explored map that turns
 * with the player, so what is ahead is always up. It fills in as the player
 * explores, shows the way out once found, and marks creatures that are
 * hunting the player and in sight.
 */
import type { Dungeon } from '../game/dungeon';
import { isAlive } from '../game/creatures';
import { lineOfSight } from '../game/grid';
import type { Cell } from '../game/level';

/** Chart pixels per cell. */
const CELL = 8;
/** Minimap pixels per cell, before the screen's pixel ratio. */
const ZOOM = 9;

const COLORS = {
  floor: 'rgba(232, 226, 210, 0.2)',
  raised: 'rgba(232, 226, 210, 0.34)',
  wet: 'rgba(86, 136, 196, 0.5)',
  lava: 'rgba(226, 106, 42, 0.6)',
  dry: 'rgba(0, 0, 0, 0.75)',
  wall: 'rgba(243, 240, 232, 0.8)',
  door: 'rgba(222, 184, 120, 0.95)',
  exit: 'rgba(150, 196, 255, 0.95)',
  enemy: '#e0473a',
};

export class Minimap {
  private readonly chart = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private chartKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly dungeon: Dungeon,
  ) {
    this.chart.width = dungeon.level.width * CELL;
    this.chart.height = dungeon.level.depth * CELL;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(): void {
    const d = this.dungeon;
    const key = `${d.explored.version}:${d.terrainVersion}:${[...d.openDoors].join(',')}`;
    if (key !== this.chartKey) {
      this.chartKey = key;
      this.paintChart();
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(this.canvas.clientWidth * dpr);
    if (!size) return;
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    const ctx = this.ctx;
    const r = size / 2;
    const p = d.player;
    const turn = -Math.PI / 2 - p.yaw;
    const scale = (ZOOM * dpr) / CELL;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(r, r);
    ctx.rotate(turn);
    ctx.scale(scale, scale);
    ctx.drawImage(this.chart, -p.x * CELL, -p.y * CELL);
    // Creatures that are after the player and in sight.
    ctx.fillStyle = COLORS.enemy;
    for (const c of d.creatures) {
      if (!isAlive(c) || (c.state !== 'chase' && c.state !== 'attack')) continue;
      if (Math.hypot(c.x - p.x, c.y - p.y) > r / scale / CELL) continue;
      if (!lineOfSight(d.level, p.x, p.y, c.x, c.y, d.openDoors)) continue;
      ctx.beginPath();
      ctx.arc((c.x - p.x) * CELL, (c.y - p.y) * CELL, CELL * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The player, always in the middle facing up.
    const a = 7 * dpr;
    ctx.beginPath();
    ctx.moveTo(r, r - a);
    ctx.lineTo(r + a * 0.7, r + a * 0.7);
    ctx.lineTo(r, r + a * 0.25);
    ctx.lineTo(r - a * 0.7, r + a * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#f6eed8';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    ctx.fill();
  }

  /** Draws every explored cell once onto the chart, which draw() then turns and crops. */
  private paintChart(): void {
    const { level, explored, openDoors } = this.dungeon;
    const ctx = this.chart.getContext('2d')!;
    const { width, depth, cells } = level;
    ctx.clearRect(0, 0, this.chart.width, this.chart.height);
    const at = (x: number, y: number): Cell | undefined => (x < 0 || y < 0 || x >= width || y >= depth ? undefined : cells[y * width + x]);
    const open = (c: Cell | undefined, i: number) =>
      !!c && (c.kind === 'empty' || c.kind === 'raised' || (c.kind === 'door' && openDoors.has(i)));
    ctx.lineCap = 'square';
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const c = cells[i];
        if (!explored.has(i)) continue;
        const px = x * CELL;
        const py = y * CELL;
        if (c.kind === 'door') {
          ctx.fillStyle = COLORS.floor;
          ctx.fillRect(px, py, CELL, CELL);
          if (!openDoors.has(i)) {
            // A bar across the doorway, from one wall beside it to the other.
            ctx.fillStyle = COLORS.door;
            const wallsEastWest = !open(at(x - 1, y), i - 1) && !open(at(x + 1, y), i + 1);
            if (wallsEastWest) ctx.fillRect(px, py + CELL * 0.4, CELL, CELL * 0.2);
            else ctx.fillRect(px + CELL * 0.4, py, CELL * 0.2, CELL);
          }
          continue;
        }
        if (c.kind === 'wall') {
          if (c.exit) {
            ctx.fillStyle = COLORS.exit;
            ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
          }
          continue;
        }
        if (c.kind !== 'empty' && c.kind !== 'raised') continue;
        ctx.fillStyle = c.chasm ? COLORS[c.chasm] : c.kind === 'raised' ? COLORS.raised : COLORS.floor;
        ctx.fillRect(px, py, CELL, CELL);
        // Lines along the walls round this open cell.
        ctx.strokeStyle = COLORS.wall;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const n = at(x + dx, y + dy);
          if (n && n.kind !== 'wall' && n.kind !== 'transparent' && n.kind !== 'diagonal') continue;
          const x0 = dx === 1 ? px + CELL : px;
          const y0 = dy === 1 ? py + CELL : py;
          ctx.moveTo(x0, y0);
          ctx.lineTo(dx === 0 ? x0 + CELL : x0, dy === 0 ? y0 + CELL : y0);
        }
        ctx.stroke();
      }
    }
  }
}
