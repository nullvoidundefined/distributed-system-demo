/** Orchestrator bootstrap: Redis, queue, queue-events wiring, node pool, director, and WebSocket server. */

import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { Command } from '@demo/shared';
import { createRedisConnection } from './clients/redis/createRedisConnection.js';
import { TUNABLES } from './config/tunables.js';
import { createQueueEvents } from './queue/createQueueEvents.js';
import { createRenderQueue } from './queue/createRenderQueue.js';
import { runDirector } from './services/director/runDirector.js';
import { createNodePool } from './services/nodePool/createNodePool.js';
import { subscribeTelemetry } from './services/telemetry/subscribeTelemetry.js';
import { createWorldStore } from './services/worldState/createWorldStore.js';
import { appendEvent, applyQueueEvent } from './services/worldState/reduceWorldState.js';
import { createBroadcaster } from './websocket/createBroadcaster.js';
import { handleCommand } from './websocket/handleCommand.js';

const store = createWorldStore();
const queue = createRenderQueue(createRedisConnection());
const queueEvents = createQueueEvents(createRedisConnection());
subscribeTelemetry(createRedisConnection(), store);

const pool = createNodePool({
    onExit: (nodeId, crashed) => {
        store.update((s) => ({ ...s, nodes: s.nodes.filter((node) => node.id !== nodeId) }));
        if (crashed) store.update((s) => appendEvent(s, 'warn', `${nodeId} process exited`));
    },
});
for (let i = 0; i < TUNABLES.minNodes; i += 1) pool.spawn();

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

const app = express();
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

createBroadcaster(wss, store, TUNABLES.broadcastHz);

wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
        const cmd = JSON.parse(raw.toString()) as Command;
        handleCommand(cmd, {
            inject: (count) => void director.seed(count),
            killNode: () => director.killNodeNow(),
            pause: () => void director.dispatch({ type: 'pause' }),
            reset: () => void director.dispatch({ type: 'reset' }),
            resume: () => void director.dispatch({ type: 'resume' }),
        });
    });
});

httpServer.listen(TUNABLES.httpPort, () => {
    process.stdout.write(`orchestrator on :${TUNABLES.httpPort}\n`);
});
