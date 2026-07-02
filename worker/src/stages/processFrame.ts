/** Runs a single frame through RENDERING then COMPOSITING, emitting progress after each tick. */

import type { FrameJobData, NodeState, Stage, TelemetryMsg } from '@demo/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { RENDER_STEPS } from '../constants.js';
import { publishTelemetry } from '../telemetry/publishTelemetry.js';

export interface ProcessDeps {
    getCompleted: () => number;
    nodeId: string;
    pid: number;
    publisher: Redis;
    stageMs: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage(
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
        await job.updateProgress({ stage, pct, nodeId: deps.nodeId });
        publishTelemetry(deps.publisher, msg);
    }
}

export async function processFrame(job: Job<FrameJobData>, deps: ProcessDeps): Promise<void> {
    await runStage(job, 'RENDERING', 'rendering', deps);
    await runStage(job, 'COMPOSITING', 'compositing', deps);
}
