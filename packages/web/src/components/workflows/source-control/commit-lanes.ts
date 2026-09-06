export interface LaneCommitInput {
  oid: string;
  parents: readonly string[];
}

export interface LaneRow {
  oid: string;
  lane: number;
  incomingLanes: number[];
  throughLanes: number[];
  parentLanes: number[];
  isMerge: boolean;
}

export interface LaneGraph {
  rows: LaneRow[];
  laneCount: number;
}

export function assignCommitLanes(commits: readonly LaneCommitInput[]): LaneGraph {
  const active: (string | null)[] = [];
  const rows: LaneRow[] = [];
  let laneCount = 0;

  for (const commit of commits) {
    const incomingLanes: number[] = [];
    const throughLanes: number[] = [];
    for (let index = 0; index < active.length; index += 1) {
      const reservation = active[index];
      if (reservation === commit.oid) incomingLanes.push(index);
      else if (reservation !== null && reservation !== undefined) throughLanes.push(index);
    }

    let lane: number;
    if (incomingLanes.length === 0) {
      const free = active.findIndex(value => value === null);
      lane = free === -1 ? active.length : free;
      if (lane === active.length) active.push(null);
    } else {
      lane = incomingLanes[0] ?? 0;
    }

    for (const incomingLane of incomingLanes) active[incomingLane] = null;

    const parentLanes: number[] = [];
    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parent = commit.parents[parentIndex];
      if (!parent) continue;

      let parentLane = active.findIndex(value => value === parent);
      if (parentLane === -1 && parentIndex === 0 && active[lane] === null) {
        parentLane = lane;
      }
      if (parentLane === -1) {
        parentLane = active.findIndex(value => value === null);
      }
      if (parentLane === -1) {
        parentLane = active.length;
        active.push(null);
      }
      active[parentLane] = parent;
      parentLanes.push(parentLane);
    }

    rows.push({
      oid: commit.oid,
      lane,
      incomingLanes,
      throughLanes,
      parentLanes,
      isMerge: commit.parents.length > 1,
    });
    laneCount = Math.max(laneCount, active.length, lane + 1);
  }

  return { rows, laneCount };
}
