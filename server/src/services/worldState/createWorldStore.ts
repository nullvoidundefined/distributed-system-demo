/** In-memory holder for the current WorldState with an update helper. */

import type { WorldState } from '@demo/shared';

import { emptyWorld } from './emptyWorld.js';

export interface WorldStore {
    get: () => WorldState;
    update: (fn: (state: WorldState) => WorldState) => void;
}

export function createWorldStore(): WorldStore {
    let state = emptyWorld(1);
    return {
        get: () => state,
        update: (fn) => {
            state = fn(state);
        },
    };
}
