/** Constructs the BullMQ Queue that holds render frames. */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

export function createRenderQueue(connection: Redis): Queue {
    return new Queue(QUEUE_NAME, { connection });
}
