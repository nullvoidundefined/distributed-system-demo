import { type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

import { spawnTestWorker } from './spawnTestWorker.js';
import { TEST_REDIS_URL } from './testRedis.js';

const url = TEST_REDIS_URL;
const NORMAL_FRAME_COUNT = 4;
const TOTAL_FRAME_COUNT = NORMAL_FRAME_COUNT + 1;

let queue: Queue;
let events: QueueEvents;
let conn: Redis;
let child: ChildProcess | undefined;

beforeEach(async () => {
    conn = new Redis(url, { maxRetriesPerRequest: null });
    await conn.flushdb();
    queue = new Queue(QUEUE_NAME, { connection: conn });
    events = new QueueEvents(QUEUE_NAME, {
        connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
    await events.waitUntilReady();
});

afterEach(async () => {
    child?.kill('SIGKILL');
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.close();
    await queue.close();
    await conn.quit();
});

test('a high-priority frame enqueued last overtakes earlier normal frames', async () => {
    // mirror production enqueue: normal frames priority 5, high-priority frames priority 1
    for (let i = 1; i <= NORMAL_FRAME_COUNT; i += 1) {
        await queue.add(
            'frame',
            { frameId: `f-normal-${i}`, cycle: 0, priority: false },
            { jobId: `f-normal-${i}`, attempts: 20, priority: 5 },
        );
    }
    await queue.add(
        'frame',
        { frameId: 'f-high', cycle: 0, priority: true },
        { jobId: 'f-high', attempts: 20, priority: 1 },
    );

    const completedOrder: string[] = [];
    const allFramesCompleted = new Promise<void>((resolve) => {
        events.on('completed', ({ jobId }) => {
            completedOrder.push(jobId);
            if (completedOrder.length === TOTAL_FRAME_COUNT) resolve();
        });
    });

    child = spawnTestWorker('node-priority', { REDIS_URL: url, STAGE_MS: '150' });
    await allFramesCompleted;

    // FIFO would finish f-high last; BullMQ priority must pull it ahead of every normal frame
    expect(completedOrder[0]).toBe('f-high');
}, 25000);
