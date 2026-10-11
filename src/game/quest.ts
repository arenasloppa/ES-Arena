/**
 * Skyrim-style objectives for a dungeon with a way out, with a quest marker
 * for the compass. In Arena's first dungeon they read: get out of the cell
 * (the marker shows the key first, then the cell door), find the Shift
 * Gate, and step through it. A dungeon whose start is not shut in skips
 * the first. Pure logic over the dungeon's state, so it can be unit tested.
 */
import type { Dungeon, DungeonEvent } from './dungeon';
import type { Level } from './level';

export interface Objective {
  text: string;
  done: boolean;
  /** Where the compass's quest marker points, if anywhere. */
  marker?: { x: number; y: number };
}

interface Step {
  text: string;
  done(d: Dungeon): boolean;
  marker?(d: Dungeon): { x: number; y: number } | undefined;
}

const centre = (level: Level, cell: number) => ({ x: (cell % level.width) + 0.5, y: Math.floor(cell / level.width) + 0.5 });

export class Quest {
  /** Objectives given so far, the current one last. */
  readonly objectives: Objective[] = [];
  private started = false;

  private constructor(
    readonly name: string,
    private readonly steps: Step[],
  ) {}

  /** The quest for a level, or undefined when it has no way out. */
  static forLevel(level: Level, exitName: string): Quest | undefined {
    const exits: number[] = [];
    level.cells.forEach((c, i) => {
      if (c.kind === 'wall' && c.exit) exits.push(i);
    });
    if (!exits.length) return undefined;
    const gate = exitName === 'Shift Gate';
    const steps: Step[] = [];

    const shutIn = lockedDoorsRound(level, exits);
    if (shutIn) {
      const { doors, region } = shutIn;
      const start = level.start;
      const nearest = doors.reduce((a, b) => {
        const da = Math.hypot(centre(level, a).x - start.x, centre(level, a).y - start.y);
        const db = Math.hypot(centre(level, b).x - start.x, centre(level, b).y - start.y);
        return db < da ? b : a;
      });
      const keyFor = level.locks.get(nearest);
      steps.push({
        text: doors.some((i) => level.cells[i].seeThrough) ? 'Get out of your cell' : 'Get past the locked door',
        done: (d) => doors.some((i) => (d.doors.get(i)?.target ?? 0) === 1 || !d.locked(i)),
        marker: (d) => {
          // The key first, while it lies within reach and the player lacks it.
          const key = d.items.find(
            (it) => it.kind === 'key' && !it.taken && it.key === keyFor && region.has(Math.floor(it.y) * level.width + Math.floor(it.x)),
          );
          return key && !d.stats.keys.has(keyFor ?? -1) ? { x: key.x, y: key.y } : centre(level, nearest);
        },
      });
    }
    const seenExit = (d: Dungeon) => exits.find((i) => d.explored.has(i));
    steps.push({
      text: gate ? 'Find the Shift Gate' : 'Find the way out',
      done: (d) => seenExit(d) !== undefined,
    });
    steps.push({
      text: gate ? 'Step through the Shift Gate' : 'Leave the dungeon',
      done: (d) => d.outcome === 'escaped',
      marker: (d) => {
        const exit = seenExit(d);
        return exit === undefined ? undefined : centre(level, exit);
      },
    });
    return new Quest(gate ? 'The Shift Gate' : 'The Way Out', steps);
  }

  /** The objective being worked on, with its marker; undefined once all are done. */
  get current(): Objective | undefined {
    const last = this.objectives[this.objectives.length - 1];
    return last && !last.done ? last : undefined;
  }

  /** Starts the quest, ticks off finished objectives and gives the next, adding what happened to `events`. */
  update(d: Dungeon, events: DungeonEvent[]): void {
    if (!this.started) {
      this.started = true;
      events.push({ type: 'questStarted', name: this.name });
      this.next(d, events);
    }
    let current = this.current;
    while (current) {
      const step = this.steps[this.objectives.length - 1];
      if (!step.done(d)) {
        current.marker = step.marker?.(d);
        return;
      }
      current.done = true;
      current.marker = undefined;
      events.push({ type: 'objective', text: current.text, done: true });
      this.next(d, events);
      current = this.current;
    }
  }

  private next(d: Dungeon, events: DungeonEvent[]): void {
    const step = this.steps[this.objectives.length];
    if (!step) return;
    this.objectives.push({ text: step.text, done: false, marker: step.marker?.(d) });
    events.push({ type: 'objective', text: step.text, done: false });
  }
}

/**
 * When locked doors shut the player in, away from every way out: those
 * doors and the cells the player can reach. Undefined when the way out can
 * be reached without unlocking anything.
 */
function lockedDoorsRound(level: Level, exits: number[]): { doors: number[]; region: Set<number> } | undefined {
  const { width, depth, cells, locks } = level;
  const startCell = Math.floor(level.start.y) * width + Math.floor(level.start.x);
  const region = new Set([startCell]);
  const doors = new Set<number>();
  const queue = [startCell];
  const exitSet = new Set(exits);
  let reachesExit = false;
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % width;
    const y = Math.floor(i / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
      const n = ny * width + nx;
      if (exitSet.has(n)) reachesExit = true;
      if (region.has(n)) continue;
      const c = cells[n];
      if (c.kind === 'door' && locks.has(n)) {
        doors.add(n);
        continue;
      }
      if (c.kind !== 'empty' && c.kind !== 'raised' && c.kind !== 'door') continue;
      region.add(n);
      queue.push(n);
    }
  }
  return reachesExit || !doors.size ? undefined : { doors: [...doors], region };
}
