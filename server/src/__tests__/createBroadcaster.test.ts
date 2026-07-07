import { afterEach, expect, test } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { RenderState } from '@demo/shared';

import { emptyRenderState } from '../services/renderState/emptyRenderState.js';
import type { RenderStore } from '../services/renderState/types.js';
import { createBroadcaster } from '../websocket/createBroadcaster.js';

const BROADCAST_HZ = 20;

let wss: WebSocketServer;
let client: WebSocket;
let stopBroadcasting: () => void;

function createStubStore(renderState: RenderState): RenderStore {
    return { get: () => renderState, update: () => undefined };
}

function nextMessage(socket: WebSocket): Promise<{ state: RenderState; type: string }> {
    return new Promise((resolve) => {
        socket.once('message', (raw) => resolve(JSON.parse(String(raw))));
    });
}

afterEach(() => {
    stopBroadcasting();
    client.close();
    wss.close();
});

test('a connecting client immediately receives a full snapshot, then periodic snapshots', async () => {
    const renderState = emptyRenderState(7);
    wss = new WebSocketServer({ port: 0 });
    stopBroadcasting = createBroadcaster(wss, createStubStore(renderState), BROADCAST_HZ);
    const { port } = wss.address() as { port: number };

    client = new WebSocket(`ws://127.0.0.1:${port}`);
    const connectSnapshot = await nextMessage(client);
    expect(connectSnapshot.type).toBe('snapshot');
    expect(connectSnapshot.state.cycle).toBe(7);

    const periodicSnapshot = await nextMessage(client);
    expect(periodicSnapshot.type).toBe('snapshot');
    expect(periodicSnapshot.state.cycle).toBe(7);
});
