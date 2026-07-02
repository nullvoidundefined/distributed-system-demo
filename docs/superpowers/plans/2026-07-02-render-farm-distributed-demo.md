# Render Farm Distributed-System Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-running, cyclical visual demo of a distributed render farm on real Redis + BullMQ, with worker nodes as separate OS processes, showcasing load balancing, fault tolerance, autoscaling, and priorities.

**Architecture:** An Express orchestrator owns a BullMQ queue, runs an autonomous Director cycle engine, forks/kills worker child processes, and broadcasts a merged world-state over WebSocket to a Vite/React SPA (Kanban board + worker-node strip + event log + controls). Workers are separate Node processes each running a BullMQ Worker and publishing telemetry over Redis pub/sub.

**Tech Stack:** TypeScript, Node 20+, Express 5, BullMQ 5, ioredis, `ws`, Vite + React 18, SCSS modules, Vitest, npm workspaces, Docker (Redis), optional Playwright.

## Global Constraints

- Node 20+; TypeScript strict; ES modules (`"type": "module"`).
- npm workspaces: `shared`, `server`, `worker`, `web`.
- Prettier: 4-space indent, trailing commas, 100 char width.
- Never emit U+2014 (em dash) in any file. Use hyphen/colon/semicolon.
- Every new source file starts with a `/** */` file-level header comment (except `.d.ts`, barrels, single-constant files, test files).
- One exported function per file in `services/` and `clients/` trees; descriptive verb-noun names.
- Ports: server HTTP+WS `3001`, Vite `5173`. Redis `6379` (Docker).
- BullMQ connections use ioredis with `maxRetriesPerRequest: null`.
- Shared cross-workspace code imported from `@demo/shared`, never relative `../../shared`.

---

## File Structure

```
distributed-system-demo/
+- package.json                    # workspaces root, scripts
+- tsconfig.base.json
+- docker-compose.yml              # redis:7
+- .prettierrc.json
+- shared/
|  +- package.json                 # name @demo/shared
|  +- tsconfig.json
|  +- src/
|     +- index.ts                  # barrel re-export
|     +- constants.ts              # QUEUE_NAME, STAGES, EVENT_LEVELS, TELEMETRY_CHANNEL
|     +- types.ts                  # Frame, Stage, NodeStatus, WorldState, LogEvent, Command, TelemetryMsg
+- server/
|  +- package.json
|  +- tsconfig.json
|  +- src/
|     +- index.ts                  # bootstrap: express + ws + queue + director
|     +- config/
|     |  +- tunables.ts            # all timing/threshold constants from env
|     +- clients/
|     |  +- redis/
|     |     +- createRedisConnection.ts
|     +- queue/
|     |  +- createRenderQueue.ts
|     |  +- createQueueEvents.ts
|     +- services/
|     |  +- director/
|     |  |  +- types.ts            # DirectorState, DirectorPhase
|     |  |  +- reduceDirector.ts   # pure state machine (unit tested)
|     |  |  +- runDirector.ts      # wires reducer to queue + nodePool on a timer
|     |  +- nodePool/
|     |  |  +- createNodePool.ts   # fork/kill/track worker children
|     |  +- telemetry/
|     |  |  +- subscribeTelemetry.ts
|     |  +- worldState/
|     |     +- createWorldStore.ts # holds state, applies updates
|     |     +- reduceWorldState.ts # pure merge of events+telemetry (unit tested)
|     +- websocket/
|        +- createBroadcaster.ts
|        +- handleCommand.ts
|     +- __tests__/
|        +- reduceDirector.test.ts
|        +- reduceWorldState.test.ts
|        +- integration/
|           +- crashRecovery.test.ts
+- worker/
|  +- package.json
|  +- tsconfig.json
|  +- src/
|     +- index.ts                  # BullMQ Worker entry
|     +- stages/
|     |  +- processFrame.ts        # runs render then composite, emits progress
|     +- telemetry/
|        +- publishTelemetry.ts
+- web/
   +- package.json
   +- index.html
   +- vite.config.ts
   +- tsconfig.json
   +- src/
      +- main.tsx
      +- App.tsx
      +- state/
      |  +- useWorldState.ts       # ws client hook
      |  +- useCommands.ts
      +- components/
      |  +- KanbanBoard/
      |  |  +- KanbanBoard.tsx
      |  |  +- KanbanBoard.module.scss
      |  +- NodeStrip/
      |  |  +- NodeStrip.tsx
      |  |  +- NodeStrip.module.scss
      |  +- EventLog/
      |  |  +- EventLog.tsx
      |  |  +- EventLog.module.scss
      |  +- ControlBar/
      |     +- ControlBar.tsx
      |     +- ControlBar.module.scss
      +- styles/
         +- global.scss
```

---

