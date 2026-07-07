/** Pure cycle-engine reducer: given state, action, and observed context, returns next state and effects. */

import type { OrchestratorAction, OrchestratorCtx, OrchestratorEffect, OrchestratorState } from './types.js';

interface Reduced {
    effects: OrchestratorEffect[];
    state: OrchestratorState;
}

const CRASH_PROB_PER_TICK = 0.25;

function seed(state: OrchestratorState, ctx: OrchestratorCtx): Reduced {
    return {
        effects: [{ count: ctx.batchSize, type: 'seed' }],
        state: { ...state, phase: 'running' },
    };
}

function reset(state: OrchestratorState): Reduced {
    return {
        effects: [{ type: 'resetQueue' }],
        state: { ...state, cycle: state.cycle + 1, phase: 'seeding' },
    };
}

function run(state: OrchestratorState, ctx: OrchestratorCtx): Reduced {
    if (ctx.remaining === 0) {
        return { effects: [], state: { ...state, phase: 'complete' } };
    }
    const effects: OrchestratorEffect[] = [];
    if (ctx.nodeCount < ctx.minNodes) {
        // Replenish the floor after a crash or graceful retire drops the pool below the
        // minimum; the crew is guaranteed regardless of queue depth. One spawn per tick
        // converges back to MIN_NODES.
        effects.push({ type: 'spawn' });
    } else if (ctx.queueDepth > ctx.scaleUpDepth && ctx.nodeCount < ctx.maxNodes) {
        effects.push({ type: 'spawn' });
    } else if (ctx.queueDepth < ctx.scaleDownDepth && ctx.nodeCount > ctx.minNodes) {
        effects.push({ type: 'kill' });
    }
    const crashTarget = selectCrashTarget(ctx);
    if (crashTarget) effects.push({ nodeId: crashTarget, type: 'crash' });
    return { effects, state };
}

function selectCrashTarget(ctx: OrchestratorCtx): string | null {
    const { busyNodeIds, crashRoll, targetRoll } = ctx;
    if (crashRoll >= CRASH_PROB_PER_TICK || busyNodeIds.length <= 1) return null;
    const index = Math.min(busyNodeIds.length - 1, Math.floor(targetRoll * busyNodeIds.length));
    return busyNodeIds[index];
}

export function reduceOrchestrator(
    state: OrchestratorState,
    action: OrchestratorAction,
    ctx: OrchestratorCtx,
): Reduced {
    if (action.type === 'pause') return { effects: [], state: { ...state, paused: true } };
    if (action.type === 'resume') return { effects: [], state: { ...state, paused: false } };
    if (action.type === 'reset') return reset(state);
    if (state.paused) return { effects: [], state };
    if (state.phase === 'seeding') return seed(state, ctx);
    if (state.phase === 'complete') return reset(state);
    return run(state, ctx);
}
