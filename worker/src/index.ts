/** Worker child-process entry: binds a BullMQ Worker to the render queue and reports telemetry. */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import { processFrame } from './stages/processFrame.js';

const nodeId = process.env.NODE_ID ?? `node-${process.pid}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const stageMs = Number(process.env.STAGE_MS ?? 2500);
const crashProbability = Number(process.env.CRASH_PROB ?? 0);

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publisher = new Redis(redisUrl);

let completed = 0;

function publishIdle(): void {
    const msg: TelemetryMsg = {
        nodeId,
        pid: process.pid,
        state: 'idle',
        frameId: null,
        stage: null,
        pct: 0,
        completed,
        priority: false,
    };
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}

const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        await processFrame(job, {
            nodeId,
            pid: process.pid,
            publisher,
            stageMs,
            getCompleted: () => completed,
            crashRoll: () => Math.random() < crashProbability,
        });
    },
    {
        connection,
        concurrency: 1,
        lockDuration: Number(process.env.LOCK_DURATION_MS ?? 5000),
        stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? 3000),
        maxStalledCount: Number(process.env.MAX_STALLED_COUNT ?? 10),
    },
);

worker.on('completed', () => {
    completed += 1;
    publishIdle();
});

worker.on('ready', publishIdle);

process.on('SIGTERM', () => {
    void worker.close().then(() => process.exit(0));
});
