/** Constructs the BullMQ QueueEvents stream for authoritative job-lifecycle events. */

import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

export function createQueueEvents(connection: Redis): QueueEvents {
    return new QueueEvents(QUEUE_NAME, { connection });
}