### Task 1: Monorepo scaffold, Docker Redis, shared types

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `docker-compose.yml`, `.prettierrc.json`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/{index,constants,types}.ts`

**Interfaces:**
- Produces (consumed by every later task): the `@demo/shared` types and constants below, verbatim.

- [ ] **Step 1: Root config files**

`package.json`:
```json
{
  "name": "distributed-system-demo",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "worker", "web"],
  "scripts": {
    "build": "npm run build -ws --if-present",
    "dev": "concurrently -n server,web -c blue,green \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "npm run dev -w server",
    "dev:web": "npm run dev -w web",
    "test": "npm run test -ws --if-present"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "composite": true
  }
}
```

`.prettierrc.json`:
```json
{ "tabWidth": 4, "printWidth": 100, "trailingComma": "all", "singleQuote": true }
```

`docker-compose.yml`:
```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    command: redis-server --save "" --appendonly no
```

- [ ] **Step 2: shared package config**

`shared/package.json`:
```json
{
  "name": "@demo/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: shared constants**

`shared/src/constants.ts`:
```typescript
/** Shared constants for the render-farm demo: queue name, stages, channels, event levels. */

export const QUEUE_NAME = 'render-frames';
export const TELEMETRY_CHANNEL = 'worker:telemetry';

export const STAGES = ['QUEUED', 'RENDERING', 'COMPOSITING', 'DONE'] as const;

export const EVENT_LEVELS = ['info', 'success', 'warn', 'danger'] as const;

export const COMMAND_TYPES = ['pause', 'resume', 'inject', 'killNode', 'reset'] as const;
```

- [ ] **Step 4: shared types**

`shared/src/types.ts`:
```typescript
/** Shared TypeScript types exchanged between orchestrator, workers, and the web client. */

import type { STAGES, EVENT_LEVELS, COMMAND_TYPES } from './constants.js';

export type Stage = (typeof STAGES)[number];
export type EventLevel = (typeof EVENT_LEVELS)[number];
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface Frame {
    id: string;
    cycle: number;
    priority: boolean;
    stage: Stage;
    nodeId: string | null;
    pct: number;
}

export type NodeState = 'idle' | 'rendering' | 'compositing' | 'spawning' | 'crashed';

export interface WorkerNode {
    id: string;
    pid: number;
    state: NodeState;
    frameId: string | null;
    pct: number;
    completed: number;
}

export interface LogEvent {
    id: number;
    ts: number;
    level: EventLevel;
    message: string;
}

export interface WorldState {
    cycle: number;
    phase: 'seeding' | 'running' | 'complete' | 'paused';
    frames: Frame[];
    nodes: WorkerNode[];
    events: LogEvent[];
    totals: { total: number; done: number };
}

export interface Command {
    type: CommandType;
    count?: number;
    nodeId?: string;
}

export interface TelemetryMsg {
    nodeId: string;
    pid: number;
    state: NodeState;
    frameId: string | null;
    stage: Stage | null;
    pct: number;
    completed: number;
}
```

`shared/src/index.ts`:
```typescript
export * from './constants.js';
export * from './types.js';
```

- [ ] **Step 5: Verify install and Redis**

Run: `npm install && docker compose up -d && docker compose exec redis redis-cli ping`
Expected: `PONG`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold workspaces, docker redis, shared types"
```

---

### Task 2: Redis connection client + queue setup

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`
- Create: `server/src/config/tunables.ts`
- Create: `server/src/clients/redis/createRedisConnection.ts`
- Create: `server/src/queue/createRenderQueue.ts`, `server/src/queue/createQueueEvents.ts`

**Interfaces:**
- Produces:
  - `createRedisConnection(): Redis` (ioredis instance, `maxRetriesPerRequest: null`)
  - `createRenderQueue(connection: Redis): Queue`
  - `createQueueEvents(connection: Redis): QueueEvents`
  - `TUNABLES` object (all timing/threshold constants)

- [ ] **Step 1: server package + tsconfig**

`server/package.json`:
```json
{
  "name": "server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@demo/shared": "*",
    "bullmq": "^5.34.0",
    "express": "^5.0.1",
    "ioredis": "^5.4.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.2",
    "vitest": "^2.1.8"
  }
}
```

`server/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src"] }
```

- [ ] **Step 2: tunables**

`server/src/config/tunables.ts`:
```typescript
/** Central timing and threshold knobs for the demo. Values chosen for an accelerated clock. */

function num(name: string, fallback: number): number {
    const raw = process.env[name];
    return raw === undefined ? fallback : Number(raw);
}

export const TUNABLES = {
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    httpPort: num('PORT', 3001),
    batchSize: num('BATCH_SIZE', 16),
    highPriorityRatio: 0.15,
    tickMinMs: num('TICK_MIN_MS', 5000),
    tickMaxMs: num('TICK_MAX_MS', 10000),
    stageMs: num('STAGE_MS', 2500),
    minNodes: num('MIN_NODES', 2),
    maxNodes: num('MAX_NODES', 6),
    scaleUpDepth: num('SCALE_UP_DEPTH', 6),
    scaleDownDepth: num('SCALE_DOWN_DEPTH', 2),
    stalledIntervalMs: num('STALLED_INTERVAL_MS', 3000),
    lockDurationMs: num('LOCK_DURATION_MS', 5000),
    maxStalledCount: num('MAX_STALLED_COUNT', 10),
    jobAttempts: num('JOB_ATTEMPTS', 20),
    broadcastHz: num('BROADCAST_HZ', 5),
} as const;
```

- [ ] **Step 3: redis connection**

`server/src/clients/redis/createRedisConnection.ts`:
```typescript
/** Creates an ioredis connection configured for BullMQ (blocking-safe: no request retry cap). */

import { Redis } from 'ioredis';
import { TUNABLES } from '../../config/tunables.js';

export function createRedisConnection(): Redis {
    return new Redis(TUNABLES.redisUrl, { maxRetriesPerRequest: null });
}
```

- [ ] **Step 4: queue + queue events**

`server/src/queue/createRenderQueue.ts`:
```typescript
/** Constructs the BullMQ Queue that holds render frames. */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

export function createRenderQueue(connection: Redis): Queue {
    return new Queue(QUEUE_NAME, { connection });
}
```

`server/src/queue/createQueueEvents.ts`:
```typescript
/** Constructs the BullMQ QueueEvents stream for authoritative job-lifecycle events. */

import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

export function createQueueEvents(connection: Redis): QueueEvents {
    return new QueueEvents(QUEUE_NAME, { connection });
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run build -w server`
Expected: exits 0 (no emit errors). If `@demo/shared` fails to resolve, confirm root `npm install` linked the workspace.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: redis connection and bullmq queue setup"
```

---

### Task 3: Worker process (stages + telemetry)

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`
- Create: `worker/src/telemetry/publishTelemetry.ts`
- Create: `worker/src/stages/processFrame.ts`
- Create: `worker/src/index.ts`

**Interfaces:**
- Consumes: `@demo/shared` types/constants; `TUNABLES` via env (worker reads its own env).
- Produces: a runnable worker entry `worker/src/index.ts` that, given env `NODE_ID`, connects a BullMQ `Worker` to `QUEUE_NAME`, processes frames through RENDERING then COMPOSITING, and publishes `TelemetryMsg` to `TELEMETRY_CHANNEL`. Job data shape: `{ frameId: string; cycle: number; priority: boolean }`.

- [ ] **Step 1: worker package + tsconfig**

`worker/package.json`:
```json
{
  "name": "worker",
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@demo/shared": "*",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.1"
  },
  "devDependencies": { "tsx": "^4.19.2", "typescript": "^5.6.0" }
}
```

`worker/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src"] }
```

- [ ] **Step 2: telemetry publisher**

`worker/src/telemetry/publishTelemetry.ts`:
```typescript
/** Publishes a worker-node telemetry snapshot to the Redis pub/sub channel. */

import type { Redis } from 'ioredis';
import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';

export function publishTelemetry(publisher: Redis, msg: TelemetryMsg): void {
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}
```

- [ ] **Step 3: frame processor**

`worker/src/stages/processFrame.ts`:
```typescript
/** Runs a single frame through RENDERING then COMPOSITING, emitting progress after each tick. */

import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { NodeState, Stage, TelemetryMsg } from '@demo/shared';
import { publishTelemetry } from '../telemetry/publishTelemetry.js';

const STEPS = 5;

export interface ProcessDeps {
    nodeId: string;
    pid: number;
    publisher: Redis;
    stageMs: number;
    getCompleted: () => number;
    crashRoll: () => boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage(job: Job, stage: Stage, state: NodeState, deps: ProcessDeps): Promise<void> {
    const stepMs = deps.stageMs / STEPS;
    for (let step = 1; step <= STEPS; step += 1) {
        if (deps.crashRoll()) {
            process.exit(137); // simulate a hard crash mid-stage (real SIGKILL-like death)
        }
        await sleep(stepMs);
        const pct = Math.round(((step / STEPS) * 100 + (stage === 'COMPOSITING' ? 0 : 0)) );
        const msg: TelemetryMsg = {
            nodeId: deps.nodeId,
            pid: deps.pid,
            state,
            frameId: String(job.data.frameId),
            stage,
            pct,
            completed: deps.getCompleted(),
        };
        await job.updateProgress({ stage, pct, nodeId: deps.nodeId });
        publishTelemetry(deps.publisher, msg);
    }
}

export async function processFrame(job: Job, deps: ProcessDeps): Promise<void> {
    await runStage(job, 'RENDERING', 'rendering', deps);
    await runStage(job, 'COMPOSITING', 'compositing', deps);
}
```

- [ ] **Step 4: worker entry**

`worker/src/index.ts`:
```typescript
/** Worker child-process entry: binds a BullMQ Worker to the render queue and reports telemetry. */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import { processFrame } from './stages/processFrame.js';

const nodeId = process.env.NODE_ID ?? `node-${process.pid}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const stageMs = Number(process.env.STAGE_MS ?? 2500);
const crashProbability = Number(process.env.CRASH_PROB ?? 0); // set >0 by orchestrator to arm a crash

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publisher = new Redis(redisUrl);

let completed = 0;

function publishIdle(): void {
    const msg: TelemetryMsg = {
        nodeId,
        pid: process.pid,
        state: 'idle',
        frameId: null,
        stage: null,
        pct: 0,
        completed,
    };
    void publisher.publish(TELEMETRY_CHANNEL, JSON.stringify(msg));
}

const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        await processFrame(job, {
            nodeId,
            pid: process.pid,
            publisher,
            stageMs,
            getCompleted: () => completed,
            crashRoll: () => Math.random() < crashProbability,
        });
    },
    {
        connection,
        concurrency: 1,
        lockDuration: Number(process.env.LOCK_DURATION_MS ?? 5000),
        stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? 3000),
        maxStalledCount: Number(process.env.MAX_STALLED_COUNT ?? 10),
    },
);

