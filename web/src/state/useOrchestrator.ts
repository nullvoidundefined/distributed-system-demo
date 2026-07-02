/** Single WebSocket to the orchestrator: exposes the latest WorldState, connection status, and a sender. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, WorldState } from '@demo/shared';
import { WS_URL } from '../config/websocket.js';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface Orchestrator {
    send: (cmd: Command) => void;
    status: ConnectionStatus;
    world: WorldState;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

const EMPTY: WorldState = {
    cycle: 0,
    events: [],
    frames: [],
    nodes: [],
    phase: 'seeding',
    totals: { done: 0, total: 0 },
};

export function useOrchestrator(): Orchestrator {
    const [world, setWorld] = useState<WorldState>(EMPTY);
    const [status, setStatus] = useState<ConnectionStatus>('connecting');
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        let unmounted = false;
        let reconnectDelay = RECONNECT_BASE_MS;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        function connect(): void {
            setStatus('connecting');
            const socket = new WebSocket(WS_URL);
            socketRef.current = socket;
            socket.onopen = () => {
                reconnectDelay = RECONNECT_BASE_MS;
                setStatus('open');
            };
            socket.onmessage = (event) => {
                const msg = JSON.parse(event.data) as { type: string; state: WorldState };
                if (msg.type === 'snapshot') setWorld(msg.state);
            };
            socket.onclose = () => {
                setStatus('closed');
                if (unmounted) return;
                reconnectTimer = setTimeout(connect, reconnectDelay);
                reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
            };
            socket.onerror = () => socket.close();
        }

        connect();
        return () => {
            unmounted = true;
            clearTimeout(reconnectTimer);
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, []);

    const send = useCallback((cmd: Command) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
    }, []);

    return { send, status, world };
}
