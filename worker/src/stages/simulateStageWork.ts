/** Simulates one stage of frame work in fixed steps, publishing progress telemetry per step. */

import type { FrameJobData, NodeState, Stage, TelemetryMsg } from '@demo/shared';
import type { Job } from 'bullmq';

import { RENDER_STEPS } from '../constants.js';
import { publishTelemetry } from '../telemetry/publishTelemetry.js';
import type { ProcessDeps } from '../types.js';

export async function simulateStageWork(
    job: Job<FrameJobData>,
    stage: Stage,
    state: NodeState,
    deps: ProcessDeps,
): Promise<void> {
    const stepMs = deps.stageMs / RENDER_STEPS;
    for (let step = 1; step <= RENDER_STEPS; step += 1) {
        await sleep(stepMs);
        const pct = Math.round((step / RENDER_STEPS) * 100);
        const msg: TelemetryMsg = {
            completed: deps.getCompleted(),
            frameId: job.data.frameId,
            nodeId: deps.nodeId,
            pct,
            pid: deps.pid,
            priority: job.data.priority,
            stage,
            state,
        };
        publishTelemetry(deps.publisher, msg);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