worker.on('completed', () => {
    completed += 1;
    publishIdle();
});

worker.on('ready', publishIdle);

process.on('SIGTERM', async () => {
    await worker.close();
    process.exit(0);
});
```

- [ ] **Step 5: Manual smoke (with Redis up)**

Run:
```bash
NODE_ID=node-test REDIS_URL=redis://127.0.0.1:6379 npx tsx worker/src/index.ts &
docker compose exec redis redis-cli --json subscribe worker:telemetry
```
Then in another shell add a job via a one-off script, or defer verification to Task 4's integration test.
Expected: an `idle` telemetry message appears on `ready`. Kill the background worker after.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: worker process with staged frame processing and telemetry"
```

---

### Task 4: Integration test - crash and recover (RISK VALIDATION)

Do this before building the Director/UI: it proves the accelerated stalled-recovery timing works. If it fails after tuning, switch to the soft-crash fallback (worker throws inside processor; rely on `attempts`) and note it in the README.

**Files:**
- Create: `server/src/__tests__/integration/crashRecovery.test.ts`
- Create: `server/vitest.config.ts`

**Interfaces:**
- Consumes: `createRedisConnection`, `createRenderQueue`, `QUEUE_NAME`, worker entry behavior.

- [ ] **Step 1: vitest config**

`server/vitest.config.ts`:
```typescript
/** Vitest config: node environment, longer timeout for real-Redis integration tests. */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { environment: 'node', testTimeout: 30000, hookTimeout: 30000 },
});
```

- [ ] **Step 2: Write the failing integration test**

`server/src/__tests__/integration/crashRecovery.test.ts`:
```typescript
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME } from '@demo/shared';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let queue: Queue;
let events: QueueEvents;
let conn: Redis;
const children: ChildProcess[] = [];

function spawnWorker(nodeId: string, crashProb = 0): ChildProcess {
    const child = fork(WORKER_ENTRY, [], {
        execArgv: ['--import', 'tsx'],
        env: {
            ...process.env,
            NODE_ID: nodeId,
            REDIS_URL: url,
            STAGE_MS: '1500',
            LOCK_DURATION_MS: '4000',
            STALLED_INTERVAL_MS: '2000',
            CRASH_PROB: String(crashProb),
        },
    });
    children.push(child);
    return child;
}

beforeEach(async () => {
    conn = new Redis(url, { maxRetriesPerRequest: null });
    await conn.flushall();
    queue = new Queue(QUEUE_NAME, { connection: conn });
    events = new QueueEvents(QUEUE_NAME, { connection: new Redis(url, { maxRetriesPerRequest: null }) });
    await events.waitUntilReady();
});

afterEach(async () => {
    for (const c of children) c.kill('SIGKILL');
    children.length = 0;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.close();
    await queue.close();
    await conn.quit();
});

test('a frame orphaned by a crashed worker is recovered and completed by another worker', async () => {
    const doomed = spawnWorker('node-doomed', 1); // crashes on first tick
    await new Promise((r) => setTimeout(r, 500));
    await queue.add('frame', { frameId: 'f1', cycle: 0, priority: false }, { attempts: 20 });

    // doomed picks it up and dies; wait, then bring a healthy worker online
    await new Promise((r) => setTimeout(r, 1500));
    expect(doomed.killed || doomed.exitCode !== null).toBe(true);
    spawnWorker('node-healthy', 0);

    const completed = await new Promise<string>((resolve) => {
        events.on('completed', ({ jobId }) => resolve(jobId));
    });
    expect(completed).toBeDefined();
}, 25000);
```

- [ ] **Step 3: Run it, expect FAIL first**

Run: `docker compose up -d && npm test -w server`
Expected: FAIL initially if timing tuned wrong (job never completes within timeout) OR PASS if defaults are already good. If it times out, raise `LOCK_DURATION_MS`/lower `STALLED_INTERVAL_MS` in the test env and re-run until it passes. Record the working values.

- [ ] **Step 4: Fold the working timing values back into `tunables.ts` defaults**

Update `TUNABLES.lockDurationMs` / `stalledIntervalMs` to the values that passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: integration test for crash-and-recover via bullmq stalled recovery"
```

---

### Task 5: Director state machine (pure, unit tested)

**Files:**
- Create: `server/src/services/director/types.ts`
- Create: `server/src/services/director/reduceDirector.ts`
- Test: `server/src/__tests__/reduceDirector.test.ts`

**Interfaces:**
- Produces:
  - `DirectorState = { phase: 'seeding'|'running'|'complete'|'paused'; cycle: number; nodeCount: number }`
  - `DirectorAction` union (below)
  - `reduceDirector(state: DirectorState, action: DirectorAction, ctx: DirectorCtx): { state: DirectorState; effects: DirectorEffect[] }` - pure.
  - `DirectorEffect` union: `{ type: 'seed'; count: number }` | `{ type: 'spawn' }` | `{ type: 'kill'; strategy: 'random'|'idle' }` | `{ type: 'crash' }` | `{ type: 'resetQueue' }`.

- [ ] **Step 1: types**

`server/src/services/director/types.ts`:
```typescript
/** Types for the Director: the pure cycle-engine state machine and its effects. */

export type DirectorPhase = 'seeding' | 'running' | 'complete' | 'paused';

export interface DirectorState {
    phase: DirectorPhase;
    cycle: number;
    nodeCount: number;
}

export interface DirectorCtx {
    queueDepth: number;
    activeCount: number;
    remaining: number; // frames not yet DONE
    minNodes: number;
    maxNodes: number;
    scaleUpDepth: number;
    scaleDownDepth: number;
    batchSize: number;
}

export type DirectorAction =
    | { type: 'tick' }
    | { type: 'pause' }
    | { type: 'resume' }
    | { type: 'reset' };

export type DirectorEffect =
    | { type: 'seed'; count: number }
    | { type: 'spawn' }
    | { type: 'kill'; strategy: 'random' | 'idle' }
    | { type: 'crash' }
    | { type: 'resetQueue' };
```

- [ ] **Step 2: Write failing tests**

`server/src/__tests__/reduceDirector.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { reduceDirector } from '../services/director/reduceDirector.js';
import type { DirectorCtx, DirectorState } from '../services/director/types.js';

const baseCtx: DirectorCtx = {
    queueDepth: 0,
    activeCount: 0,
    remaining: 0,
    minNodes: 2,
    maxNodes: 6,
    scaleUpDepth: 6,
    scaleDownDepth: 2,
    batchSize: 16,
};

const seeding: DirectorState = { phase: 'seeding', cycle: 1, nodeCount: 2 };

