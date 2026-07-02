import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let child: ChildProcess | undefined;

afterEach(() => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child = undefined;
});

test('worker exits cleanly (code 0) on SIGTERM instead of hanging', async () => {
    child = fork(WORKER_ENTRY, [], {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, NODE_ID: 'node-shutdown', REDIS_URL: url },
    });
    // give the worker time to connect and become ready
    await new Promise((resolve) => setTimeout(resolve, 1500));
    child.kill('SIGTERM');

    const code = await new Promise<number | null>((resolve) => {
        child!.on('exit', (exitCode) => resolve(exitCode));
    });
    expect(code).toBe(0);
}, 15000);
