import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let queue: Queue;
let events: QueueEvents;
let conn: Redis;
const children: ChildProcess[] = [];

function spawnWorker(nodeId: string, crashProb = 0): ChildProcess {
    const child = fork(WORKER_ENTRY, [], {
        execArgv: ['--import', 'tsx'],
        env: {
            ...process.env,
            NODE_ID: nodeId,
            REDIS_URL: url,
            STAGE_MS: '1200',
            LOCK_DURATION_MS: '4000',
            STALLED_INTERVAL_MS: '2000',
            CRASH_PROB: String(crashProb),
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
});

afterEach(async () => {
    for (const child of children) child.kill('SIGKILL');
    children.length = 0;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.close();
    await queue.close();
    await conn.quit();
});

test('a frame orphaned by a crashed worker is recovered and completed by another worker', async () => {
    const doomed = spawnWorker('node-doomed', 1); // crashes on first tick
    await new Promise((resolve) => setTimeout(resolve, 500));
    await queue.add(
        'frame',
        { frameId: 'f1', cycle: 0, priority: false },
        { jobId: 'f1', attempts: 20 },
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(doomed.killed || doomed.exitCode !== null).toBe(true);
    spawnWorker('node-healthy', 0);

    const completedId = await new Promise<string>((resolve) => {
        events.on('completed', ({ jobId }) => resolve(jobId));
    });
    expect(completedId).toBe('f1');
}, 25000);
