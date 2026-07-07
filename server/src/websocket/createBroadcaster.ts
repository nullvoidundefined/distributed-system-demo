/** Broadcasts throttled RenderState snapshots to all connected WebSocket clients. */

import type { WebSocketServer } from 'ws';

import type { RenderStore } from '../services/renderState/types.js';

const MS_PER_SECOND = 1000;

export function createBroadcaster(
    wss: WebSocketServer,
    store: RenderStore,
    hz: number,
): () => void {
    wss.on('connection', (socket) => {
        socket.send(JSON.stringify({ state: store.get(), type: 'snapshot' }));
    });
    const timer = setInterval(
        () => {
            const payload = JSON.stringify({ state: store.get(), type: 'snapshot' });
            for (const client of wss.clients) {
                if (client.readyState === client.OPEN) client.send(payload);
            }
        },
        Math.round(MS_PER_SECOND / hz),
    );
    return () => clearInterval(timer);
}
