/** Subscribes to the worker telemetry channel and folds each message into the render store. */

import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import type { Redis } from 'ioredis';

import { applyTelemetry } from '../renderState/applyTelemetry.js';
import type { RenderStore } from '../renderState/types.js';

export function subscribeTelemetry(subscriber: Redis, store: RenderStore): void {
    const channel = process.env.TELEMETRY_CHANNEL ?? TELEMETRY_CHANNEL;
    void subscriber.subscribe(channel);
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        store.update((state) => applyTelemetry(state, msg));
    });
}
