/** Types for the Director: the pure cycle-engine state machine and its effects. */

export type DirectorPhase = 'seeding' | 'running' | 'complete';

export interface DirectorState {
    cycle: number;
    paused: boolean;
    phase: DirectorPhase;
}

export interface DirectorCtx {
    activeCount: number;
    batchSize: number;
    maxNodes: number;
    minNodes: number;
    nodeCount: number;
    queueDepth: number;
    remaining: number;
    scaleDownDepth: number;
    scaleUpDepth: number;
}

export type DirectorAction =
    { type: 'tick' } | { type: 'pause' } | { type: 'resume' } | { type: 'reset' };

export type DirectorEffect =
    | { type: 'seed'; count: number }
    | { type: 'spawn' }
    | { type: 'kill'; strategy: 'random' | 'idle' }
    | { type: 'crash' }
    | { type: 'resetQueue' };
