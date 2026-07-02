import { describe, expect, it } from 'vitest';
import { reduceDirector } from '../services/director/reduceDirector.js';
import type { DirectorCtx, DirectorState } from '../services/director/types.js';

const baseCtx: DirectorCtx = {
    activeCount: 0,
    batchSize: 16,
    maxNodes: 6,
    minNodes: 2,
    nodeCount: 2,
    queueDepth: 0,
    remaining: 0,
    scaleDownDepth: 2,
    scaleUpDepth: 6,
};

const seeding: DirectorState = { cycle: 1, paused: false, phase: 'seeding' };

describe('reduceDirector', () => {
    it('seeds a batch and enters running on tick while seeding', () => {
        const { state, effects } = reduceDirector(seeding, { type: 'tick' }, baseCtx);
        expect(state.phase).toBe('running');
        expect(effects).toContainEqual({ type: 'seed', count: 16 });
    });

    it('scales up when queue depth exceeds threshold and below max nodes', () => {
        const running: DirectorState = { cycle: 1, paused: false, phase: 'running' };
        const ctx = { ...baseCtx, queueDepth: 9, remaining: 9, activeCount: 3, nodeCount: 3 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'spawn' });
    });

    it('does not scale beyond max nodes', () => {
        const running: DirectorState = { cycle: 1, paused: false, phase: 'running' };
        const ctx = { ...baseCtx, queueDepth: 20, remaining: 20, activeCount: 6, nodeCount: 6 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('scales down when draining and above min nodes', () => {
        const running: DirectorState = { cycle: 1, paused: false, phase: 'running' };
        const ctx = { ...baseCtx, queueDepth: 1, remaining: 2, activeCount: 1, nodeCount: 4 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'kill' });
    });

    it('completes the cycle when nothing remains', () => {
        const running: DirectorState = { cycle: 1, paused: false, phase: 'running' };
        const ctx = { ...baseCtx, queueDepth: 0, remaining: 0, activeCount: 0 };
        const { state } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(state.phase).toBe('complete');
    });

    it('resets into the next cycle', () => {
        const complete: DirectorState = { cycle: 1, paused: false, phase: 'complete' };
        const { state, effects } = reduceDirector(complete, { type: 'tick' }, baseCtx);
        expect(state.cycle).toBe(2);
        expect(state.phase).toBe('seeding');
        expect(effects).toContainEqual({ type: 'resetQueue' });
    });

    it('pause sets the paused flag without discarding the current phase', () => {
        const paused = reduceDirector(seeding, { type: 'pause' }, baseCtx).state;
        expect(paused.paused).toBe(true);
        expect(paused.phase).toBe('seeding');
    });

    it('a tick while paused produces no effects and no phase change', () => {
        const paused: DirectorState = { cycle: 1, paused: true, phase: 'seeding' };
        const result = reduceDirector(paused, { type: 'tick' }, baseCtx);
        expect(result.effects).toHaveLength(0);
        expect(result.state.phase).toBe('seeding');
    });

    it('resume during seeding keeps seeding so the cycle is not skipped', () => {
        const pausedWhileSeeding = reduceDirector(seeding, { type: 'pause' }, baseCtx).state;
        const resumed = reduceDirector(pausedWhileSeeding, { type: 'resume' }, baseCtx).state;
        expect(resumed.paused).toBe(false);
        expect(resumed.phase).toBe('seeding');
        // the next tick must still seed, not jump to complete
        const next = reduceDirector(resumed, { type: 'tick' }, baseCtx);
        expect(next.state.phase).toBe('running');
        expect(next.effects).toContainEqual({ type: 'seed', count: 16 });
    });
});
