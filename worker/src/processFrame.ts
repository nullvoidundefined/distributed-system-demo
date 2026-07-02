/** Runs a single frame through the render then composite stages. */

import type { FrameJobData } from '@demo/shared';
import type { Job } from 'bullmq';

import { runCompositeStage } from './stages/runCompositeStage.js';
import { runRenderStage } from './stages/runRenderStage.js';
import type { ProcessDeps } from './types.js';

export async function processFrame(job: Job<FrameJobData>, deps: ProcessDeps): Promise<void> {
    await runRenderStage(job, deps);
    await runCompositeStage(job, deps);
}
