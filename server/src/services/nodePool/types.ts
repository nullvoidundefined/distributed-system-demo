/** Types for the worker node pool: dependencies, a spawned-node handle, and the pool interface. */

export interface NodePoolDeps {
    onExit: (nodeId: string, crashed: boolean) => void;
}

export interface SpawnedNode {
    id: string;
    pid: number;
}

export interface NodePool {
    crashRandom: (busyIds: string[]) => string | null;
    ids: () => string[];
    killIdle: (idleIds: string[]) => string | null;
    shutdown: () => void;
    size: () => number;
    spawn: () => SpawnedNode;
}
