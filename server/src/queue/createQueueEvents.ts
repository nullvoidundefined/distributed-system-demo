/** Constructs the BullMQ QueueEvents stream for authoritative job-lifecycle events. */

import { QUEUE_NAME } from '@demo/shared';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';

export function createQueueEvents(connection: Redis): QueueEvents {
    return new QueueEvents(QUEUE_NAME, { connection });
}
