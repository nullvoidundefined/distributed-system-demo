/** Worker child-process entry: binds a BullMQ Worker to the render queue and reports telemetry. */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, TELEMETRY_CHANNEL, type FrameJobData, type TelemetryMsg } from '@demo/shared';
import {
    DEFAULT_LOCK_DURATION_MS,
    DEFAULT_MAX_STALLED_COUNT,
    DEFAULT_STAGE_MS,
    DEFAULT_STALLED_INTERVAL_MS,
} from './constants.js';
import { processFrame } from './stages/processFrame.js';

const nodeId = process.env.NODE_ID ?? `node-${process.pid}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const stageMs = Number(process.env.STAGE_MS ?? DEFAULT_STAGE_MS);

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publisher = new Redis(redisUrl);

let completed = 0;

function publishIdle(): void {
    const msg: TelemetryMsg = {
        completed,
        frameId: null,
        nodeId,
        pct: 0,
        pid: process.pid,
        priority: false,
        stage: null,
        state: 'idle',
    };
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}

const worker = new Worker<FrameJobData>(
    QUEUE_NAME,
    async (job) => {
        await processFrame(job, {
            getCompleted: () => completed,
            nodeId,
            pid: process.pid,
            publisher,
            stageMs,
        });
    },
    {
        connection,
        concurrency: 1,
        lockDuration: Number(process.env.LOCK_DURATION_MS ?? DEFAULT_LOCK_DURATION_MS),
        stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? DEFAULT_STALLED_INTERVAL_MS),
        maxStalledCount: Number(process.env.MAX_STALLED_COUNT ?? DEFAULT_MAX_STALLED_COUNT),
    },
);

worker.on('completed', () => {
    completed += 1;
    publishIdle();
});

worker.on('ready', publishIdle);

process.on('SIGTERM', () => {
    worker
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
});
