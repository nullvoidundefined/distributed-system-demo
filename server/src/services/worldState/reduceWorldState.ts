/** Pure world-state reducers: merge queue-lifecycle events and worker telemetry into one snapshot. */

import type { EventLevel, Frame, TelemetryMsg, WorkerNode, WorldState } from '@demo/shared';

const MAX_EVENTS = 200;

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

export function appendEvent(state: WorldState, level: EventLevel, message: string): WorldState {
    const nextId = (state.events.at(-1)?.id ?? 0) + 1;
    const events = [...state.events, { id: nextId, ts: Date.now(), level, message }];
    return { ...state, events: events.slice(-MAX_EVENTS) };
}

function upsertNode(nodes: WorkerNode[], patch: WorkerNode): WorkerNode[] {
    const exists = nodes.some((node) => node.id === patch.id);
    return exists ? nodes.map((node) => (node.id === patch.id ? patch : node)) : [...nodes, patch];
}

export function applyTelemetry(state: WorldState, msg: TelemetryMsg): WorldState {
    const node: WorkerNode = {
        completed: msg.completed,
        frameId: msg.frameId,
        id: msg.nodeId,
        pct: msg.pct,
        pid: msg.pid,
        state: msg.state,
    };
    const nodes = upsertNode(state.nodes, node);
    const frames = state.frames.map((frame) =>
        frame.id === msg.frameId && msg.stage
            ? {
                  ...frame,
                  stage: msg.stage,
                  nodeId: msg.nodeId,
                  pct: msg.pct,
                  priority: msg.priority,
              }
            : frame,
    );
    return { ...state, nodes, frames };
}

export function applyQueueEvent(
    state: WorldState,
    evt: {
        kind: 'added' | 'active' | 'completed' | 'stalled';
        frameId: string;
        priority?: boolean;
    },
): WorldState {
    if (evt.kind === 'added') {
        const frame: Frame = {
            cycle: state.cycle,
            id: evt.frameId,
            nodeId: null,
            pct: 0,
            priority: evt.priority ?? false,
            stage: 'QUEUED',
        };
        return {
            ...state,
            frames: [...state.frames, frame],
            totals: { ...state.totals, total: state.totals.total + 1 },
        };
    }
    if (evt.kind === 'completed') {
        const frames = state.frames.map((frame) =>
            frame.id === evt.frameId ? { ...frame, stage: 'DONE' as const, pct: 100 } : frame,
        );
        return { ...state, frames, totals: { ...state.totals, done: state.totals.done + 1 } };
    }
    if (evt.kind === 'stalled') {
        const frames = state.frames.map((frame) =>
            frame.id === evt.frameId
                ? { ...frame, stage: 'QUEUED' as const, nodeId: null, pct: 0 }
                : frame,
        );
        return { ...state, frames };
    }
    return state;
}
