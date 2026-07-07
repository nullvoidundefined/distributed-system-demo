/** Publishes a worker-node telemetry snapshot to the given Redis pub/sub channel. */

import type { TelemetryMsg } from '@demo/shared';
import type { Redis } from 'ioredis';

export function publishTelemetry(publisher: Redis, channel: string, msg: TelemetryMsg): void {
    void publisher.publish(channel, JSON.stringify(msg));
}
