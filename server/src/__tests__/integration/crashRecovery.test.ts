import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let queue: Queue;
let events: QueueEvents;
let conn: Redis;
let subscriber: Redis;
const children: ChildProcess[] = [];

function spawnWorker(nodeId: string): ChildProcess {
    const child = fork(WORKER_ENTRY, [], {
        execArgv: ['--import', 'tsx'],
        env: {
            ...process.env,
            NODE_ID: nodeId,
            REDIS_URL: url,
            STAGE_MS: '1200',
            LOCK_DURATION_MS: '4000',
            STALLED_INTERVAL_MS: '2000',
        },
    });
    children.push(child);
    return child;
}

beforeEach(async () => {
    conn = new Redis(url, { maxRetriesPerRequest: null });
    await conn.flushall();
    queue = new Queue(QUEUE_NAME, { connection: conn });
    events = new QueueEvents(QUEUE_NAME, {
        connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
    await events.waitUntilReady();
    subscriber = new Redis(url);
    await subscriber.subscribe(TELEMETRY_CHANNEL);
});

afterEach(async () => {
    for (const child of children) child.kill('SIGKILL');
    children.length = 0;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.close();
    await queue.close();
    await subscriber.quit();
    await conn.quit();
});

test('a frame orphaned when a worker is SIGKILLed mid-job is re-queued and completed by another worker', async () => {
    const ownerByFrame = new Map<string, string>();
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        if (msg.frameId) ownerByFrame.set(msg.frameId, msg.nodeId);
    });
    const stalledFrameIds: string[] = [];
    events.on('stalled', ({ jobId }) => stalledFrameIds.push(jobId));

    const doomed = spawnWorker('node-doomed'); // healthy worker, killed externally below
    await new Promise((resolve) => setTimeout(resolve, 600));
    await queue.add(
        'frame',
        { frameId: 'f1', cycle: 0, priority: false },
        { jobId: 'f1', attempts: 20 },
    );

    // let the worker pick up the frame and begin processing, then hard-kill it mid-job
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(ownerByFrame.get('f1')).toBe('node-doomed'); // mid-job precondition, not just a sleep
    doomed.kill('SIGKILL');
    spawnWorker('node-healthy');

    const completedId = await new Promise<string>((resolve) => {
        events.on('completed', ({ jobId }) => resolve(jobId));
    });
    expect(completedId).toBe('f1');
    expect(stalledFrameIds).toContain('f1'); // orphaned frame was re-queued via stalled detection
    expect(ownerByFrame.get('f1')).toBe('node-healthy'); // completed by the surviving worker
}, 25000);
