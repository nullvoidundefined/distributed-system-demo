/** Types for the render-state layer: the in-memory store handle and queue-event input shape. */

import type { RenderState } from '@demo/shared';

export interface QueueEventInput {
    frameId: string;
    kind: 'added' | 'completed' | 'stalled' | 'failed';
    priority?: boolean;
}

export interface RenderStore {
    get: () => RenderState;
    update: (fn: (state: RenderState) => RenderState) => void;
}
