/** Creates an ioredis connection configured for BullMQ (blocking-safe: no request retry cap). */

import { Redis } from 'ioredis';
import { TUNABLES } from '../../config/tunables.js';

export function createRedisConnection(): Redis {
    return new Redis(TUNABLES.redisUrl, { maxRetriesPerRequest: null });
}
