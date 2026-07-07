/** Folds a BullMQ queue-lifecycle event into the RenderState: moves a frame between stages. */

import type { Frame, RenderState } from '@demo/shared';

interface QueueEventInput {
    frameId: string;
    kind: 'added' | 'completed' | 'stalled' | 'failed';
    priority?: boolean;
}

export function applyQueueEvent(state: RenderState, evt: QueueEventInput): RenderState {
    if (evt.kind === 'added') return addQueuedFrame(state, evt.frameId, evt.priority ?? false);
    if (evt.kind === 'completed') return markFrameDone(state, evt.frameId, false);
    if (evt.kind === 'failed') return markFrameDone(state, evt.frameId, true);
    if (evt.kind === 'stalled') return requeueFrame(state, evt.frameId);
    return state;
}

function addQueuedFrame(state: RenderState, frameId: string, priority: boolean): RenderState {
    const frame: Frame = {
        cycle: state.cycle,
        failed: false,
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

/** Both terminal outcomes land in DONE (so a cycle can always finish); failed keeps its own flag. */
function markFrameDone(state: RenderState, frameId: string, failed: boolean): RenderState {
    // DONE is terminal and each frame counts toward `done` exactly once. BullMQ delivers
    // lifecycle events at least once, so a completed/failed event can repeat (false stall,
    // retry); counting per event lets `done` overshoot `total`, driving the cycle's
    // `total - done` completion gauge negative so it never resets. Ignore the duplicate.
    const target = state.frames.find((frame) => frame.id === frameId);
    if (!target || target.stage === 'DONE') return state;
    const frames = state.frames.map((frame) =>
        frame.id === frameId ? { ...frame, failed, pct: 100, stage: 'DONE' as const } : frame,
    );
    return { ...state, frames, totals: { ...state.totals, done: state.totals.done + 1 } };
}

function requeueFrame(state: RenderState, frameId: string): RenderState {
    const frames = state.frames.map((frame) =>
        frame.id === frameId ? { ...frame, nodeId: null, pct: 0, stage: 'QUEUED' as const } : frame,
    );
    return { ...state, frames };
}
