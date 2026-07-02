/** Subscribes to the orchestrator WebSocket and returns the latest WorldState snapshot. */
import { useEffect, useState } from 'react';
const WS_URL = 'ws://localhost:3001';
const EMPTY = {
    cycle: 0,
    events: [],
    frames: [],
    nodes: [],
    phase: 'seeding',
    totals: { done: 0, total: 0 },
};
export function useWorldState() {
    const [state, setState] = useState(EMPTY);
    useEffect(() => {
        const socket = new WebSocket(WS_URL);
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'snapshot')
                setState(msg.state);
        };
        return () => socket.close();
    }, []);
    return state;
}
