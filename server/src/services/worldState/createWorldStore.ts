/** In-memory holder for the current WorldState with an update helper. */

import { emptyWorld } from './emptyWorld.js';
import type { WorldStore } from './types.js';

export function createWorldStore(): WorldStore {
    let state = emptyWorld(1);
    return {
        get: () => state,
        update: (fn) => {
            state = fn(state);
        },
    };
}
