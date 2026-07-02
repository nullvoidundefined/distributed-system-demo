/** Manages worker child processes: spawn, graceful kill, and hard crash (real SIGKILL). */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TUNABLES } from '../../config/tunables.js';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));

export interface NodePoolDeps {
    onExit: (nodeId: string, crashed: boolean) => void;
}

export interface SpawnedNode {
    id: string;
    pid: number;
}

export interface NodePool {
    crashRandom: (busyIds: string[]) => string | null;
    ids: () => string[];
    killIdle: (idleIds: string[]) => string | null;
    shutdown: () => void;
    size: () => number;
    spawn: () => SpawnedNode;
}

function wasCrash(code: number | null, signal: NodeJS.Signals | null): boolean {
    if (signal === 'SIGKILL') return true;
    return code !== null && code !== 0;
}

function pickRandom(ids: string[]): string {
    const index = Math.floor(Math.random() * ids.length);
    return ids[index];
}

export function createNodePool(deps: NodePoolDeps): NodePool {
    const children = new Map<string, ChildProcess>();
    let counter = 0;

    function spawn(): SpawnedNode {
        counter += 1;
        const nodeId = `node-${counter}`;
        const child = fork(WORKER_ENTRY, [], {
            execArgv: ['--import', 'tsx'],
            env: {
                ...process.env,
                LOCK_DURATION_MS: String(TUNABLES.lockDurationMs),
                MAX_STALLED_COUNT: String(TUNABLES.maxStalledCount),
                NODE_ID: nodeId,
                REDIS_URL: TUNABLES.redisUrl,
                STAGE_MS: String(TUNABLES.stageMs),
                STALLED_INTERVAL_MS: String(TUNABLES.stalledIntervalMs),
            },
        });
        children.set(nodeId, child);
        child.on('exit', (code, signal) => {
            children.delete(nodeId);
            deps.onExit(nodeId, wasCrash(code, signal));
        });
        return { id: nodeId, pid: child.pid ?? 0 };
    }

    function killIdle(idleIds: string[]): string | null {
        const target = idleIds.find((id) => children.has(id));
        if (!target) return null;
        children.get(target)!.kill('SIGTERM');
        return target;
    }

    function crashRandom(busyIds: string[]): string | null {
        const candidates = busyIds.filter((id) => children.has(id));
        if (candidates.length === 0) return null;
        const target = pickRandom(candidates);
        children.get(target)!.kill('SIGKILL');
        return target;
    }

    return {
        spawn,
        killIdle,
        crashRandom,
        size: () => children.size,
        ids: () => [...children.keys()],
        shutdown: () => {
            for (const child of children.values()) child.kill('SIGKILL');
            children.clear();
        },
    };
}
