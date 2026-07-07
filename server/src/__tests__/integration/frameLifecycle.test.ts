import { type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

import { spawnTestWorker } from './spawnTestWorker.js';
import { TEST_REDIS_URL } from './testRedis.js';

const url = TEST_REDIS_URL;
const PROBE_POLL_MS = 100;

/**
 * QueueEvents.waitUntilReady() resolves before its stream consumer starts reading,
 * so events emitted immediately after can be silently missed. Enqueue disposable
 * probe jobs until one is observed, proving the consumer is live, then remove them.
 */
async function waitUntilEventStreamLive(queue: Queue, events: QueueEvents): Promise<void> {
    let observedProbe = false;
    events.on('added', ({ jobId }) => {
        if (jobId.startsWith('probe-')) observedProbe = true;
    });
    let probeSeq = 0;
    while (!observedProbe) {
        probeSeq += 1;
        await queue.add('probe', {}, { attempts: 1, jobId: `probe-${probeSeq}` });
        await new Promise((resolve) => setTimeout(resolve, PROBE_POLL_MS));
    }
    for (let i = 1; i <= probeSeq; i += 1) await queue.remove(`probe-${i}`);
}

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

test('an enqueued frame moves added -> active -> completed on a running worker', async () => {
    await waitUntilEventStreamLive(queue, events);
    const lifecycle: string[] = [];
    const frameCompleted = new Promise<void>((resolve) => {
        // BullMQ's event stream names the enqueued/waiting state 'added'
        events.on('added', ({ jobId }) => {
            if (jobId === 'f-life') lifecycle.push('added');
        });
        events.on('active', ({ jobId }) => {
            if (jobId === 'f-life') lifecycle.push('active');
        });
        events.on('completed', ({ jobId }) => {
            if (jobId === 'f-life') {
                lifecycle.push('completed');
                resolve();
            }
        });
    });

    child = spawnTestWorker('node-lifecycle', { REDIS_URL: url, STAGE_MS: '200' });
    await queue.add(
        'frame',
        { frameId: 'f-life', cycle: 0, priority: false },
        { jobId: 'f-life', attempts: 20 },
    );
    await frameCompleted;

    expect(lifecycle).toEqual(['added', 'active', 'completed']);
}, 20000);
