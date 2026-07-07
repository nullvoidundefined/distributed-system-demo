/** Adds a placeholder node in the 'spawning' state so a newly forked worker appears immediately. */

import type { RenderNode, RenderState } from '@demo/shared';

import { upsertNode } from './upsertNode.js';

export function applyNodeSpawning(state: RenderState, nodeId: string, pid: number): RenderState {
    const node: RenderNode = {
        completed: 0,
        frameId: null,
        id: nodeId,
        pct: 0,
        pid,
        state: 'spawning',
    };
    return { ...state, nodes: upsertNode(state.nodes, node) };
}
