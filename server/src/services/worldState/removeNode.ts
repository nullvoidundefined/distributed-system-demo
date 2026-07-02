/** Removes a node from the WorldState, after a graceful exit or once a crash has been shown. */

import type { WorldState } from '@demo/shared';

export function removeNode(state: WorldState, nodeId: string): WorldState {
    return { ...state, nodes: state.nodes.filter((node) => node.id !== nodeId) };
}