describe('reduceDirector', () => {
    it('seeds a batch and enters running on tick while seeding', () => {
        const { state, effects } = reduceDirector(seeding, { type: 'tick' }, baseCtx);
        expect(state.phase).toBe('running');
        expect(effects).toContainEqual({ type: 'seed', count: 16 });
    });

    it('scales up when queue depth exceeds threshold and below max nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 3 };
        const ctx = { ...baseCtx, queueDepth: 9, remaining: 9, activeCount: 3 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'spawn' });
    });

    it('does not scale beyond max nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 6 };
        const ctx = { ...baseCtx, queueDepth: 20, remaining: 20, activeCount: 6 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).not.toContainEqual({ type: 'spawn' });
    });

    it('scales down when draining and above min nodes', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 4 };
        const ctx = { ...baseCtx, queueDepth: 1, remaining: 2, activeCount: 1 };
        const { effects } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(effects).toContainEqual({ type: 'kill', strategy: 'idle' });
    });

    it('completes the cycle when nothing remains', () => {
        const running: DirectorState = { phase: 'running', cycle: 1, nodeCount: 2 };
        const ctx = { ...baseCtx, queueDepth: 0, remaining: 0, activeCount: 0 };
        const { state } = reduceDirector(running, { type: 'tick' }, ctx);
        expect(state.phase).toBe('complete');
    });

    it('resets into the next cycle', () => {
        const complete: DirectorState = { phase: 'complete', cycle: 1, nodeCount: 2 };
        const { state, effects } = reduceDirector(complete, { type: 'tick' }, baseCtx);
        expect(state.cycle).toBe(2);
        expect(state.phase).toBe('seeding');
        expect(effects).toContainEqual({ type: 'resetQueue' });
    });

    it('pause and resume gate ticks', () => {
        const paused = reduceDirector(seeding, { type: 'pause' }, baseCtx).state;
        expect(paused.phase).toBe('paused');
        const stillPaused = reduceDirector(paused, { type: 'tick' }, baseCtx);
        expect(stillPaused.effects).toHaveLength(0);
        const resumed = reduceDirector(paused, { type: 'resume' }, baseCtx).state;
        expect(resumed.phase).toBe('running');
    });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npm test -w server -- reduceDirector`
Expected: FAIL "reduceDirector is not a function".

- [ ] **Step 4: Implement**

`server/src/services/director/reduceDirector.ts`:
```typescript
/** Pure cycle-engine reducer: given state + action + observed context, returns next state and effects. */

import type { DirectorAction, DirectorCtx, DirectorEffect, DirectorState } from './types.js';

function paused(state: DirectorState): { state: DirectorState; effects: DirectorEffect[] } {
    return { state, effects: [] };
}

function seed(state: DirectorState, ctx: DirectorCtx): { state: DirectorState; effects: DirectorEffect[] } {
    return {
        state: { ...state, phase: 'running' },
        effects: [{ type: 'seed', count: ctx.batchSize }],
    };
}

function reset(state: DirectorState): { state: DirectorState; effects: DirectorEffect[] } {
    return {
        state: { ...state, phase: 'seeding', cycle: state.cycle + 1 },
        effects: [{ type: 'resetQueue' }],
    };
}

function run(state: DirectorState, ctx: DirectorCtx): { state: DirectorState; effects: DirectorEffect[] } {
    if (ctx.remaining === 0) {
        return { state: { ...state, phase: 'complete' }, effects: [] };
    }
    const effects: DirectorEffect[] = [];
    if (ctx.queueDepth >= ctx.scaleUpDepth && state.nodeCount < ctx.maxNodes) {
        effects.push({ type: 'spawn' });
    } else if (ctx.queueDepth <= ctx.scaleDownDepth && state.nodeCount > ctx.minNodes) {
        effects.push({ type: 'kill', strategy: 'idle' });
    }
    return { state, effects };
}

export function reduceDirector(
    state: DirectorState,
    action: DirectorAction,
    ctx: DirectorCtx,
): { state: DirectorState; effects: DirectorEffect[] } {
    if (action.type === 'pause') return { state: { ...state, phase: 'paused' }, effects: [] };
    if (action.type === 'resume') return { state: { ...state, phase: 'running' }, effects: [] };
    if (action.type === 'reset') return reset(state);
    if (state.phase === 'paused') return paused(state);
    if (state.phase === 'seeding') return seed(state, ctx);
    if (state.phase === 'complete') return reset(state);
    return run(state, ctx);
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm test -w server -- reduceDirector`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: director cycle-engine state machine with tests"
```

---

### Task 6: World-state merge (pure, unit tested)

**Files:**
- Create: `server/src/services/worldState/reduceWorldState.ts`
- Test: `server/src/__tests__/reduceWorldState.test.ts`

**Interfaces:**
- Produces:
  - `applyTelemetry(state: WorldState, msg: TelemetryMsg): WorldState` - upserts a node, updates the owning frame's stage/pct/nodeId.
  - `applyQueueEvent(state: WorldState, evt: { kind: 'added'|'active'|'completed'|'stalled'; frameId: string; nodeId?: string }): WorldState` - moves a frame between stages, updates totals.
  - `appendEvent(state: WorldState, level: EventLevel, message: string): WorldState` - pushes a `LogEvent` (cap 200, monotonic id).
  - `emptyWorld(cycle: number): WorldState`.
- Stage mapping: telemetry `stage` maps 1:1 to frame `stage`; `completed` queue event sets frame stage `DONE` and increments `totals.done`.

- [ ] **Step 1: Write failing tests**

`server/src/__tests__/reduceWorldState.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import {
    applyQueueEvent,
    applyTelemetry,
    appendEvent,
    emptyWorld,
} from '../services/worldState/reduceWorldState.js';

describe('reduceWorldState', () => {
    it('emptyWorld starts seeding with no frames', () => {
        const w = emptyWorld(1);
        expect(w.frames).toHaveLength(0);
        expect(w.cycle).toBe(1);
    });

    it('applyQueueEvent added inserts a QUEUED frame and bumps total', () => {
        const w = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        expect(w.frames[0]).toMatchObject({ id: 'f1', stage: 'QUEUED' });
        expect(w.totals.total).toBe(1);
    });

    it('applyTelemetry moves the frame to the reported stage and tags the node', () => {
        let w = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        w = applyTelemetry(w, {
            nodeId: 'node-1',
            pid: 10,
            state: 'rendering',
            frameId: 'f1',
            stage: 'RENDERING',
            pct: 40,
            completed: 0,
        });
        expect(w.frames[0]).toMatchObject({ stage: 'RENDERING', nodeId: 'node-1', pct: 40 });
        expect(w.nodes.find((n) => n.id === 'node-1')?.state).toBe('rendering');
    });

    it('applyQueueEvent completed sets DONE and increments done total', () => {
        let w = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        w = applyQueueEvent(w, { kind: 'completed', frameId: 'f1' });
        expect(w.frames[0].stage).toBe('DONE');
        expect(w.totals.done).toBe(1);
    });

    it('applyQueueEvent stalled returns the frame to QUEUED and clears its node', () => {
        let w = applyQueueEvent(emptyWorld(1), { kind: 'added', frameId: 'f1' });
        w = applyTelemetry(w, {
            nodeId: 'node-1', pid: 10, state: 'rendering', frameId: 'f1',
            stage: 'RENDERING', pct: 40, completed: 0,
        });
        w = applyQueueEvent(w, { kind: 'stalled', frameId: 'f1' });
        expect(w.frames[0]).toMatchObject({ stage: 'QUEUED', nodeId: null, pct: 0 });
    });

    it('appendEvent caps the log at 200 and assigns increasing ids', () => {
        let w = emptyWorld(1);
        for (let i = 0; i < 205; i += 1) w = appendEvent(w, 'info', `e${i}`);
        expect(w.events).toHaveLength(200);
        expect(w.events.at(-1)!.id).toBeGreaterThan(w.events[0].id);
    });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -w server -- reduceWorldState`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`server/src/services/worldState/reduceWorldState.ts`:
```typescript
/** Pure world-state reducers: merge queue-lifecycle events and worker telemetry into one snapshot. */

import type { EventLevel, Frame, TelemetryMsg, WorkerNode, WorldState } from '@demo/shared';

const MAX_EVENTS = 200;
let eventSeq = 0;

export function emptyWorld(cycle: number): WorldState {
    return {
        cycle,
        phase: 'seeding',
        frames: [],
        nodes: [],
        events: [],
        totals: { total: 0, done: 0 },
    };
}

export function appendEvent(state: WorldState, level: EventLevel, message: string): WorldState {
    eventSeq += 1;
    const events = [...state.events, { id: eventSeq, ts: Date.now(), level, message }];
    return { ...state, events: events.slice(-MAX_EVENTS) };
}

function upsertNode(nodes: WorkerNode[], patch: WorkerNode): WorkerNode[] {
    const exists = nodes.some((n) => n.id === patch.id);
    return exists ? nodes.map((n) => (n.id === patch.id ? patch : n)) : [...nodes, patch];
}

export function applyTelemetry(state: WorldState, msg: TelemetryMsg): WorldState {
    const node: WorkerNode = {
        id: msg.nodeId,
        pid: msg.pid,
        state: msg.state,
        frameId: msg.frameId,
        pct: msg.pct,
        completed: msg.completed,
    };
    const nodes = upsertNode(state.nodes, node);
    const frames = state.frames.map((f) =>
        f.id === msg.frameId && msg.stage
            ? { ...f, stage: msg.stage, nodeId: msg.nodeId, pct: msg.pct }
            : f,
    );
    return { ...state, nodes, frames };
}

export function applyQueueEvent(
    state: WorldState,
    evt: { kind: 'added' | 'active' | 'completed' | 'stalled'; frameId: string; nodeId?: string },
): WorldState {
    if (evt.kind === 'added') {
        const frame: Frame = {
            id: evt.frameId,
            cycle: state.cycle,
            priority: false,
            stage: 'QUEUED',
            nodeId: null,
            pct: 0,
        };
        return { ...state, frames: [...state.frames, frame], totals: { ...state.totals, total: state.totals.total + 1 } };
    }
    if (evt.kind === 'completed') {
        const frames = state.frames.map((f) =>
            f.id === evt.frameId ? { ...f, stage: 'DONE' as const, pct: 100 } : f,
        );
        return { ...state, frames, totals: { ...state.totals, done: state.totals.done + 1 } };
    }
    if (evt.kind === 'stalled') {
        const frames = state.frames.map((f) =>
            f.id === evt.frameId ? { ...f, stage: 'QUEUED' as const, nodeId: null, pct: 0 } : f,
        );
        return { ...state, frames };
    }
    return state; // 'active' handled via telemetry
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -w server -- reduceWorldState`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure world-state merge reducers with tests"
```

---

### Task 7: Node pool (fork/kill worker processes)

**Files:**
- Create: `server/src/services/nodePool/createNodePool.ts`

**Interfaces:**
- Consumes: `TUNABLES`.
- Produces: `createNodePool(deps): NodePool` where
  `NodePool = { spawn(): string; killRandom(): string | null; killIdle(idleIds: string[]): string | null; crashRandom(busyIds: string[]): string | null; size(): number; shutdown(): void }`.
  `spawn` forks `worker/src/index.ts` with a fresh `NODE_ID`, returns the id. `crashRandom` picks a busy node and `SIGKILL`s it (real death). `killIdle` gracefully `SIGTERM`s.

- [ ] **Step 1: Implement (thin process wrapper; verified via Task 10 end-to-end run, not a unit test - forking real processes in unit tests is covered by the Task 4 integration test)**

`server/src/services/nodePool/createNodePool.ts`:
```typescript
/** Manages worker child processes: spawn, graceful kill, and hard crash (real SIGKILL). */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TUNABLES } from '../../config/tunables.js';

