import { describe, expect, it } from 'vitest';
import {
    applyQueueEvent,
    applyTelemetry,
    appendEvent,
    emptyWorld,
} from '../services/worldState/reduceWorldState.js';

describe('reduceWorldState', () => {
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
            nodeId: 'node-1',
            pid: 10,
            state: 'rendering',
            frameId: 'f1',
            stage: 'RENDERING',
            pct: 40,
            completed: 0,
            priority: true,
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

    it('applyQueueEvent stalled returns the frame to QUEUED and clears its node', () => {
        let world = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        world = applyTelemetry(world, {
            nodeId: 'node-1',
            pid: 10,
            state: 'rendering',
            frameId: 'f1',
            stage: 'RENDERING',
            pct: 40,
            completed: 0,
            priority: false,
        });
        world = applyQueueEvent(world, { kind: 'stalled', frameId: 'f1' });
        expect(world.frames[0]).toMatchObject({ stage: 'QUEUED', nodeId: null, pct: 0 });
    });

    it('appendEvent caps the log at 200 and assigns increasing ids', () => {
        let world = emptyWorld(1);
        for (let i = 0; i < 205; i += 1) world = appendEvent(world, 'info', `e${i}`);
        expect(world.events).toHaveLength(200);
        expect(world.events.at(-1)!.id).toBeGreaterThan(world.events[0].id);
    });
});
