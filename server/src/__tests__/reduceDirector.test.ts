import { describe, expect, it } from 'vitest';
import { reduceDirector } from '../services/director/reduceDirector.js';
import type { DirectorCtx, DirectorState } from '../services/director/types.js';

const baseCtx: DirectorCtx = {
    queueDepth: 0,
    activeCount: 0,
    remaining: 0,
    minNodes: 2,
    maxNodes: 6,
    scaleUpDepth: 6,
    scaleDownDepth: 2,
    batchSize: 16,
};

const seeding: DirectorState = { phase: 'seeding', cycle: 1, nodeCount: 2 };

describe('reduceDirector', () => {
    it('seeds a batch and enters running on tick while seeding', () => {
        const { state, effects } = reduceDirector(seeding, { type: 'tick' }, baseCtx);
        expect(state.phase).toBe('running');
        expect(effects).toContainEqual({ type: 'seed', count: 16 });
    });

    it('scales up when queue depth exceeds threshold and below max nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 3 };
        const ctx = { ...baseCtx, queueDepth: 9, remaining: 9, activeCount: 3 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'spawn' });
    });

    it('does not scale beyond max nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 6 };
        const ctx = { ...baseCtx, queueDepth: 20, remaining: 20, activeCount: 6 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('scales down when draining and above min nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 4 };
        const ctx = { ...baseCtx, queueDepth: 1, remaining: 2, activeCount: 1 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'kill', strategy: 'idle' });
    });

    it('completes the cycle when nothing remains', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 2 };
        const ctx = { ...baseCtx, queueDepth: 0, remaining: 0, activeCount: 0 };
        const { state } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(state.phase).toBe('complete');
    });

    it('resets into the next cycle', () => {
        const complete: DirectorState = { phase: 'complete', cycle: 1, nodeCount: 2 };
        const { state, effects } = reduceDirector(complete, { type: 'tick' }, baseCtx);
        expect(state.cycle).toBe(2);
        expect(state.phase).toBe('seeding');
        expect(effects).toContainEqual({ type: 'resetQueue' });
    });

    it('pause and resume gate ticks', () => {
        const paused = reduceDirector(seeding, { type: 'pause' }, baseCtx).state;
        expect(paused.phase).toBe('paused');
        const stillPaused = reduceDirector(paused, { type: 'tick' }, baseCtx);
        expect(stillPaused.effects).toHaveLength(0);
        const resumed = reduceDirector(paused, { type: 'resume' }, baseCtx).state;
        expect(resumed.phase).toBe('running');
    });
});
