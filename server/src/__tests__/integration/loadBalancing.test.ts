import { type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, type TelemetryMsg } from '@demo/shared';

import { spawnTestWorker } from './spawnTestWorker.js';
import { TEST_REDIS_URL, TEST_TELEMETRY_CHANNEL } from './testRedis.js';

const url = TEST_REDIS_URL;
const FRAME_COUNT = 6;

let queue: Queue;
let events: QueueEvents;
let conn: Redis;
let subscriber: Redis;
const children: ChildProcess[] = [];

beforeEach(async () => {
    conn = new Redis(url, { maxRetriesPerRequest: null });
    await conn.flushdb();
    queue = new Queue(QUEUE_NAME, { connection: conn });
    events = new QueueEvents(QUEUE_NAME, {
        connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
    await events.waitUntilReady();
    subscriber = new Redis(url);
    await subscriber.subscribe(TEST_TELEMETRY_CHANNEL);
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

test('frames spread across free workers instead of serializing on one', async () => {
    const ownerByFrame = new Map<string, string>();
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        if (msg.frameId) ownerByFrame.set(msg.frameId, msg.nodeId);
    });

    let completedCount = 0;
    const allFramesCompleted = new Promise<void>((resolve) => {
        events.on('completed', () => {
            completedCount += 1;
            if (completedCount === FRAME_COUNT) resolve();
        });
    });

    children.push(spawnTestWorker('node-a', { REDIS_URL: url, STAGE_MS: '200' }));
    children.push(spawnTestWorker('node-b', { REDIS_URL: url, STAGE_MS: '200' }));
    for (let i = 1; i <= FRAME_COUNT; i += 1) {
        await queue.add(
            'frame',
            { frameId: `f-${i}`, cycle: 0, priority: false },
            { jobId: `f-${i}`, attempts: 20 },
        );
    }
    await allFramesCompleted;

    const owners = new Set(ownerByFrame.values());
    expect(owners).toEqual(new Set(['node-a', 'node-b']));
}, 25000);
