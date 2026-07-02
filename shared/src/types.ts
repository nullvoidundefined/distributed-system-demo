/** Shared TypeScript types exchanged between orchestrator, workers, and the web client. */

import type { STAGES, EVENT_LEVELS, COMMAND_TYPES } from './constants.js';

export type Stage = (typeof STAGES)[number];
export type EventLevel = (typeof EVENT_LEVELS)[number];
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface Frame {
    id: string;
    cycle: number;
    priority: boolean;
    stage: Stage;
    nodeId: string | null;
    pct: number;
}

export type NodeState = 'idle' | 'rendering' | 'compositing' | 'spawning' | 'crashed';

export interface WorkerNode {
    id: string;
    pid: number;
    state: NodeState;
    frameId: string | null;
    pct: number;
    completed: number;
}

export interface LogEvent {
    id: number;
    ts: number;
    level: EventLevel;
    message: string;
}

export interface WorldState {
    cycle: number;
    phase: 'seeding' | 'running' | 'complete' | 'paused';
    frames: Frame[];
    nodes: WorkerNode[];
    events: LogEvent[];
    totals: { total: number; done: number };
}

export interface Command {
    type: CommandType;
    count?: number;
    nodeId?: string;
}

export interface TelemetryMsg {
    nodeId: string;
    pid: number;
    state: NodeState;
    frameId: string | null;
    stage: Stage | null;
    pct: number;
    completed: number;
    priority: boolean;
}
