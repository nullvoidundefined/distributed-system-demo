/** Marks a node as crashed (red in the UI) without removing it, so the crash stays visible briefly. */

import type { WorldState } from '@demo/shared';

export function applyNodeCrashed(state: WorldState, nodeId: string): WorldState {
    const nodes = state.nodes.map((node) =>
        node.id === nodeId ? { ...node, frameId: null, pct: 0, state: 'crashed' as const } : node,
    );
    return { ...state, nodes };
}
