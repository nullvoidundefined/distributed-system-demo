/** Shared TypeScript types exchanged between orchestrator, workers, and the web client. */

import type { STAGES, EVENT_LEVELS, COMMAND_TYPES } from './constants.js';

export type Stage = (typeof STAGES)[number];
export type EventLevel = (typeof EVENT_LEVELS)[number];
export type CommandType = (typeof COMMAND_TYPES)[number];

export type NodeState = 'idle' | 'rendering' | 'compositing' | 'spawning' | 'crashed';

export interface Command {
    count?: number;
    nodeId?: string;
    type: CommandType;
}

export interface Frame {
    cycle: number;
    failed: boolean;
    id: string;
    nodeId: string | null;
    pct: number;
    priority: boolean;
    stage: Stage;
}

export interface FrameJobData {
    cycle: number;
    frameId: string;
    priority: boolean;
}

export interface LogEvent {
    id: number;
    level: EventLevel;
    message: string;
    ts: number;
}

export interface TelemetryMsg {
    completed: number;
    frameId: string | null;
    nodeId: string;
    pct: number;
    pid: number;
    priority: boolean;
    stage: Stage | null;
    state: NodeState;
}

export interface RenderNode {
    completed: number;
    frameId: string | null;
    id: string;
    pct: number;
    pid: number;
    state: NodeState;
}

export interface RenderState {
    cycle: number;
    events: LogEvent[];
    frames: Frame[];
    nodes: RenderNode[];
    phase: 'seeding' | 'running' | 'complete' | 'paused';
    totals: { done: number; total: number };
}