const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));

export interface NodePoolDeps {
    onExit: (nodeId: string, crashed: boolean) => void;
}

export interface NodePool {
    spawn: () => string;
    killIdle: (idleIds: string[]) => string | null;
    crashRandom: (busyIds: string[]) => string | null;
    size: () => number;
    ids: () => string[];
    shutdown: () => void;
}

export function createNodePool(deps: NodePoolDeps): NodePool {
    const children = new Map<string, ChildProcess>();
    let counter = 0;

    function spawn(): string {
        counter += 1;
        const nodeId = `node-${counter}`;
        const child = fork(WORKER_ENTRY, [], {
            execArgv: ['--import', 'tsx'],
            env: {
                ...process.env,
                NODE_ID: nodeId,
                REDIS_URL: TUNABLES.redisUrl,
                STAGE_MS: String(TUNABLES.stageMs),
                LOCK_DURATION_MS: String(TUNABLES.lockDurationMs),
                STALLED_INTERVAL_MS: String(TUNABLES.stalledIntervalMs),
                MAX_STALLED_COUNT: String(TUNABLES.maxStalledCount),
            },
        });
        children.set(nodeId, child);
        child.on('exit', () => {
            const crashed = children.has(nodeId);
            children.delete(nodeId);
            deps.onExit(nodeId, crashed);
        });
        return nodeId;
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
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        children.delete(target); // remove first so onExit reports crashed=false vs graceful? keep simple below
        children.set(target, children.get(target) ?? (undefined as never));
        const child = children.get(target)!;
        child.kill('SIGKILL');
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
```

> Note for implementer: simplify `crashRandom` to just look up the child, `SIGKILL` it, and let the `exit` handler clean up. Do not double-manage the map. The `exit` handler is the single source of removal.

- [ ] **Step 2: Typecheck**

Run: `npm run build -w server`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: worker node pool with spawn, graceful kill, and hard crash"
```

---

### Task 8: WebSocket broadcaster + command handler + world store

**Files:**
- Create: `server/src/services/worldState/createWorldStore.ts`
- Create: `server/src/websocket/createBroadcaster.ts`
- Create: `server/src/websocket/handleCommand.ts`

**Interfaces:**
- Produces:
  - `createWorldStore()` holds a `WorldState`, exposes `get()`, `set(next)`, and the reducer helpers bound to internal state via `update(fn)`.
  - `createBroadcaster(wss, store, hz)` sends the full snapshot on connect and throttled snapshots on a timer.
  - `handleCommand(cmd, deps)` routes a `Command` to director actions / node-pool calls.

- [ ] **Step 1: world store**

`server/src/services/worldState/createWorldStore.ts`:
```typescript
/** In-memory holder for the current WorldState with an update helper. */

import type { WorldState } from '@demo/shared';
import { emptyWorld } from './reduceWorldState.js';

export interface WorldStore {
    get: () => WorldState;
    update: (fn: (state: WorldState) => WorldState) => void;
    reset: (cycle: number) => void;
}

export function createWorldStore(): WorldStore {
    let state = emptyWorld(1);
    return {
        get: () => state,
        update: (fn) => {
            state = fn(state);
        },
        reset: (cycle) => {
            state = emptyWorld(cycle);
        },
    };
}
```

- [ ] **Step 2: broadcaster**

`server/src/websocket/createBroadcaster.ts`:
```typescript
/** Broadcasts throttled WorldState snapshots to all connected WebSocket clients. */

import type { WebSocketServer } from 'ws';
import type { WorldStore } from '../services/worldState/createWorldStore.js';

export function createBroadcaster(wss: WebSocketServer, store: WorldStore, hz: number): () => void {
    wss.on('connection', (socket) => {
        socket.send(JSON.stringify({ type: 'snapshot', state: store.get() }));
    });
    const timer = setInterval(() => {
        const payload = JSON.stringify({ type: 'snapshot', state: store.get() });
        for (const client of wss.clients) {
            if (client.readyState === client.OPEN) client.send(payload);
        }
    }, Math.round(1000 / hz));
    return () => clearInterval(timer);
}
```

- [ ] **Step 3: command handler**

`server/src/websocket/handleCommand.ts`:
```typescript
/** Routes a client Command to the director and node pool (same path the autonomous director uses). */

import type { Command } from '@demo/shared';

export interface CommandDeps {
    pause: () => void;
    resume: () => void;
    inject: (count: number) => void;
    killNode: () => void;
    reset: () => void;
}

export function handleCommand(cmd: Command, deps: CommandDeps): void {
    if (cmd.type === 'pause') return deps.pause();
    if (cmd.type === 'resume') return deps.resume();
    if (cmd.type === 'inject') return deps.inject(cmd.count ?? 5);
    if (cmd.type === 'killNode') return deps.killNode();
    if (cmd.type === 'reset') return deps.reset();
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run build -w server`
Expected: exits 0.
```bash
git add -A
git commit -m "feat: world store, ws broadcaster, and command handler"
```

---

### Task 9: Director runtime + server bootstrap (wires everything)

**Files:**
- Create: `server/src/services/director/runDirector.ts`
- Create: `server/src/services/telemetry/subscribeTelemetry.ts`
- Create: `server/src/index.ts`

**Interfaces:**
- Consumes: all prior server modules.
- Produces: a running orchestrator. `runDirector` owns a `DirectorState`, on each randomized tick calls `reduceDirector`, applies effects (seed frames via queue, spawn/kill/crash via node pool, resetQueue via `queue.obliterate` + `store.reset`), and appends log events. Occasionally injects a crash effect on RUN ticks (probability-based) independent of scaling.

- [ ] **Step 1: telemetry subscriber**

`server/src/services/telemetry/subscribeTelemetry.ts`:
```typescript
/** Subscribes to the worker telemetry channel and folds each message into the world store. */

import type { Redis } from 'ioredis';
import { TELEMETRY_CHANNEL, type TelemetryMsg } from '@demo/shared';
import type { WorldStore } from '../worldState/createWorldStore.js';
import { applyTelemetry } from '../worldState/reduceWorldState.js';

export function subscribeTelemetry(subscriber: Redis, store: WorldStore): void {
    void subscriber.subscribe(TELEMETRY_CHANNEL);
    subscriber.on('message', (_channel, raw) => {
        const msg = JSON.parse(raw) as TelemetryMsg;
        store.update((state) => applyTelemetry(state, msg));
    });
}
```

- [ ] **Step 2: director runtime**

`server/src/services/director/runDirector.ts`:
```typescript
/** Drives the Director: randomized ticks, applies effects to the queue and node pool, logs events. */

import type { Queue } from 'bullmq';
import { QUEUE_NAME } from '@demo/shared';
import { TUNABLES } from '../../config/tunables.js';
import type { NodePool } from '../nodePool/createNodePool.js';
import type { WorldStore } from '../worldState/createWorldStore.js';
import { appendEvent } from '../worldState/reduceWorldState.js';
import { reduceDirector } from './reduceDirector.js';
import type { DirectorAction, DirectorState } from './types.js';

const CRASH_PROB_PER_TICK = 0.25;

export interface DirectorRuntime {
    dispatch: (action: DirectorAction) => void;
    seed: (count: number) => Promise<void>;
    stop: () => void;
    killNodeNow: () => void;
}

export function runDirector(queue: Queue, pool: NodePool, store: WorldStore): DirectorRuntime {
    let state: DirectorState = { phase: 'seeding', cycle: 1, nodeCount: pool.size() };
    let timer: NodeJS.Timeout;
    let frameSeq = 0;

    async function seed(count: number): Promise<void> {
        for (let i = 0; i < count; i += 1) {
            frameSeq += 1;
            const frameId = `f${state.cycle}-${frameSeq}`;
            const priority = Math.random() < TUNABLES.highPriorityRatio;
            await queue.add(
                'frame',
                { frameId, cycle: state.cycle, priority },
                { jobId: frameId, priority: priority ? 1 : 5, attempts: TUNABLES.jobAttempts },
            );
        }
        store.update((s) => appendEvent(s, 'info', `seeded ${count} frames for cycle ${state.cycle}`));
    }

    async function applyEffects(effects: ReturnType<typeof reduceDirector>['effects']): Promise<void> {
        for (const effect of effects) {
            if (effect.type === 'seed') await seed(effect.count);
            if (effect.type === 'spawn') {
                const id = pool.spawn();
                state = { ...state, nodeCount: pool.size() };
                store.update((s) => appendEvent(s, 'success', `autoscaling up: ${id} spawned`));
            }
            if (effect.type === 'kill') {
                const idle = store.get().nodes.filter((n) => n.state === 'idle').map((n) => n.id);
                const killed = pool.killIdle(idle);
                if (killed) store.update((s) => appendEvent(s, 'warn', `autoscaling down: ${killed} retired`));
            }
            if (effect.type === 'resetQueue') {
                await queue.obliterate({ force: true }).catch(() => undefined);
                store.reset(state.cycle);
                store.update((s) => appendEvent(s, 'info', `cycle ${state.cycle} starting`));
            }
        }
    }

    function maybeCrash(): void {
        if (state.phase !== 'running') return;
        if (Math.random() > CRASH_PROB_PER_TICK) return;
        const busy = store.get().nodes.filter((n) => n.state !== 'idle').map((n) => n.id);
        if (busy.length <= 1) return;
        const crashed = pool.crashRandom(busy);
        if (crashed) {
            store.update((s) => appendEvent(s, 'danger', `${crashed} crashed (SIGKILL); frame orphaned`));
        }
    }

    async function tick(): Promise<void> {
        const counts = await queue.getJobCounts('waiting', 'active', 'prioritized');
        const world = store.get();
        const remaining = world.totals.total === 0 ? 1 : world.totals.total - world.totals.done;
        const result = reduceDirector(
            state,
            { type: 'tick' },
            {
                queueDepth: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
                activeCount: counts.active ?? 0,
                remaining: world.phase === 'seeding' ? 1 : remaining,
                minNodes: TUNABLES.minNodes,
                maxNodes: TUNABLES.maxNodes,
                scaleUpDepth: TUNABLES.scaleUpDepth,
                scaleDownDepth: TUNABLES.scaleDownDepth,
                batchSize: TUNABLES.batchSize,
            },
        );
        state = result.state;
        store.update((s) => ({ ...s, phase: state.phase, cycle: state.cycle }));
        await applyEffects(result.effects);
        maybeCrash();
        schedule();
    }

    function schedule(): void {
        const span = TUNABLES.tickMaxMs - TUNABLES.tickMinMs;
        const delay = TUNABLES.tickMinMs + Math.random() * span;
        timer = setTimeout(() => void tick(), delay);
    }

    schedule();

    return {
        dispatch: (action) => {
            state = reduceDirector(state, action, {
                queueDepth: 0, activeCount: 0, remaining: 1,
                minNodes: TUNABLES.minNodes, maxNodes: TUNABLES.maxNodes,
                scaleUpDepth: TUNABLES.scaleUpDepth, scaleDownDepth: TUNABLES.scaleDownDepth,
                batchSize: TUNABLES.batchSize,
            }).state;
            store.update((s) => ({ ...s, phase: state.phase }));
        },
        seed,
        stop: () => clearTimeout(timer),
        killNodeNow: () => {
            const busy = store.get().nodes.filter((n) => n.state !== 'idle').map((n) => n.id);
            const crashed = pool.crashRandom(busy.length ? busy : pool.ids());
            if (crashed) store.update((s) => appendEvent(s, 'danger', `${crashed} killed by operator`));
        },
    };
}
```

- [ ] **Step 3: server bootstrap**

`server/src/index.ts`:
```typescript
/** Orchestrator bootstrap: Redis, queue, queue-events wiring, node pool, director, and WebSocket server. */

import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { Command } from '@demo/shared';
import { TUNABLES } from './config/tunables.js';
import { createRedisConnection } from './clients/redis/createRedisConnection.js';
import { createRenderQueue } from './queue/createRenderQueue.js';
import { createQueueEvents } from './queue/createQueueEvents.js';
import { createNodePool } from './services/nodePool/createNodePool.js';
import { createWorldStore } from './services/worldState/createWorldStore.js';
import { applyQueueEvent, appendEvent } from './services/worldState/reduceWorldState.js';
import { subscribeTelemetry } from './services/telemetry/subscribeTelemetry.js';
import { runDirector } from './services/director/runDirector.js';
import { createBroadcaster } from './websocket/createBroadcaster.js';
import { handleCommand } from './websocket/handleCommand.js';

const store = createWorldStore();
const queue = createRenderQueue(createRedisConnection());
const queueEvents = createQueueEvents(createRedisConnection());
subscribeTelemetry(createRedisConnection(), store);

const pool = createNodePool({
    onExit: (nodeId, crashed) => {
        store.update((s) => ({ ...s, nodes: s.nodes.filter((n) => n.id !== nodeId) }));
        if (crashed) store.update((s) => appendEvent(s, 'warn', `${nodeId} process exited`));
    },
});
for (let i = 0; i < TUNABLES.minNodes; i += 1) pool.spawn();

queueEvents.on('added', ({ jobId }) => store.update((s) => applyQueueEvent(s, { kind: 'added', frameId: jobId })));
queueEvents.on('completed', ({ jobId }) =>
    store.update((s) => appendEvent(applyQueueEvent(s, { kind: 'completed', frameId: jobId }), 'success', `frame ${jobId} done`)),
);
queueEvents.on('stalled', ({ jobId }) =>
    store.update((s) => appendEvent(applyQueueEvent(s, { kind: 'stalled', frameId: jobId }), 'warn', `frame ${jobId} stalled; re-queued`)),
);

const director = runDirector(queue, pool, store);

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

createBroadcaster(wss, store, TUNABLES.broadcastHz);

wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
        const cmd = JSON.parse(raw.toString()) as Command;
        handleCommand(cmd, {
            pause: () => director.dispatch({ type: 'pause' }),
            resume: () => director.dispatch({ type: 'resume' }),
            inject: (count) => void director.seed(count),
            killNode: () => director.killNodeNow(),
            reset: () => director.dispatch({ type: 'reset' }),
        });
    });
});

httpServer.listen(TUNABLES.httpPort, () => {
    // eslint-disable-next-line no-console
    console.log(`orchestrator on :${TUNABLES.httpPort}`);
});
```

- [ ] **Step 4: End-to-end smoke (no UI yet)**

Run: `docker compose up -d && npm run dev:server`
In another shell: `npx wscat -c ws://localhost:3001` (or a small node script) and observe snapshot messages with frames advancing and occasional crash/stall events.
Expected: frames appear, move through stages, complete; a crash event appears within a cycle and the orphaned frame later completes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: director runtime and orchestrator bootstrap wiring"
```

---

### Task 10: Web client - state hook + shell

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/global.scss`
- Create: `web/src/state/useWorldState.ts`, `web/src/state/useCommands.ts`

**Interfaces:**
- Consumes: `@demo/shared` types, `WorldState` snapshot messages from `ws://localhost:3001`.
- Produces: `useWorldState(): WorldState` and `useCommands(): (cmd: Command) => void`.

- [ ] **Step 1: web package + config**

`web/package.json`:
```json
{
  "name": "web",
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc && vite build", "preview": "vite preview" },
  "dependencies": { "@demo/shared": "*", "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "sass": "^1.83.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.5"
  }
}
```

`web/vite.config.ts`:
```typescript
/** Vite config for the render-farm SPA: React plugin and a proxy to the orchestrator WebSocket. */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
```

`web/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": [] },
  "include": ["src"]
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Render Farm - Distributed Demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: state hooks**

`web/src/state/useWorldState.ts`:
```typescript
/** Subscribes to the orchestrator WebSocket and returns the latest WorldState snapshot. */

import { useEffect, useState } from 'react';
import type { WorldState } from '@demo/shared';

const WS_URL = 'ws://localhost:3001';

const EMPTY: WorldState = {
    cycle: 0, phase: 'seeding', frames: [], nodes: [], events: [], totals: { total: 0, done: 0 },
};

export function useWorldState(): WorldState {
    const [state, setState] = useState<WorldState>(EMPTY);
    useEffect(() => {
        const socket = new WebSocket(WS_URL);
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data) as { type: string; state: WorldState };
            if (msg.type === 'snapshot') setState(msg.state);
        };
        return () => socket.close();
    }, []);
    return state;
}
```

`web/src/state/useCommands.ts`:
```typescript
/** Opens a command WebSocket to the orchestrator and returns a send function for Commands. */

