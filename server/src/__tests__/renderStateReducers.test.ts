import { describe, expect, it } from 'vitest';
import { appendEvent } from '../services/renderState/appendEvent.js';
import { applyNodeCrashed } from '../services/renderState/applyNodeCrashed.js';
import { applyNodeSpawning } from '../services/renderState/applyNodeSpawning.js';
import { applyQueueEvent } from '../services/renderState/applyQueueEvent.js';
import { applyTelemetry } from '../services/renderState/applyTelemetry.js';
import { emptyRenderState } from '../services/renderState/emptyRenderState.js';
import { removeNode } from '../services/renderState/removeNode.js';

describe('renderState reducers', () => {
    it('emptyRenderState starts seeding with no frames', () => {
        const renderState = emptyRenderState(1);
        expect(renderState.frames).toHaveLength(0);
        expect(renderState.cycle).toBe(1);
    });

    it('applyQueueEvent added inserts a QUEUED frame and bumps total', () => {
        const renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        expect(renderState.frames[0]).toMatchObject({ id: 'f1', stage: 'QUEUED' });
        expect(renderState.totals.total).toBe(1);
    });

    it('applyQueueEvent added carries the priority flag onto the queued frame', () => {
        const renderState = applyQueueEvent(emptyRenderState(1), {
            kind: 'added',
            frameId: 'f1',
            priority: true,
        });
        expect(renderState.frames[0]).toMatchObject({ id: 'f1', stage: 'QUEUED', priority: true });
    });

    it('applyTelemetry moves the frame to the reported stage and tags the node', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyTelemetry(renderState, {
            completed: 0,
            frameId: 'f1',
            nodeId: 'node-1',
            pct: 40,
            pid: 10,
            priority: true,
            stage: 'RENDERING',
            state: 'rendering',
        });
        expect(renderState.frames[0]).toMatchObject({
            stage: 'RENDERING',
            nodeId: 'node-1',
            pct: 40,
            priority: true,
        });
        expect(renderState.nodes.find((node) => node.id === 'node-1')?.state).toBe('rendering');
    });

    it('applyTelemetry does not resurrect a DONE frame when late telemetry loses the race', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'completed', frameId: 'f1' });
        // The frame's final progress telemetry arrives after the completed event
        // (the two channels are unordered); it must not drag the frame out of DONE.
        renderState = applyTelemetry(renderState, {
            completed: 1,
            frameId: 'f1',
            nodeId: 'node-1',
            pct: 100,
            pid: 10,
            priority: false,
            stage: 'COMPOSITING',
            state: 'compositing',
        });
        expect(renderState.frames[0].stage).toBe('DONE');
        // The node telemetry itself is still valid and must still be recorded.
        expect(renderState.nodes.find((node) => node.id === 'node-1')?.completed).toBe(1);
    });

    it('applyQueueEvent completed sets DONE and increments done total', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'completed', frameId: 'f1' });
        expect(renderState.frames[0].stage).toBe('DONE');
        expect(renderState.totals.done).toBe(1);
    });

    it('applyQueueEvent completed counts a frame done exactly once even if it fires twice', () => {
        // BullMQ has at-least-once semantics; a false stall can re-process and re-complete
        // a job. done must count each frame once, or it overshoots total and the cycle
        // (which resets when total - done reaches 0) can never complete.
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'completed', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'completed', frameId: 'f1' });
        expect(renderState.totals.done).toBe(1);
        expect(renderState.frames.filter((frame) => frame.stage === 'DONE')).toHaveLength(1);
    });

    it('applyQueueEvent completed for an unknown frame does not inflate done', () => {
        const renderState = applyQueueEvent(emptyRenderState(1), { kind: 'completed', frameId: 'ghost' });
        expect(renderState.totals.done).toBe(0);
    });

    it('applyQueueEvent failed is terminal too: DONE and done incremented so the cycle can finish', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'failed', frameId: 'f1' });
        expect(renderState.frames[0].stage).toBe('DONE');
        expect(renderState.totals.done).toBe(1);
    });

    it('applyQueueEvent failed marks the frame failed; completed does not', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'added', frameId: 'f2' });
        expect(renderState.frames.map((frame) => frame.failed)).toEqual([false, false]);
        renderState = applyQueueEvent(renderState, { kind: 'failed', frameId: 'f1' });
        renderState = applyQueueEvent(renderState, { kind: 'completed', frameId: 'f2' });
        expect(renderState.frames.find((frame) => frame.id === 'f1')?.failed).toBe(true);
        expect(renderState.frames.find((frame) => frame.id === 'f2')?.failed).toBe(false);
    });

    it('applyQueueEvent stalled returns the frame to QUEUED and clears its node', () => {
        let renderState = applyQueueEvent(emptyRenderState(1), { kind: 'added', frameId: 'f1' });
        renderState = applyTelemetry(renderState, {
            completed: 0,
            frameId: 'f1',
            nodeId: 'node-1',
            pct: 40,
            pid: 10,
            priority: false,
            stage: 'RENDERING',
            state: 'rendering',
        });
        renderState = applyQueueEvent(renderState, { kind: 'stalled', frameId: 'f1' });
        expect(renderState.frames[0]).toMatchObject({ stage: 'QUEUED', nodeId: null, pct: 0 });
    });

    it('applyNodeSpawning adds a spawning placeholder node', () => {
        const renderState = applyNodeSpawning(emptyRenderState(1), 'node-9', 4321);
        expect(renderState.nodes).toContainEqual(
            expect.objectContaining({ id: 'node-9', pid: 4321, state: 'spawning' }),
        );
    });

    it('applyNodeCrashed marks the node crashed without removing it', () => {
        let renderState = applyNodeSpawning(emptyRenderState(1), 'node-9', 4321);
        renderState = applyNodeCrashed(renderState, 'node-9');
        expect(renderState.nodes.find((node) => node.id === 'node-9')?.state).toBe('crashed');
        expect(renderState.nodes).toHaveLength(1);
    });

    it('removeNode drops the node from render state', () => {
        let renderState = applyNodeSpawning(emptyRenderState(1), 'node-9', 4321);
        renderState = removeNode(renderState, 'node-9');
        expect(renderState.nodes).toHaveLength(0);
    });

    it('appendEvent caps the log at 200 and assigns increasing ids', () => {
        let renderState = emptyRenderState(1);
        for (let i = 0; i < 205; i += 1) renderState = appendEvent(renderState, 'info', `e${i}`);
        expect(renderState.events).toHaveLength(200);
        expect(renderState.events.at(-1)!.id).toBeGreaterThan(renderState.events[0].id);
    });
});
