/** Constructs the BullMQ Queue that holds render frames. */

import { QUEUE_NAME } from '@demo/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export function createRenderQueue(connection: Redis): Queue {
    return new Queue(QUEUE_NAME, { connection });
}
