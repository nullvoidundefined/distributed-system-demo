/** In-memory holder for the current RenderState with an update helper. */

import { emptyRenderState } from './emptyRenderState.js';
import type { RenderStore } from './types.js';

export function createRenderStore(): RenderStore {
    let state = emptyRenderState(1);
    return {
        get: () => state,
        update: (fn) => {
            state = fn(state);
        },
    };
}
