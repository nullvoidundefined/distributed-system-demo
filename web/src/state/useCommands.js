/** Opens a command WebSocket to the orchestrator and returns a send function for Commands. */
import { useEffect, useRef } from 'react';
const WS_URL = 'ws://localhost:3001';
export function useCommands() {
    const socketRef = useRef(null);
    useEffect(() => {
        const socket = new WebSocket(WS_URL);
        socketRef.current = socket;
        return () => socket.close();
    }, []);
    return (cmd) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify(cmd));
    };
}
