/** Folds a worker telemetry snapshot into the WorldState: updates the node and its owning frame. */

import type { TelemetryMsg, WorkerNode, WorldState } from '@demo/shared';

import { upsertNode } from './upsertNode.js';

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
