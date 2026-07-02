/** Pure cycle-engine reducer: given state, action, and observed context, returns next state and effects. */

import type { DirectorAction, DirectorCtx, DirectorEffect, DirectorState } from './types.js';

interface Reduced {
    effects: DirectorEffect[];
    state: DirectorState;
}

function seed(state: DirectorState, ctx: DirectorCtx): Reduced {
    return {
        effects: [{ type: 'seed', count: ctx.batchSize }],
        state: { ...state, phase: 'running' },
    };
}

function reset(state: DirectorState): Reduced {
    return {
        effects: [{ type: 'resetQueue' }],
        state: { ...state, phase: 'seeding', cycle: state.cycle + 1 },
    };
}

function run(state: DirectorState, ctx: DirectorCtx): Reduced {
    if (ctx.remaining === 0) {
        return { effects: [], state: { ...state, phase: 'complete' } };
    }
    const effects: DirectorEffect[] = [];
    if (ctx.queueDepth >= ctx.scaleUpDepth && state.nodeCount < ctx.maxNodes) {
        effects.push({ type: 'spawn' });
    } else if (ctx.queueDepth <= ctx.scaleDownDepth && state.nodeCount > ctx.minNodes) {
        effects.push({ type: 'kill', strategy: 'idle' });
    }
    return { effects, state };
}

export function reduceDirector(
    state: DirectorState,
    action: DirectorAction,
    ctx: DirectorCtx,
): Reduced {
    if (action.type === 'pause') return { effects: [], state: { ...state, phase: 'paused' } };
    if (action.type === 'resume') return { effects: [], state: { ...state, phase: 'running' } };
    if (action.type === 'reset') return reset(state);
    if (state.phase === 'paused') return { effects: [], state };
    if (state.phase === 'seeding') return seed(state, ctx);
    if (state.phase === 'complete') return reset(state);
    return run(state, ctx);
}
