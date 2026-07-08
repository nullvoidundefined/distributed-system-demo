import { expect, test } from 'vitest';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { type FrameJobData, type TelemetryMsg } from '@demo/shared';

import { processFrame } from '../processFrame.js';

interface PublishedTelemetry {
    channel: string;
    msg: TelemetryMsg;
}

const CHANNEL = 'worker:telemetry:unit';

function createCapturingPublisher(published: PublishedTelemetry[]): Redis {
    return {
        publish: (channel: string, payload: string) => {
            published.push({ channel, msg: JSON.parse(payload) as TelemetryMsg });
            return Promise.resolve(1);
        },
    } as unknown as Redis;
}

test('runs RENDERING before COMPOSITING with a full progress ramp on each stage', async () => {
    const published: PublishedTelemetry[] = [];
    const job = { data: { cycle: 3, frameId: 'f9', priority: true } } as Job<FrameJobData>;

    await processFrame(job, {
        getCompleted: () => 7,
        nodeId: 'node-test',
        pid: 42,
        publisher: createCapturingPublisher(published),
        stageMs: 20,
        telemetryChannel: CHANNEL,
    });

    expect(published).toHaveLength(10);
    const stages = published.map(({ msg }) => msg.stage);
    expect(stages.slice(0, 5)).toEqual([
        'RENDERING',
        'RENDERING',
        'RENDERING',
        'RENDERING',
        'RENDERING',
    ]);
    expect(stages.slice(5)).toEqual([
        'COMPOSITING',
        'COMPOSITING',
        'COMPOSITING',
        'COMPOSITING',
        'COMPOSITING',
    ]);
    const renderingPcts = published.slice(0, 5).map(({ msg }) => msg.pct);
    expect(renderingPcts).toEqual([20, 40, 60, 80, 100]);
    const compositingPcts = published.slice(5).map(({ msg }) => msg.pct);
    expect(compositingPcts).toEqual([20, 40, 60, 80, 100]);
    expect(published.every(({ channel }) => channel === CHANNEL)).toBe(true);
    expect(published[0].msg).toMatchObject({
        completed: 7,
        frameId: 'f9',
        nodeId: 'node-test',
        pid: 42,
        priority: true,
        state: 'rendering',
    });
    expect(published[9].msg.state).toBe('compositing');
});
