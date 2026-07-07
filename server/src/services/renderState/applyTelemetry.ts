/** Folds a worker telemetry snapshot into the RenderState: updates the node and its owning frame. */

import type { TelemetryMsg, WorkerNode, RenderState } from '@demo/shared';

import { upsertNode } from './upsertNode.js';

export function applyTelemetry(state: RenderState, msg: TelemetryMsg): RenderState {
    const node: WorkerNode = {
        completed: msg.completed,
        frameId: msg.frameId,
        id: msg.nodeId,
        pct: msg.pct,
        pid: msg.pid,
        state: msg.state,
    };
    const nodes = upsertNode(state.nodes, node);
    // DONE is terminal (set by the authoritative completed/failed lifecycle event).
    // Telemetry is best-effort and unordered relative to lifecycle, so a frame's final
    // progress message can arrive after its completion; it must never drag a DONE frame
    // back into an in-flight stage.
    const frames = state.frames.map((frame) =>
        frame.id === msg.frameId && msg.stage && frame.stage !== 'DONE'
            ? {
                  ...frame,
                  nodeId: msg.nodeId,
                  pct: msg.pct,
                  priority: msg.priority,
                  stage: msg.stage,
              }
            : frame,
    );
    return { ...state, frames, nodes };
}
