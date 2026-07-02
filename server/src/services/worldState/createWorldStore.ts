/** In-memory holder for the current WorldState with an update helper. */

import type { WorldState } from '@demo/shared';
import { emptyWorld } from './reduceWorldState.js';

export interface WorldStore {
    get: () => WorldState;
    update: (fn: (state: WorldState) => WorldState) => void;
    reset: (cycle: number) => void;
}

export function createWorldStore(): WorldStore {
    let state = emptyWorld(1);
    return {
        get: () => state,
        update: (fn) => {
            state = fn(state);
        },
        reset: (cycle) => {
            state = emptyWorld(cycle);
        },
    };
}
