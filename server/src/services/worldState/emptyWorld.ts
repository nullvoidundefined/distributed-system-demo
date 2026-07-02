/** Builds the empty starting WorldState for a cycle: no frames, nodes, or events. */

import type { WorldState } from '@demo/shared';

export function emptyWorld(cycle: number): WorldState {
    return {
        cycle,
        events: [],
        frames: [],
        nodes: [],
        phase: 'seeding',
        totals: { done: 0, total: 0 },
    };
}
