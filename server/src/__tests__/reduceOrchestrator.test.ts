import { describe, expect, it } from 'vitest';
import { reduceOrchestrator } from '../services/orchestrator/reduceOrchestrator.js';
import type { OrchestratorCtx, OrchestratorState } from '../services/orchestrator/types.js';

const baseCtx: OrchestratorCtx = {
    activeCount: 0,
    batchSize: 16,
    busyNodeIds: [],
    crashRoll: 1,
    maxNodes: 6,
    minNodes: 2,
    nodeCount: 2,
    queueDepth: 0,
    remaining: 0,
    scaleDownDepth: 2,
    scaleUpDepth: 6,
    targetRoll: 0,
};

const seeding: OrchestratorState = { cycle: 1, paused: false, status: 'seeding' };

describe('reduceOrchestrator', () => {
    it('seeds a batch and enters running on tick while seeding', () => {
        const { state, effects } = reduceOrchestrator(seeding, { type: 'tick' }, baseCtx);
        expect(state.status).toBe('running');
        expect(effects).toContainEqual({ type: 'seed', count: 16 });
    });

    it('scales up when queue depth exceeds threshold and below max nodes', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 9, remaining: 9, activeCount: 3, nodeCount: 3 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'spawn' });
    });

    it('does not scale up at exactly the up threshold (spec: depth must exceed it)', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 6, remaining: 6, activeCount: 3, nodeCount: 3 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('does not scale down at exactly the down threshold (spec: depth must drain below it)', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 2, remaining: 4, activeCount: 2, nodeCount: 4 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'kill' });
    });

    it('never scales down at the minimum node floor', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 0, remaining: 2, activeCount: 2, nodeCount: 2 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'kill' });
    });

    it('does not scale beyond max nodes', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 20, remaining: 20, activeCount: 6, nodeCount: 6 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('spawns to restore the minimum node floor after a crash drops the pool below it', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        // one node left (below min 2) with a shallow queue that would not trigger normal
        // scale-up; the floor must be replenished regardless of queue depth.
        const ctx = { ...baseCtx, nodeCount: 1, queueDepth: 0, remaining: 5, activeCount: 1 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'spawn' });
    });

    it('does not spawn a floor replacement when already at the minimum', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, nodeCount: 2, queueDepth: 0, remaining: 5, activeCount: 2 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('scales down when draining and above min nodes', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 1, remaining: 2, activeCount: 1, nodeCount: 4 };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'kill' });
    });

    it('completes the cycle when nothing remains', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = { ...baseCtx, queueDepth: 0, remaining: 0, activeCount: 0 };
        const { state } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(state.status).toBe('complete');
    });

    it('resets into the next cycle', () => {
        const complete: OrchestratorState = { cycle: 1, paused: false, status: 'complete' };
        const { state, effects } = reduceOrchestrator(complete, { type: 'tick' }, baseCtx);
        expect(state.cycle).toBe(2);
        expect(state.status).toBe('seeding');
        expect(effects).toContainEqual({ type: 'resetQueue' });
    });

    it('pause sets the paused flag without discarding the current status', () => {
        const paused = reduceOrchestrator(seeding, { type: 'pause' }, baseCtx).state;
        expect(paused.paused).toBe(true);
        expect(paused.status).toBe('seeding');
    });

    it('a tick while paused produces no effects and no status change', () => {
        const paused: OrchestratorState = { cycle: 1, paused: true, status: 'seeding' };
        const result = reduceOrchestrator(paused, { type: 'tick' }, baseCtx);
        expect(result.effects).toHaveLength(0);
        expect(result.state.status).toBe('seeding');
    });

    it('emits a crash effect when more than one node is busy and the roll hits', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = {
            ...baseCtx,
            busyNodeIds: ['node-1', 'node-2'],
            crashRoll: 0,
            queueDepth: 3,
            remaining: 5,
            targetRoll: 0,
        };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ nodeId: 'node-1', type: 'crash' });
    });

    it('selects the crash target deterministically from the target roll', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = {
            ...baseCtx,
            busyNodeIds: ['node-1', 'node-2', 'node-3'],
            crashRoll: 0,
            queueDepth: 3,
            remaining: 5,
            targetRoll: 0.99,
        };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ nodeId: 'node-3', type: 'crash' });
    });

    it('never emits a crash effect while paused, even when the roll hits', () => {
        const paused: OrchestratorState = { cycle: 1, paused: true, status: 'running' };
        const ctx = {
            ...baseCtx,
            busyNodeIds: ['node-1', 'node-2'],
            crashRoll: 0,
            queueDepth: 3,
            remaining: 5,
        };
        const { effects } = reduceOrchestrator(paused, { type: 'tick' }, ctx);
        expect(effects).toHaveLength(0);
    });

    it('does not crash when one or fewer nodes are busy', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = {
            ...baseCtx,
            busyNodeIds: ['node-1'],
            crashRoll: 0,
            queueDepth: 3,
            remaining: 5,
        };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects.filter((effect) => effect.type === 'crash')).toHaveLength(0);
    });

    it('does not crash when the roll misses', () => {
        const running: OrchestratorState = { cycle: 1, paused: false, status: 'running' };
        const ctx = {
            ...baseCtx,
            busyNodeIds: ['node-1', 'node-2'],
            crashRoll: 0.9,
            queueDepth: 3,
            remaining: 5,
        };
        const { effects } = reduceOrchestrator(running, { type: 'tick' }, ctx);
        expect(effects.filter((effect) => effect.type === 'crash')).toHaveLength(0);
    });

    it('resume during seeding keeps seeding so the cycle is not skipped', () => {
        const pausedWhileSeeding = reduceOrchestrator(seeding, { type: 'pause' }, baseCtx).state;
        const resumed = reduceOrchestrator(pausedWhileSeeding, { type: 'resume' }, baseCtx).state;
        expect(resumed.paused).toBe(false);
        expect(resumed.status).toBe('seeding');
        // the next tick must still seed, not jump to complete
        const next = reduceOrchestrator(resumed, { type: 'tick' }, baseCtx);
        expect(next.state.status).toBe('running');
        expect(next.effects).toContainEqual({ type: 'seed', count: 16 });
    });
});
