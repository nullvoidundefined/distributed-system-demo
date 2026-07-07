/** Worker child-process entry: binds a BullMQ Worker to the render queue and reports telemetry. */

import { QUEUE_NAME, TELEMETRY_CHANNEL, type FrameJobData, type TelemetryMsg } from '@demo/shared';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import {
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_LOCK_DURATION_MS,
    DEFAULT_MAX_STALLED_COUNT,
    DEFAULT_STAGE_MS,
    DEFAULT_STALLED_INTERVAL_MS,
} from './constants.js';
import { processFrame } from './processFrame.js';

const heartbeatMs = Number(process.env.HEARTBEAT_INTERVAL_MS ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
const nodeId = process.env.NODE_ID ?? `node-${process.pid}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const stageMs = Number(process.env.STAGE_MS ?? DEFAULT_STAGE_MS);
const telemetryChannel = process.env.TELEMETRY_CHANNEL ?? TELEMETRY_CHANNEL;

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
    void publisher.publish(telemetryChannel, JSON.stringify(msg));
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
            telemetryChannel,
        });
    },
    {
        concurrency: 1,
        connection,
        lockDuration: Number(process.env.LOCK_DURATION_MS ?? DEFAULT_LOCK_DURATION_MS),
        maxStalledCount: Number(process.env.MAX_STALLED_COUNT ?? DEFAULT_MAX_STALLED_COUNT),
        stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? DEFAULT_STALLED_INTERVAL_MS),
    },
);

let isProcessing = false;

worker.on('active', () => {
    isProcessing = true;
});

worker.on('completed', () => {
    completed += 1;
    isProcessing = false;
    publishIdle();
});

worker.on('failed', () => {
    isProcessing = false;
    publishIdle();
});

worker.on('ready', publishIdle);

// heartbeat: an idle worker keeps announcing itself; while processing, progress ticks cover it
const heartbeatTimer = setInterval(() => {
    if (!isProcessing) publishIdle();
}, heartbeatMs);

process.on('SIGTERM', () => {
    clearInterval(heartbeatTimer);
    worker
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
});
