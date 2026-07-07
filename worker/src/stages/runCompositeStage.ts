/** Composite status: the second half of a frame's simulated work. */

import type { FrameJobData } from '@demo/shared';
import type { Job } from 'bullmq';

import type { ProcessDeps } from '../types.js';

import { simulateStageWork } from './simulateStageWork.js';

export function runCompositeStage(job: Job<FrameJobData>, deps: ProcessDeps): Promise<void> {
    return simulateStageWork(job, 'COMPOSITING', 'compositing', deps);
}
