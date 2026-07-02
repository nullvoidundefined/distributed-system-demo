/** Types for the world-state layer: the in-memory store handle and queue-event input shape. */

import type { WorldState } from '@demo/shared';

export interface QueueEventInput {
    frameId: string;
    kind: 'added' | 'active' | 'completed' | 'stalled' | 'failed';
    priority?: boolean;
}

export interface WorldStore {
    get: () => WorldState;
    update: (fn: (state: WorldState) => WorldState) => void;
}
