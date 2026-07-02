/** Shared constants for the render-farm demo: queue name, stages, channels, event levels. */

export const COMMAND_TYPES = ['pause', 'resume', 'inject', 'killNode', 'reset'] as const;

export const EVENT_LEVELS = ['info', 'success', 'warn', 'danger'] as const;

export const QUEUE_NAME = 'render-frames';

export const STAGES = ['QUEUED', 'RENDERING', 'COMPOSITING', 'DONE'] as const;

export const TELEMETRY_CHANNEL = 'worker:telemetry';
