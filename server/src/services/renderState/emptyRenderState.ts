/** Builds the empty starting RenderState for a cycle: no frames, nodes, or events. */

import type { RenderState } from '@demo/shared';

export function emptyRenderState(cycle: number): RenderState {
    return {
        cycle,
        events: [],
        frames: [],
        nodes: [],
        status: 'seeding',
        totals: { done: 0, total: 0 },
    };
}
