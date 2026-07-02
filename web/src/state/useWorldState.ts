/** Subscribes to the orchestrator WebSocket and returns the latest WorldState snapshot. */

import { useEffect, useState } from 'react';
import type { WorldState } from '@demo/shared';

const WS_URL = 'ws://localhost:3001';

const EMPTY: WorldState = {
    cycle: 0,
    events: [],
    frames: [],
    nodes: [],
    phase: 'seeding',
    totals: { done: 0, total: 0 },
};

export function useWorldState(): WorldState {
    const [state, setState] = useState<WorldState>(EMPTY);
    useEffect(() => {
        const socket = new WebSocket(WS_URL);
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data) as { type: string; state: WorldState };
            if (msg.type === 'snapshot') setState(msg.state);
        };
        return () => socket.close();
    }, []);
    return state;
}
