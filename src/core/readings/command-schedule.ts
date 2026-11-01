// A command `kit verify` has yet to start: how much of the capacity it takes, the group whose own capacity it
// also counts against, if any, and the checks that must have passed before it starts.
export interface Waiting {
  readonly weight: number;
  readonly group?: number;
  readonly needs: readonly string[];
}

// What is running and what has ended: the capacity, how much of it the running commands take, how many commands
// of each group run, each group's own capacity, and the checks that passed, or were reused, and those that failed.
export interface Room {
  readonly capacity: number;
  readonly used: number;
  readonly running: ReadonlyMap<number, number>;
  readonly groups: ReadonlyMap<number, number>;
  readonly passed: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
}

// How much of the capacity a chunk takes, which runs its tests over several processes: half, so two run at once
// and one starts while another finishes, or all of a capacity of one.
export const chunkWeight = (capacity: number): number => (capacity <= 1 ? capacity : capacity / 2);

// The waiting commands to start now, in order: each whose needs have all passed and that fits both the capacity
// left, beside the ones started before it, and its group's. A command one of whose needs failed is blocked: it
// never starts, and is answered apart so it can be failed.
export function schedule<T extends Waiting>(waiting: readonly T[], room: Room): { readonly start: readonly T[]; readonly blocked: readonly T[] } {
  let used = room.used;
  const running = new Map(room.running);
  const start: T[] = [];
  const blocked: T[] = [];
  for (const command of waiting) {
    if (command.needs.some((need) => room.failed.has(need))) {
      blocked.push(command);
      continue;
    }
    if (!command.needs.every((need) => room.passed.has(need))) continue;
    if (used + command.weight > room.capacity) continue;
    const group = command.group;
    const limit = group === undefined ? undefined : room.groups.get(group);
    const busy = group === undefined ? 0 : (running.get(group) ?? 0);
    if (limit !== undefined && busy >= limit) continue;
    used += command.weight;
    if (group !== undefined) running.set(group, busy + 1);
    start.push(command);
  }
  return { start, blocked };
}
