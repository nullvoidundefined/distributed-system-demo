/** Runs a single frame through RENDERING then COMPOSITING, emitting progress after each tick. */

import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { NodeState, Stage, TelemetryMsg } from '@demo/shared';
import { publishTelemetry } from '../telemetry/publishTelemetry.js';

const STEPS = 5;

export interface ProcessDeps {
    nodeId: string;
    pid: number;
    publisher: Redis;
    stageMs: number;
    getCompleted: () => number;
    crashRoll: () => boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage(
    job: Job,
    stage: Stage,
    state: NodeState,
    deps: ProcessDeps,
): Promise<void> {
    const stepMs = deps.stageMs / STEPS;
    for (let step = 1; step <= STEPS; step += 1) {
        if (deps.crashRoll()) {
            process.exit(137); // simulate a hard crash mid-stage (real SIGKILL-like death)
        }
        await sleep(stepMs);
        const pct = Math.round((step / STEPS) * 100);
        const msg: TelemetryMsg = {
            completed: deps.getCompleted(),
            frameId: String(job.data.frameId),
            nodeId: deps.nodeId,
            pct,
            pid: deps.pid,
            priority: Boolean(job.data.priority),
            stage,
            state,
        };
        await job.updateProgress({ stage, pct, nodeId: deps.nodeId });
        publishTelemetry(deps.publisher, msg);
    }
}

export async function processFrame(job: Job, deps: ProcessDeps): Promise<void> {
    await runStage(job, 'RENDERING', 'rendering', deps);
    await runStage(job, 'COMPOSITING', 'compositing', deps);
}
