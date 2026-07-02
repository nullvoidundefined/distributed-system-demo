/** Marks a node as crashed (red in the UI) without removing it, so the crash stays visible briefly. */

import type { WorldState } from '@demo/shared';

export function applyNodeCrashed(state: WorldState, nodeId: string): WorldState {
    const nodes = state.nodes.map((node) =>
        node.id === nodeId ? { ...node, state: 'crashed' as const, frameId: null, pct: 0 } : node,
    );
    return { ...state, nodes };
}
