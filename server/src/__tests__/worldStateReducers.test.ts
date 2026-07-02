import { describe, expect, it } from 'vitest';
import { appendEvent } from '../services/worldState/appendEvent.js';
import { applyNodeCrashed } from '../services/worldState/applyNodeCrashed.js';
import { applyNodeSpawning } from '../services/worldState/applyNodeSpawning.js';
import { applyQueueEvent } from '../services/worldState/applyQueueEvent.js';
import { applyTelemetry } from '../services/worldState/applyTelemetry.js';
import { emptyWorld } from '../services/worldState/emptyWorld.js';
import { removeNode } from '../services/worldState/removeNode.js';

describe('worldState reducers', () => {
    it('emptyWorld starts seeding with no frames', () => {
        const world = emptyWorld(1);
        expect(world.frames).toHaveLength(0);
        expect(world.cycle).toBe(1);
    });

    it('applyQueueEvent added inserts a QUEUED frame and bumps total', () => {
        const world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        expect(world.frames[0]).toMatchObject({ id: 'f1', stage: 'QUEUED' });
        expect(world.totals.total).toBe(1);
    });

    it('applyQueueEvent added carries the priority flag onto the queued frame', () => {
        const world = applyQueueEvent(emptyWorld(1), {
            kind: 'added',
            frameId: 'f1',
            priority: true,
        });
        expect(world.frames[0]).toMatchObject({ id: 'f1', stage: 'QUEUED', priority: true });
    });

    it('applyTelemetry moves the frame to the reported stage and tags the node', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyTelemetry(world, {
            completed: 0,
            frameId: 'f1',
            nodeId: 'node-1',
            pct: 40,
            pid: 10,
            priority: true,
            stage: 'RENDERING',
            state: 'rendering',
        });
        expect(world.frames[0]).toMatchObject({
            stage: 'RENDERING',
            nodeId: 'node-1',
            pct: 40,
            priority: true,
        });
        expect(world.nodes.find((node) => node.id === 'node-1')?.state).toBe('rendering');
    });

    it('applyQueueEvent completed sets DONE and increments done total', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyQueueEvent(world, { kind: 'completed', frameId: 'f1' });
        expect(world.frames[0].stage).toBe('DONE');
        expect(world.totals.done).toBe(1);
    });

    it('applyQueueEvent failed is terminal too: DONE and done incremented so the cycle can finish', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyQueueEvent(world, { kind: 'failed', frameId: 'f1' });
        expect(world.frames[0].stage).toBe('DONE');
        expect(world.totals.done).toBe(1);
    });

    it('applyQueueEvent failed marks the frame failed; completed does not', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyQueueEvent(world, { kind: 'added', frameId: 'f2' });
        expect(world.frames.map((frame) => frame.failed)).toEqual([false, false]);
        world = applyQueueEvent(world, { kind: 'failed', frameId: 'f1' });
        world = applyQueueEvent(world, { kind: 'completed', frameId: 'f2' });
        expect(world.frames.find((frame) => frame.id === 'f1')?.failed).toBe(true);
        expect(world.frames.find((frame) => frame.id === 'f2')?.failed).toBe(false);
    });

    it('applyQueueEvent stalled returns the frame to QUEUED and clears its node', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyTelemetry(world, {
            completed: 0,
            frameId: 'f1',
            nodeId: 'node-1',
            pct: 40,
            pid: 10,
            priority: false,
            stage: 'RENDERING',
            state: 'rendering',
        });
        world = applyQueueEvent(world, { kind: 'stalled', frameId: 'f1' });
        expect(world.frames[0]).toMatchObject({ stage: 'QUEUED', nodeId: null, pct: 0 });
    });

    it('applyNodeSpawning adds a spawning placeholder node', () => {
        const world = applyNodeSpawning(emptyWorld(1), 'node-9', 4321);
        expect(world.nodes).toContainEqual(
            expect.objectContaining({ id: 'node-9', pid: 4321, state: 'spawning' }),
        );
    });

    it('applyNodeCrashed marks the node crashed without removing it', () => {
        let world = applyNodeSpawning(emptyWorld(1), 'node-9', 4321);
        world = applyNodeCrashed(world, 'node-9');
        expect(world.nodes.find((node) => node.id === 'node-9')?.state).toBe('crashed');
        expect(world.nodes).toHaveLength(1);
    });

    it('removeNode drops the node from world state', () => {
        let world = applyNodeSpawning(emptyWorld(1), 'node-9', 4321);
        world = removeNode(world, 'node-9');
        expect(world.nodes).toHaveLength(0);
    });

    it('appendEvent caps the log at 200 and assigns increasing ids', () => {
        let world = emptyWorld(1);
        for (let i = 0; i < 205; i += 1) world = appendEvent(world, 'info', `e${i}`);
        expect(world.events).toHaveLength(200);
        expect(world.events.at(-1)!.id).toBeGreaterThan(world.events[0].id);
    });
});
