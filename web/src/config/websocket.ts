/** WebSocket endpoint for the single orchestrator connection; VITE_WS_URL overrides the default. */

export const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';
