/** Pure cycle-engine reducer: given state, action, and observed context, returns next state and effects. */

import type { DirectorAction, DirectorCtx, DirectorEffect, DirectorState } from './types.js';

interface Reduced {
    state: DirectorState;
    effects: DirectorEffect[];
}

function seed(state: DirectorState, ctx: DirectorCtx): Reduced {
    return {
        state: { ...state, phase: 'running' },
        effects: [{ type: 'seed', count: ctx.batchSize }],
    };
}

function reset(state: DirectorState): Reduced {
    return {
        state: { ...state, phase: 'seeding', cycle: state.cycle + 1 },
        effects: [{ type: 'resetQueue' }],
    };
}

function run(state: DirectorState, ctx: DirectorCtx): Reduced {
    if (ctx.remaining === 0) {
        return { state: { ...state, phase: 'complete' }, effects: [] };
    }
    const effects: DirectorEffect[] = [];
    if (ctx.queueDepth >= ctx.scaleUpDepth && state.nodeCount < ctx.maxNodes) {
        effects.push({ type: 'spawn' });
    } else if (ctx.queueDepth <= ctx.scaleDownDepth && state.nodeCount > ctx.minNodes) {
        effects.push({ type: 'kill', strategy: 'idle' });
    }
    return { state, effects };
}

export function reduceDirector(
    state: DirectorState,
    action: DirectorAction,
    ctx: DirectorCtx,
): Reduced {
    if (action.type === 'pause') return { state: { ...state, phase: 'paused' }, effects: [] };
    if (action.type === 'resume') return { state: { ...state, phase: 'running' }, effects: [] };
    if (action.type === 'reset') return reset(state);
    if (state.phase === 'paused') return { state, effects: [] };
    if (state.phase === 'seeding') return seed(state, ctx);
    if (state.phase === 'complete') return reset(state);
    return run(state, ctx);
}
