/** Adds a placeholder node in the 'spawning' state so a newly forked worker appears immediately. */

import type { WorkerNode, WorldState } from '@demo/shared';

import { upsertNode } from './upsertNode.js';

export function applyNodeSpawning(state: WorldState, nodeId: string, pid: number): WorldState {
    const node: WorkerNode = {
        completed: 0,
        frameId: null,
        id: nodeId,
        pct: 0,
        pid,
        state: 'spawning',
    };
    return { ...state, nodes: upsertNode(state.nodes, node) };
}
