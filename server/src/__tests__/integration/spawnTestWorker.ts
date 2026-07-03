/** Forks a real worker child process for integration tests, with per-test env overrides. */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));

export function spawnTestWorker(nodeId: string, env: Record<string, string>): ChildProcess {
    return fork(WORKER_ENTRY, [], {
        env: { ...process.env, NODE_ID: nodeId, ...env },
        execArgv: ['--import', 'tsx'],
    });
}