import { useEffect, useRef } from 'react';
import type { Command } from '@demo/shared';

const WS_URL = 'ws://localhost:3001';

export function useCommands(): (cmd: Command) => void {
    const socketRef = useRef<WebSocket | null>(null);
    useEffect(() => {
        const socket = new WebSocket(WS_URL);
        socketRef.current = socket;
        return () => socket.close();
    }, []);
    return (cmd: Command) => {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
    };
}
```

- [ ] **Step 3: shell + global styles**

`web/src/styles/global.scss`:
```scss
:root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --info: #58a6ff;
    --success: #3fb950;
    --warn: #d29922;
    --danger: #f85149;
    --priority: #bc8cff;
}

* { box-sizing: border-box; }

body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

@media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
}
```

`web/src/App.tsx`:
```tsx
/** Root layout: header + controls, Kanban board, worker-node strip, and event log. */

import { useWorldState } from './state/useWorldState.js';
import { useCommands } from './state/useCommands.js';
import { ControlBar } from './components/ControlBar/ControlBar.js';
import { KanbanBoard } from './components/KanbanBoard/KanbanBoard.js';
import { NodeStrip } from './components/NodeStrip/NodeStrip.js';
import { EventLog } from './components/EventLog/EventLog.js';

export function App() {
    const world = useWorldState();
    const send = useCommands();
    return (
        <main style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 style={{ fontSize: 18, margin: 0 }}>
                    Render Farm . Cycle #{world.cycle} . {world.totals.done}/{world.totals.total} done .{' '}
                    {world.nodes.length} nodes . {world.phase}
                </h1>
                <ControlBar phase={world.phase} onCommand={send} />
            </header>
            <KanbanBoard frames={world.frames} />
            <NodeStrip nodes={world.nodes} />
            <EventLog events={world.events} />
        </main>
    );
}
```

`web/src/main.tsx`:
```tsx
/** SPA entry: mounts the App and imports global styles. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.scss';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
```

- [ ] **Step 4: Commit (components stubbed next task; create placeholder files so it builds)**

Create minimal placeholder component files that export the named components with the props used above, then:
```bash
git add -A
git commit -m "feat: web client shell, ws state hooks, global styles"
```

---

### Task 11: Web client - the four view components

**Files:**
- Create: `web/src/components/KanbanBoard/KanbanBoard.tsx` + `.module.scss`
- Create: `web/src/components/NodeStrip/NodeStrip.tsx` + `.module.scss`
- Create: `web/src/components/EventLog/EventLog.tsx` + `.module.scss`
- Create: `web/src/components/ControlBar/ControlBar.tsx` + `.module.scss`

**Interfaces:**
- Consumes: `Frame`, `WorkerNode`, `LogEvent`, `Command`, `Stage` from `@demo/shared`, plus `STAGES`.

- [ ] **Step 1: KanbanBoard**

`web/src/components/KanbanBoard/KanbanBoard.tsx`:
```tsx
/** Kanban board: one column per stage, frame cards tagged with owning node and priority. */

