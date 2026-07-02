/** Folds a BullMQ queue-lifecycle event into the WorldState: moves a frame between stages. */

import type { Frame, WorldState } from '@demo/shared';

export interface QueueEventInput {
    frameId: string;
    kind: 'added' | 'active' | 'completed' | 'stalled' | 'failed';
    priority?: boolean;
}

export function applyQueueEvent(state: WorldState, evt: QueueEventInput): WorldState {
    if (evt.kind === 'added') return addQueuedFrame(state, evt.frameId, evt.priority ?? false);
    if (evt.kind === 'completed' || evt.kind === 'failed') return markFrameDone(state, evt.frameId);
    if (evt.kind === 'stalled') return requeueFrame(state, evt.frameId);
    return state;
}

function addQueuedFrame(state: WorldState, frameId: string, priority: boolean): WorldState {
    const frame: Frame = {
        cycle: state.cycle,
        id: frameId,
        nodeId: null,
        pct: 0,
        priority,
        stage: 'QUEUED',
    };
    return {
        ...state,
        frames: [...state.frames, frame],
        totals: { ...state.totals, total: state.totals.total + 1 },
    };
}

function markFrameDone(state: WorldState, frameId: string): WorldState {
    const frames = state.frames.map((frame) =>
        frame.id === frameId ? { ...frame, stage: 'DONE' as const, pct: 100 } : frame,
    );
    return { ...state, frames, totals: { ...state.totals, done: state.totals.done + 1 } };
}

function requeueFrame(state: WorldState, frameId: string): WorldState {
    const frames = state.frames.map((frame) =>
        frame.id === frameId ? { ...frame, stage: 'QUEUED' as const, nodeId: null, pct: 0 } : frame,
    );
    return { ...state, frames };
}
