/** Removes a node from the RenderState, after a graceful exit or once a crash has been shown. */

import type { RenderState } from '@demo/shared';

export function removeNode(state: RenderState, nodeId: string): RenderState {
    return { ...state, nodes: state.nodes.filter((node) => node.id !== nodeId) };
}
