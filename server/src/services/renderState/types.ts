/** Types for the render-state layer: the in-memory store handle. */

import type { RenderState } from '@demo/shared';

export interface RenderStore {
    get: () => RenderState;
    update: (fn: (state: RenderState) => RenderState) => void;
}
