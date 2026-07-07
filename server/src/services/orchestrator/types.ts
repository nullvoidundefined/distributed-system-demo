/** Types for the Orchestrator: the pure cycle-engine state machine and its effects. */

export type OrchestratorPhase = 'seeding' | 'running' | 'complete';

export interface OrchestratorState {
    cycle: number;
    paused: boolean;
    phase: OrchestratorPhase;
}

export interface OrchestratorCtx {
    activeCount: number;
    batchSize: number;
    busyNodeIds: string[];
    crashRoll: number;
    maxNodes: number;
    minNodes: number;
    nodeCount: number;
    queueDepth: number;
    remaining: number;
    scaleDownDepth: number;
    scaleUpDepth: number;
    targetRoll: number;
}

export type OrchestratorAction =
    { type: 'tick' } | { type: 'pause' } | { type: 'resume' } | { type: 'reset' };

export type OrchestratorEffect =
    | { type: 'seed'; count: number }
    | { type: 'spawn' }
    | { type: 'kill' }
    | { type: 'crash'; nodeId: string }
    | { type: 'resetQueue' };

export interface OrchestratorRuntime {
    dispatch: (action: OrchestratorAction) => Promise<void>;
    killNodeNow: () => void;
    priorityOf: (frameId: string) => boolean;
    seed: (count: number) => Promise<void>;
    stop: () => void;
}
