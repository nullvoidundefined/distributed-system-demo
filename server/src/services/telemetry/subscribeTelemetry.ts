/** Subscribes to the worker telemetry channel and folds each message into the world store. */

import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import type { Redis } from 'ioredis';

import { applyTelemetry } from '../worldState/applyTelemetry.js';
import type { WorldStore } from '../worldState/createWorldStore.js';

export function subscribeTelemetry(subscriber: Redis, store: WorldStore): void {
    void subscriber.subscribe(TELEMETRY_CHANNEL);
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        store.update((state) => applyTelemetry(state, msg));
    });
}
