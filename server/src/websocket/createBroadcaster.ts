/** Broadcasts throttled WorldState snapshots to all connected WebSocket clients. */

import type { WebSocketServer } from 'ws';
import type { WorldStore } from '../services/worldState/createWorldStore.js';

export function createBroadcaster(wss: WebSocketServer, store: WorldStore, hz: number): () => void {
    wss.on('connection', (socket) => {
        socket.send(JSON.stringify({ type: 'snapshot', state: store.get() }));
    });
    const timer = setInterval(
        () => {
            const payload = JSON.stringify({ type: 'snapshot', state: store.get() });
            for (const client of wss.clients) {
                if (client.readyState === client.OPEN) client.send(payload);
            }
        },
        Math.round(1000 / hz),
    );
    return () => clearInterval(timer);
}
