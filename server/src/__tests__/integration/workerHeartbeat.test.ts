import { type ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Redis } from 'ioredis';
import { type TelemetryMsg } from '@demo/shared';

import { spawnTestWorker } from './spawnTestWorker.js';
import { TEST_REDIS_URL, TEST_TELEMETRY_CHANNEL } from './testRedis.js';

const url = TEST_REDIS_URL;
const HEARTBEAT_MS = 300;
const LISTEN_MS = 1500;

let subscriber: Redis;
let child: ChildProcess | undefined;

beforeEach(async () => {
    subscriber = new Redis(url);
    await subscriber.subscribe(TEST_TELEMETRY_CHANNEL);
});

afterEach(async () => {
    child?.kill('SIGKILL');
    await subscriber.quit();
});

test('an idle worker publishes heartbeat telemetry periodically', async () => {
    const idleMessages: TelemetryMsg[] = [];
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        if (msg.nodeId === 'node-heartbeat' && msg.state === 'idle') idleMessages.push(msg);
    });

    child = spawnTestWorker('node-heartbeat', {
        HEARTBEAT_INTERVAL_MS: String(HEARTBEAT_MS),
        REDIS_URL: url,
    });

    await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
    // one publish on ready plus at least two periodic heartbeats proves an interval, not events
    expect(idleMessages.length).toBeGreaterThanOrEqual(3);
}, 15000);