import type { Frame } from '@demo/shared';
import { STAGES } from '@demo/shared';
import styles from './KanbanBoard.module.scss';

interface Props {
    frames: Frame[];
}

export function KanbanBoard({ frames }: Props) {
    return (
        <section className={styles.board} aria-label="render pipeline">
            {STAGES.map((stage) => {
                const columnFrames = frames.filter((f) => f.stage === stage);
                return (
                    <div key={stage} className={styles.column}>
                        <h2 className={styles.columnTitle}>
                            {stage} <span className={styles.count}>{columnFrames.length}</span>
                        </h2>
                        <ul className={styles.cards}>
                            {columnFrames.map((frame) => (
                                <li
                                    key={frame.id}
                                    className={`${styles.card} ${frame.priority ? styles.priority : ''}`}
                                >
                                    <span>{frame.id}</span>
                                    {frame.nodeId && <span className={styles.node}>{frame.nodeId}</span>}
                                    {frame.pct > 0 && frame.stage !== 'DONE' && (
                                        <span
                                            className={styles.bar}
                                            style={{ width: `${frame.pct}%` }}
                                            aria-hidden="true"
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}
```

`web/src/components/KanbanBoard/KanbanBoard.module.scss`:
```scss
.board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.column { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px; min-height: 220px; }
.columnTitle { font-size: 12px; color: var(--muted); margin: 0 0 8px; display: flex; justify-content: space-between; }
.count { color: var(--text); }
.cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.card { position: relative; overflow: hidden; background: #1f2630; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; display: flex; justify-content: space-between; gap: 8px; }
.priority { border-color: var(--priority); box-shadow: 0 0 0 1px var(--priority) inset; }
.node { color: var(--info); }
.bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--success); transition: width 0.3s ease; }
```

- [ ] **Step 2: NodeStrip**

`web/src/components/NodeStrip/NodeStrip.tsx`:
```tsx
/** Worker-node strip: one card per live process with status, current frame, and progress. */

import type { WorkerNode } from '@demo/shared';
import styles from './NodeStrip.module.scss';

interface Props {
    nodes: WorkerNode[];
}

export function NodeStrip({ nodes }: Props) {
    return (
        <section className={styles.strip} aria-label="worker nodes">
            {nodes.map((node) => (
                <article key={node.id} className={`${styles.node} ${styles[node.state] ?? ''}`}>
                    <header className={styles.head}>
                        <strong>{node.id}</strong>
                        <span className={styles.pid}>pid {node.pid}</span>
                    </header>
                    <div className={styles.state}>{node.state}</div>
                    <div className={styles.frame}>{node.frameId ?? 'idle'}</div>
                    <div className={styles.track}>
                        <span className={styles.fill} style={{ width: `${node.pct}%` }} aria-hidden="true" />
                    </div>
                    <footer className={styles.done}>{node.completed} done</footer>
                </article>
            ))}
        </section>
    );
}
```

`web/src/components/NodeStrip/NodeStrip.module.scss`:
```scss
.strip { display: flex; gap: 12px; flex-wrap: wrap; }
.node { width: 160px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px; font-size: 12px; }
.head { display: flex; justify-content: space-between; }
.pid { color: var(--muted); }
.state { margin: 4px 0; color: var(--info); text-transform: capitalize; }
.crashed { border-color: var(--danger); }
.crashed .state { color: var(--danger); }
.spawning { border-color: var(--warn); border-style: dashed; }
.frame { color: var(--muted); }
.track { height: 6px; background: #0d1117; border-radius: 4px; overflow: hidden; margin: 6px 0; }
.fill { display: block; height: 100%; background: var(--success); transition: width 0.3s ease; }
.done { color: var(--muted); }
```

- [ ] **Step 3: EventLog**

`web/src/components/EventLog/EventLog.tsx`:
```tsx
/** Scrolling, color-coded event log narrating what the graphics show. */

import type { LogEvent } from '@demo/shared';
import styles from './EventLog.module.scss';

interface Props {
    events: LogEvent[];
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
}

export function EventLog({ events }: Props) {
    return (
        <section className={styles.log} aria-label="event log" aria-live="polite">
            <ul className={styles.list}>
                {[...events].reverse().map((event) => (
                    <li key={event.id} className={`${styles.row} ${styles[event.level]}`}>
                        <time>{formatTime(event.ts)}</time>
                        <span>{event.message}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
```

`web/src/components/EventLog/EventLog.module.scss`:
```scss
.log { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; height: 220px; overflow-y: auto; padding: 8px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.row { display: flex; gap: 10px; padding: 2px 4px; }
.row time { color: var(--muted); flex-shrink: 0; }
.info span { color: var(--text); }
.success span { color: var(--success); }
.warn span { color: var(--warn); }
.danger span { color: var(--danger); }
```

- [ ] **Step 4: ControlBar**

`web/src/components/ControlBar/ControlBar.tsx`:
```tsx
/** Operator controls: pause/resume, inject frames, kill a node, reset the cycle. */

import type { Command, WorldState } from '@demo/shared';
import styles from './ControlBar.module.scss';

interface Props {
    phase: WorldState['phase'];
    onCommand: (cmd: Command) => void;
}

export function ControlBar({ phase, onCommand }: Props) {
    const paused = phase === 'paused';
    return (
        <div className={styles.bar}>
            <button type="button" onClick={() => onCommand({ type: paused ? 'resume' : 'pause' })}>
                {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={() => onCommand({ type: 'inject', count: 5 })}>
                + Inject 5
            </button>
            <button type="button" onClick={() => onCommand({ type: 'killNode' })}>
                Kill a node
            </button>
            <button type="button" onClick={() => onCommand({ type: 'reset' })}>
                Reset
            </button>
        </div>
    );
}
```

`web/src/components/ControlBar/ControlBar.module.scss`:
```scss
.bar { display: flex; gap: 8px; }
.bar button {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font: inherit;
    cursor: pointer;
}
.bar button:hover { border-color: var(--info); }
.bar button:focus-visible { outline: 2px solid var(--info); outline-offset: 2px; }
```

- [ ] **Step 5: Full-system run**

Run: `docker compose up -d && npm run dev`
Open `http://localhost:5173`.
Expected: frames flow QUEUED to DONE; nodes show live progress; autoscaling adds/removes node cards; a crash flashes a node red and its frame returns to QUEUED then completes; cycle resets and repeats. Controls work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: kanban board, node strip, event log, and control bar"
```

---

### Task 12: README + optional Playwright smoke

**Files:**
- Create: `README.md`
- Optional: `web/e2e/cycle.spec.ts`, `playwright.config.ts`

**Interfaces:** none (documentation + optional test).

- [ ] **Step 1: README**

`README.md` covering: what it is, the architecture diagram, `docker compose up -d` + `npm install` + `npm run dev`, the tunables table, the four behaviors and where to see each, and the crash-recovery note (real SIGKILL + stalled recovery; soft-crash fallback if timing is fragile).

- [ ] **Step 2 (optional): Playwright smoke**

A single test that loads `http://localhost:5173`, waits up to 60s, and asserts the "done" count reaches "total" at least once (a full cycle completes). Only add if you want CI coverage; the running app is otherwise its own acceptance test.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: readme and optional e2e smoke"
```

---

## Self-Review Notes

- **Spec coverage:** load balancing (shared queue, Task 3/9), fault tolerance (Task 4 validates, Task 7/9 crash, Task 6/9 stalled re-queue), autoscaling (Task 5 reducer, Task 7 pool, Task 9 effects), priorities (Task 9 seed `priority`, Task 11 card style); cyclical director (Task 5/9); event log + Kanban + node strip + controls (Task 10/11); WebSocket transport with connect snapshot (Task 8); Docker Redis (Task 1); testing unit + integration (Tasks 4/5/6).
- **Risk front-loaded:** Task 4 validates stalled-recovery timing before UI work, per the spec's flagged risk, with the soft-crash fallback documented.
- **Implementer note on `crashRandom`:** simplify to look up child, `SIGKILL`, let the `exit` handler remove it (do not double-manage the map).
- **Priority visibility:** frame `priority` is set at seed time in the queue job data but the world frame is created from the `added` queue event (default `priority: false`). Implementer should carry priority through: either read job data on `added` (async `Job.fromId`) or include priority in a separate telemetry/first-progress update. Simplest: in `applyTelemetry`, if the frame's owning job was high-priority, the worker includes `priority` in `TelemetryMsg`. Add `priority: boolean` to `TelemetryMsg` and set the frame's priority on first telemetry. (Add this field in Task 1 if you want it wired end-to-end from the start.)
```
