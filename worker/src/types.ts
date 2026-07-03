/** Dependencies threaded through frame processing so stages stay pure and testable. */

import type { Redis } from 'ioredis';

export interface ProcessDeps {
    getCompleted: () => number;
    nodeId: string;
    pid: number;
    publisher: Redis;
    stageMs: number;
}
