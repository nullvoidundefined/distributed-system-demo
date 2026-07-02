/** Publishes a worker-node telemetry snapshot to the Redis pub/sub channel. */

import type { Redis } from 'ioredis';
import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';

export function publishTelemetry(publisher: Redis, msg: TelemetryMsg): void {
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}
