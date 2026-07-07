/** Orchestrator bootstrap: Redis, queue, queue-events wiring, node pool, director, and WebSocket server. */

import { createServer } from 'node:http';

import type { Command } from '@demo/shared';
import express from 'express';
import { WebSocketServer } from 'ws';

import { createRedisConnection } from './clients/redis/createRedisConnection.js';
import { TUNABLES } from './config/tunables.js';
import { createQueueEvents } from './queue/createQueueEvents.js';
import { createRenderQueue } from './queue/createRenderQueue.js';
import { runDirector } from './services/director/runDirector.js';
import { createNodePool } from './services/nodePool/createNodePool.js';
import { subscribeTelemetry } from './services/telemetry/subscribeTelemetry.js';
import { appendEvent } from './services/renderState/appendEvent.js';
import { applyNodeCrashed } from './services/renderState/applyNodeCrashed.js';
import { applyNodeSpawning } from './services/renderState/applyNodeSpawning.js';
import { applyQueueEvent } from './services/renderState/applyQueueEvent.js';
import { createRenderStore } from './services/renderState/createRenderStore.js';
import { removeNode } from './services/renderState/removeNode.js';
import { createBroadcaster } from './websocket/createBroadcaster.js';
import { handleCommand } from './websocket/handleCommand.js';

const CRASHED_NODE_LINGER_MS = 1500;

const store = createRenderStore();
const redisForQueue = createRedisConnection();
const redisForEvents = createRedisConnection();
const redisForTelemetry = createRedisConnection();
const queue = createRenderQueue(redisForQueue);
const queueEvents = createQueueEvents(redisForEvents);
subscribeTelemetry(redisForTelemetry, store);

const pool = createNodePool({
    onExit: (nodeId, crashed) => {
        if (!crashed) {
            store.update((s) => removeNode(s, nodeId));
            return;
        }
        store.update((s) =>
            appendEvent(applyNodeCrashed(s, nodeId), 'warn', `${nodeId} process exited`),
        );
        setTimeout(() => store.update((s) => removeNode(s, nodeId)), CRASHED_NODE_LINGER_MS);
    },
});
for (let i = 0; i < TUNABLES.minNodes; i += 1) {
    const { id, pid } = pool.spawn();
    store.update((s) => applyNodeSpawning(s, id, pid));
}

const director = runDirector(queue, pool, store);

queueEvents.on('added', ({ jobId }) => {
    store.update((s) =>
        applyQueueEvent(s, { frameId: jobId, kind: 'added', priority: director.priorityOf(jobId) }),
    );
});
queueEvents.on('completed', ({ jobId }) => {
    store.update((s) =>
        appendEvent(
            applyQueueEvent(s, { frameId: jobId, kind: 'completed' }),
            'success',
            `frame ${jobId} done`,
        ),
    );
});
queueEvents.on('stalled', ({ jobId }) => {
    store.update((s) =>
        appendEvent(
            applyQueueEvent(s, { frameId: jobId, kind: 'stalled' }),
            'warn',
            `frame ${jobId} stalled; re-queued`,
        ),
    );
});
queueEvents.on('failed', ({ jobId, failedReason }) => {
    store.update((s) =>
        appendEvent(
            applyQueueEvent(s, { frameId: jobId, kind: 'failed' }),
            'danger',
            `frame ${jobId} failed permanently: ${failedReason ?? 'unknown'}`,
        ),
    );
});

const app = express();
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

createBroadcaster(wss, store, TUNABLES.broadcastHz);

wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
        let cmd: Command;
        try {
            cmd = JSON.parse(raw.toString()) as Command;
        } catch {
            return; // ignore malformed client input rather than crashing the orchestrator
        }
        handleCommand(cmd, {
            inject: (count) => void director.seed(count),
            killNode: () => director.killNodeNow(),
            pause: () => void director.dispatch({ type: 'pause' }),
            reset: () => void director.dispatch({ type: 'reset' }),
            resume: () => void director.dispatch({ type: 'resume' }),
        });
    });
});

async function shutdown(): Promise<void> {
    director.stop();
    pool.shutdown();
    await Promise.allSettled([
        queue.close(),
        queueEvents.close(),
        redisForQueue.quit(),
        redisForEvents.quit(),
        redisForTelemetry.quit(),
    ]);
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

httpServer.listen(TUNABLES.httpPort, () => {
    process.stdout.write(`orchestrator on :${TUNABLES.httpPort}\n`);
});
