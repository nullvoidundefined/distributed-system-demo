/** Publishes a worker-node telemetry snapshot to the Redis pub/sub channel. */

import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import type { Redis } from 'ioredis';

export function publishTelemetry(publisher: Redis, msg: TelemetryMsg): void {
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}
