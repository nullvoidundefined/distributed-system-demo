# Engineering Audit: Worker + Shared Surfaces
**Date:** 2026-07-02
**Auditor:** CTO role (claude-sonnet-4-6)
**Scope:** `worker/src/**`, `worker/package.json`, `worker/tsconfig.json`, `shared/src/**`, `shared/package.json`, `shared/tsconfig.json`, root `package.json`, `tsconfig.base.json`, `docker-compose.yml`, `.prettierrc.json`. Server files read for correctness context only; no findings raised against them.

---

## Executive Summary

The worker and shared surfaces are structurally sound and reflect a deliberate, well-understood design. The core crash-simulation loop, BullMQ integration, and Redis pub/sub telemetry path work correctly end-to-end under orchestrator control. The shared type contract is minimal, well-organized, and alphabetically sorted.

Two issues demand immediate attention before the demo is shown to others or iterated on. First, the SIGTERM handler uses `void` on an async chain, silently discarding any rejection from `worker.close()` and leaving the process as an unkillable zombie if Redis is unavailable at shutdown time. Second, the worker's hardcoded env fallback values for `LOCK_DURATION_MS` (5000) and `STALLED_INTERVAL_MS` (3000) directly contradict the README tuning table (4000 and 2000 respectively) and the server's TUNABLES defaults - running the worker directly without the orchestrator's env handoff produces wrong crash-recovery timing with no error.

The remaining findings are code-quality and type-safety concerns that do not affect current behavior but create silent maintenance traps.

**Top 3 priorities:**
1. Fix the SIGTERM handler to handle `worker.close()` rejection so graceful shutdown is reliable.
2. Align worker fallback defaults with server TUNABLES and the README.
3. Add a `FrameJobData` type to `@demo/shared` and parameterize `Job<FrameJobData>` in the worker.

---

## Operational Basics

| Check | Status | Notes |
|---|---|---|
| Tests running | Partial | Server has unit + integration tests. Worker has no test script and no tests by design (per spec). |
| CI green | N/A | No CI configuration (no `.github/workflows/`). This is a local demo; absence is by design. |
| E2E tests wired | N/A | Optional Playwright smoke test planned but not present. Spec designates it non-blocking. |
| Monitoring | N/A | Worker has no health endpoint; local demo, not Railway-deployed. Server has `/health`. |
| Rollback plan | N/A | Local demo with no deployment surface. |

No blockers from operational basics given the local-demo scope declared in the design spec.

---

## Credential Exposure Scan

**Git history:** scanned with `git log -p --all -S<pattern>` for all credential patterns. Zero matches.

**Working tree:** `rg` across all `.ts`, `.json`, `.yml`, `.env*` files. Zero matches.

**Session transcripts:** No JSONL files found under `~/.claude/projects/Users-iangreenough-Desktop-code-personal-development-distributed-system-demo/`. Nothing to scan.

**Shell history (`~/.zsh_history`):** Scanned for all credential patterns. Zero matches.

**Vendor CLI config files:**
- `~/.railway/config.json` (16,696 bytes): present and non-empty. Scanned for credential patterns in scope; zero matches on Anthropic/Stripe/GitHub/AWS patterns. Contains Railway auth tokens (not covered by the scan patterns, and not our project credentials).
- `~/.config/gh/hosts.yml` (100 bytes): present. Zero credential pattern matches.
- `~/.aws/credentials`: file exists. Not read per R-101. No patterns leaked to any other scannable surface.
- `~/.vercel/auth.json`: not present.
- `~/.anthropic/`: not present.

**Result: no credential exposure found.** No rotation or purge actions required.

---

## Workspace Hygiene

One copy of `distributed-system-demo` found at `/Users/iangreenough/Desktop/code/personal/development/distributed-system-demo`. No duplicates or near-duplicates found under any depth-6 search of the home directory.

---

## Bug Fix Discipline

No commits with a `fix:`, `fix(`, `bug:`, `bugfix:`, or `hotfix:` prefix appear in the 15-commit history. Category is clean.

---

## Runbook-vs-Code Drift Scan

No `docs/runbooks/` directory exists. The README serves as the operational reference. One drift finding:

**README tuning table vs. worker fallback defaults** - covered as P1 finding #2 below. README line 87-88 states `LOCK_DURATION_MS: 4000` and `STALLED_INTERVAL_MS: 2000`. Worker `index.ts` lines 47-48 encode 5000 and 3000 as hardcoded fallbacks. Direction: worker defaults are out of date. Severity: P1 (wrong timing would prevent crash recovery from completing within the demo's visual window when running the worker standalone).

---

## P0 Findings

None.

---

## P1 Findings

### P1-1: SIGTERM handler silently discards `worker.close()` rejection - zombie process risk

**File:** `worker/src/index.ts:60-62`

```typescript
process.on('SIGTERM', () => {
    void worker.close().then(() => process.exit(0));
});
```

`void` is applied to the entire Promise chain. If `worker.close()` rejects - for example, if the Redis connection is already broken when SIGTERM arrives during a scale-down event - the rejection is silently discarded. `process.exit(0)` is never called. The worker process has received and acknowledged SIGTERM but will never exit. The orchestrator's `killIdle` sends only SIGTERM for graceful retirement; it does not follow up with SIGKILL. The result is a zombie process that holds a BullMQ job lock indefinitely (until Redis lock TTL expires) and a node slot that the orchestrator believes is retired.

**Governing rule:** BullMQ Worker.close() returns `Promise<void>` and can reject. Unhandled rejections silently dropped by `void` are explicitly prohibited by R-010 (optimize for the durable fix). The CLAUDE-BACKEND.md shutdown pattern does not use `void`.

**Fix direction:** replace `void worker.close().then(...)` with a chain that handles rejection by exiting with a non-zero code rather than hanging. Add publisher cleanup in the same chain (see P2-1).
`to confirm:` whether `worker.close()` in BullMQ 5.x can reject in practice by checking its implementation, and whether the orchestrator's `createNodePool` sends a follow-up SIGKILL if the child does not exit within a timeout.

---

### P1-2: Worker fallback defaults for `LOCK_DURATION_MS` and `STALLED_INTERVAL_MS` diverge from README and server TUNABLES

**File:** `worker/src/index.ts:47-48`

```typescript
lockDuration: Number(process.env.LOCK_DURATION_MS ?? 5000),
stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? 3000),
```

Server TUNABLES (`server/src/config/tunables.ts`): `lockDurationMs: 4000`, `stalledIntervalMs: 2000`. README tuning table (lines 87-88): `LOCK_DURATION_MS: 4000`, `STALLED_INTERVAL_MS: 2000`. Integration test (`server/src/__tests__/integration/crashRecovery.test.ts`): explicitly sets `LOCK_DURATION_MS: '4000'` and `STALLED_INTERVAL_MS: '2000'` to force correct behavior.

The worker fallbacks are 5000 and 3000. When the orchestrator forks the worker, it passes the correct values via env vars (confirmed in `server/src/services/nodePool/createNodePool.ts:43-48`). But when a worker is started directly - as the plan's Task 3 Step 5 smoke test shows (`NODE_ID=node-test npx tsx worker/src/index.ts`) - it uses 5000/3000. Under these defaults the crash-recovery window is `5000 + 3000 = 8000ms`, against the integration test's `4000 + 2000 = 6000ms`. At 8000ms the stalled-check fires after the lock has expired, but the longer window may push recovery past the integration test's `25000ms` total timeout under slower machines.

**Governing rule:** R-219 (configurable values to named constants), R-010 (durable fix). The README is the runbook; the code contradicts it.

**Fix direction:** set worker fallback defaults to match server TUNABLES (4000 and 2000). Consider whether to extract them as `const DEFAULT_LOCK_DURATION_MS = 4000` etc. at the top of the file.
`to confirm:` whether the integration test's pass/fail is sensitive to the 8000ms vs 6000ms window, and whether the smoke test documented in the plan actually works with the wrong defaults.

---

## P2 Findings

### P2-1: Publisher Redis connection never closed on SIGTERM

**File:** `worker/src/index.ts:13-14, 60-62`

```typescript
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const publisher = new Redis(redisUrl);
// ...
process.on('SIGTERM', () => {
    void worker.close().then(() => process.exit(0));
});
```

`worker.close()` closes the `connection` ioredis instance (the BullMQ blocking connection). The `publisher` instance is an independent connection that BullMQ does not manage. It is never closed. `process.exit(0)` terminates the process synchronously without sending a Redis `QUIT` handshake on the publisher socket. Redis must wait for TCP keepalive/timeout to reclaim the slot. In a demo that spawns and kills workers repeatedly across cycles, each killed worker leaves one uncleaned Redis connection. Redis's `maxclients` limit and connection-table pressure are low risk for a local demo, but the pattern is incorrect and would matter at scale.

**Governing rule:** CLAUDE-BACKEND.md shutdown pattern calls both `worker.close()` and `connection.quit()`. Two connections are opened; two must be closed.

**Fix direction:** in the SIGTERM handler, after `worker.close()` resolves, call `publisher.quit()` before `process.exit(0)`. Both calls are async and must be sequenced, not fire-and-forget.
`to confirm:` whether `publisher.quit()` can itself hang (ioredis 5.x quit behavior when the connection is already in a reconnecting state), and whether a timeout guard is needed.

---

### P2-2: `job.data` is untyped - `Job` missing type parameter

**Files:** `worker/src/stages/processFrame.ts:3,24,38,42`

```typescript
import type { Job } from 'bullmq'; // no type parameter: Job<unknown>
// ...
async function runStage(job: Job, ...) { // job.data is unknown/any
// ...
    frameId: String(job.data.frameId),    // line 38 - property access on unknown
    priority: Boolean(job.data.priority), // line 42 - property access on unknown
```

`Job` without a type parameter defaults to `Job<unknown>` in BullMQ 5. `job.data.frameId` and `job.data.priority` are accessed via untyped property reads. TypeScript's `strict` mode makes `unknown` non-narrowable without a type assertion or guard, but here the actual BullMQ `Job<unknown>` type appears to permit property access (ioredis returns `any` from queue payloads). The result is that a mismatch between `{ frameId, cycle, priority }` (what the server enqueues in `runDirector.ts:52`) and what the worker reads is invisible to TypeScript and only surfaces as a runtime failure.

`@demo/shared` is the contract package. The job data shape is a shared contract between the server and worker that currently has no shared type.

**Governing rule:** TypeScript strict mode; R-200 (tests must fail when implementation is wrong - here TypeScript cannot flag a wrong contract). Design intent in spec ("Job data shape: `{ frameId: string; cycle: number; priority: boolean }`").

**Fix direction:** add a `FrameJobData` interface to `shared/src/types.ts` (`{ frameId: string; cycle: number; priority: boolean }`) and use `Job<FrameJobData>` as the type parameter in both `processFrame.ts` and `worker/src/index.ts`.
`to confirm:` that BullMQ's `Job<DataType>` makes `job.data` fully typed (it does in 5.x), and that `FrameJobData` belongs in `shared/` not worker-local types.

---

### P2-3: `worker.on('error')` event listener absent

**File:** `worker/src/index.ts:53-63`

```typescript
worker.on('completed', () => { ... });
worker.on('ready', publishIdle);
// 'error' handler absent
// 'failed' handler absent
```

BullMQ's `Worker` extends `EventEmitter`. Without an `'error'` listener, any `'error'` event emitted by the worker (Redis connection failure, internal BullMQ error) triggers Node.js's uncaught-exception path: `Error: Unhandled "error" event`. In Node 15+ this terminates the process with an `uncaughtException` stack trace and exit code 1. This differs from the controlled `process.exit(137)` crash path in `processFrame.ts`. The unhandled exception path: (a) exits with code 1, not 137; (b) publishes no telemetry before dying; (c) logs a raw exception stack, not a structured event. The orchestrator's `onExit` handler only checks whether a process exited unexpectedly - it sees the exit but cannot distinguish a genuine crash from a Redis connection drop.

**Governing rule:** CLAUDE-BACKEND.md worker pattern includes `worker.on('error', (err) => logger.error({ err }, 'Worker error'))`. R-010: diagnosis before the bug causes confusion.

**Fix direction:** add `worker.on('error', (err) => { process.stderr.write(JSON.stringify({ event: 'worker_error', err: String(err) }) + '\n'); })` to surface connection errors distinctly from simulated crashes. Consider whether to re-throw or swallow (re-throw exits the process, which for this demo is acceptable as long as the exit code is distinctive).
`to confirm:` what BullMQ 5.79.2 emits on `'error'` vs what it emits on `'failed'`, and whether the orchestrator needs to distinguish them.

---

### P2-4: R-218 helper ordering violation in `processFrame.ts`

**File:** `worker/src/stages/processFrame.ts:19-54`

```typescript
// Line 19: helper 1
function sleep(ms: number): Promise<void> { ... }

// Line 23: helper 2
async function runStage(job: Job, stage: Stage, state: NodeState, deps: ProcessDeps): Promise<void> { ... }

// Line 51: PRIMARY EXPORT (should be above the helpers)
export async function processFrame(job: Job, deps: ProcessDeps): Promise<void> { ... }
```

R-218 prescribes: `(4) the primary export; (5) helper functions.` And: `"Order helpers by call sequence, caller above callee."` Both `sleep` and `runStage` appear before `processFrame`. Correct order: `processFrame` (primary export, caller) first, then `runStage` (called by `processFrame`), then `sleep` (called by `runStage`).

**Governing rule:** R-218 TypeScript file layout.

**Fix direction:** reorder the file so `processFrame` appears first (after the interface and constant), then `runStage`, then `sleep`. No logic changes.
`to confirm:` TypeScript hoisting does not apply to `async function` declarations in the same way it does to plain `function` declarations - verify the reordered file typechecks without forward-reference errors.

---

### P2-5: `ProcessDeps` interface exported from function module (R-235)

**File:** `worker/src/stages/processFrame.ts:10-17`

```typescript
export interface ProcessDeps {
    nodeId: string;
    pid: number;
    publisher: Redis;
    stageMs: number;
    getCompleted: () => number;
    crashRoll: () => boolean;
}

export async function processFrame(job: Job, deps: ProcessDeps): Promise<void> { ... }
```

R-235: "Constants and types are not behavior and never share a function's file; extract them per R-222." R-222: "Extract shared constants and types out of function modules into sibling `constants.ts`/`types.ts` modules." `ProcessDeps` is a type, not behavior. It is exported alongside the single exported function, which is the pattern R-235 forbids.

**Governing rule:** R-235, R-222.

**Fix direction:** move `ProcessDeps` to a sibling `worker/src/stages/types.ts` (or `worker/src/types.ts` if it is the only type at that scope) and import it in `processFrame.ts`.
`to confirm:` whether `worker/src/index.ts` also imports `ProcessDeps` directly; if so, both must update their import path.

---

## P3 Findings

### P3-1: Magic numbers in `worker/src/index.ts` (R-219)

**File:** `worker/src/index.ts:10,47,48,49`

```typescript
const stageMs = Number(process.env.STAGE_MS ?? 2500);            // line 10
// ...
lockDuration: Number(process.env.LOCK_DURATION_MS ?? 5000),      // line 47
stalledInterval: Number(process.env.STALLED_INTERVAL_MS ?? 3000),// line 48
maxStalledCount: Number(process.env.MAX_STALLED_COUNT ?? 10),    // line 49
```

R-219: "Every literal that carries meaning [should be extracted to] a named constant: module `ALL_CAPS` for shared or configurable values (timeouts, limits)." Exempt values are `0, 1, -1`. `2500`, `5000` (wrong per P1-2), `3000` (wrong per P1-2), and `10` are configurable timeout/limit values without named constants. The server centralizes equivalent values in `TUNABLES`; the worker has no equivalent table.

**Fix direction:** declare `const DEFAULT_STAGE_MS = 2500` etc. as module-level `ALL_CAPS` constants at the top of `worker/src/index.ts`. This also makes P1-2's fix visible in one place.
`to confirm:` whether the worker's `stageMs` fallback of 2500 matches server `TUNABLES.stageMs` (it does); use the same value.

---

### P3-2: Exit code `137` is a magic number (R-219)

**File:** `worker/src/stages/processFrame.ts:32`

```typescript
process.exit(137); // simulate a hard crash mid-stage (real SIGKILL-like death)
```

R-219: "Every literal that carries meaning [should be] a named constant." `137` is meaningful: it is the conventional exit code for a process killed by SIGKILL (`128 + SIGKILL(9)`). Using the raw number means a reader who does not know POSIX exit codes cannot understand why 137 specifically. R-219 does not exempt it (exempt values are `0, 1, -1`).

**Fix direction:** extract `const SIMULATED_SIGKILL_EXIT_CODE = 137` as a module-level constant with a comment explaining the POSIX convention.
`to confirm:` R-219 applies to this file (it does; no test/fixture exemption).

---

### P3-3: Named import order in `shared/src/types.ts` (R-218)

**File:** `shared/src/types.ts:3`

```typescript
import type { STAGES, EVENT_LEVELS, COMMAND_TYPES } from './constants.js';
```

R-218: imports within a group must be alphabetical. Current order: `STAGES`, `EVENT_LEVELS`, `COMMAND_TYPES`. Alphabetical order: `COMMAND_TYPES`, `EVENT_LEVELS`, `STAGES`.

**Fix direction:** reorder the named imports to `{ COMMAND_TYPES, EVENT_LEVELS, STAGES }`.
`to confirm:` no semantic dependency on import order (there is none; these are type-only constants).

---

### P3-4: `TelemetryMsg.state` type is wider than workers can legally set

**File:** `shared/src/types.ts:41`

```typescript
export interface TelemetryMsg {
    // ...
    state: NodeState; // 'idle' | 'rendering' | 'compositing' | 'spawning' | 'crashed'
```

Workers only ever publish `state: 'idle'`, `state: 'rendering'`, or `state: 'compositing'` via telemetry. `'spawning'` and `'crashed'` are server-side states set by the orchestrator's nodePool (confirmed in `server/src/index.ts:25-28`): a spawning node's state is inferred by the server before the first idle telemetry arrives; crashed state is inferred from the `onExit` callback. Neither state is set by a worker via `TelemetryMsg`. The current type allows a worker to publish `state: 'spawning'` or `state: 'crashed'` without a TypeScript error, which is semantically incorrect.

**Governing rule:** TypeScript strict mode; minimal correct type contract.

**Fix direction:** introduce a narrower union type `WorkerTelemetryState = 'idle' | 'rendering' | 'compositing'` in `shared/src/types.ts` and use it for `TelemetryMsg.state`. Keep the full `NodeState` for `WorkerNode.state` (which includes server-side states).
`to confirm:` that no server code sets `TelemetryMsg.state` to `'spawning'` or `'crashed'` (grep confirms it does not).

---

### P3-5: `@demo/shared` package scope diverges from R-236 global convention

**File:** `shared/package.json:2`

```json
"name": "@demo/shared",
```

R-236: "Shared packages take the project-agnostic `@repo/*` scope... never a project-scoped `@<project>/shared-types`; always `@repo/types`." The implementation plan (Task 1, Step 2) explicitly specifies `@demo/shared` as the package name. Per R-403b, a documented project decision in the governing spec is not a violation. This finding is informational: if this project graduates to production or is merged into the portfolio monorepo, the package will need renaming to `@repo/shared` (or split into `@repo/types` + `@repo/constants`).

No immediate action required. Noted for future alignment.

---

## Architecture and Design

The three-layer separation (shared contract / worker data plane / server control plane) is clean and well-executed. The worker correctly owns exactly two responsibilities: run stages and publish telemetry. It does not know about the Director, the queue lifecycle, or the web client.

The two-connection model (blocking `connection` for BullMQ, separate `publisher` for telemetry) is architecturally correct. BullMQ requires `maxRetriesPerRequest: null` on the blocking connection; the publisher does not need this because it only issues fire-and-forget `PUBLISH` commands. This distinction is correctly implemented.

The shared types contract is minimal and correct. All interfaces are alphabetically sorted (R-231) and use `import type` correctly throughout (required by `verbatimModuleSyntax`).

One design concern: `TelemetryMsg.priority` conflates job metadata (static, set at enqueue time) with worker telemetry (dynamic, updated per tick). The server already receives frame priority via the `'added'` QueueEvents event. The telemetry channel is for node status and intra-frame progress; carrying priority through it creates a second truth source for the same fact. This works correctly because the worker faithfully reads `job.data.priority`, but it adds surface area. Covered as P3-4 context.

---

## Code Quality

**Helper naming:** `sleep` and `runStage` are both function declarations (not arrow consts), consistent with R-218.

**`processFrame` as orchestrator:** correctly sequences `runStage` twice without inline business logic. The loop logic is in `runStage`, the stage sequence is in `processFrame`. R-227 orchestrator / atomic split is respected.

**`runStage` length:** 20 lines including the loop body. Within R-227's atomic ceiling of ~25.

**`publishIdle` in `index.ts`:** a private helper, not exported, correctly inlined in the entry file. Not in a services/ tree so R-235 does not apply.

**Module-level `completed` counter:** mutable module state (`let completed = 0`) incremented in `worker.on('completed')`. This is correct for the design (a single-process per-worker counter) and not a concurrency concern since the worker has `concurrency: 1`.

---

## Testing

The worker has no test script and no tests. This is by design: the design spec delegates worker behavior validation to the server's `crashRecovery.test.ts` integration test, which forks real worker processes against real Redis and asserts crash-and-recover end-to-end. This is the right tradeoff for a local demo.

The shared package has no tests. Its contents are pure type definitions and constants with no runtime logic; there is nothing to test.

Coverage gap to note for future: `processFrame` has no unit test covering the `crashRoll() === true` path. The integration test covers crash recovery from the outside (observing that the job completes on another worker) but does not assert the intermediate crash behavior from within the worker. For a production system this would be P1; for this demo it is an acceptable gap given the spec's explicit test scope.

---

## Dependencies and Supply Chain

**ioredis pinning:** `worker/package.json` pins `"ioredis": "5.10.1"` (no range caret). The installed BullMQ 5.79.2 depends on `ioredis@5.10.1` exactly. Both workspace packages resolve to `5.10.1` (confirmed via `npm ls`). The pin is intentional and correct - ioredis minor versions have historically introduced breaking changes in connection behavior that affect BullMQ.

**bullmq range:** `"bullmq": "^5.34.0"` resolves to `5.79.2`. The caret allows minor/patch updates which is appropriate.

**`tsconfig.base.json` missing `declaration` and `composite`:** the plan specified `"declaration": true, "composite": true` for TypeScript project references. The actual `tsconfig.base.json` omits these. Since `shared/package.json` exports raw `.ts` source (not compiled `.js`) and the dev runtime uses `tsx` (which transpiles on-the-fly), project references are not exercised. This does not affect correctness. If the project ever builds to `dist/` for deployment, these settings will need to be added.

**`verbatimModuleSyntax: true`** in `tsconfig.base.json` (not in the plan) requires that `import type` be used for type-only imports. All three worker/shared files correctly use `import type` where needed. No compliance gap.

**Worker `package.json` has no `test` script.** The root `package.json` uses `npm run test -ws --if-present` which skips workspaces without a test script. This is consistent with the design intent.

---

## Performance

No polling in scope. The worker is event-driven (BullMQ processor callback, `worker.on('completed')`, `worker.on('ready')`). Telemetry is published per progress step (`STEPS=5` per stage), 10 publishes per frame. At `stageMs: 2500` with STEPS=5, a publish fires every 500ms per active worker. With up to 6 workers and 2 stages, this is at most 24 publishes/second to Redis - well within acceptable range for a local demo.

---

## Tech Debt Register

| Item | Risk | Notes |
|---|---|---|
| Worker env fallbacks wrong (P1-2) | High | Produces silent timing mismatch in standalone runs |
| SIGTERM void-swallow (P1-1) | High | Zombie process under any shutdown-time Redis error |
| `job.data` untyped (P2-2) | Medium | Server-worker contract unchecked by TypeScript |
| `TelemetryMsg.state` too broad (P3-4) | Low | Workers can set semantically wrong states silently |
| `ProcessDeps` in function module (P2-5) | Low | R-235 violation; no behavioral impact |
| Missing `worker.on('error')` (P2-3) | Low | Unexpected crashes surface as uncaught exceptions, not structured logs |

---

## Prioritized Recommendations

| # | Finding | Impact | Effort | Priority |
|---|---|---|---|---|
| 1 | Fix SIGTERM handler to handle `worker.close()` rejection (P1-1) | H | L | Now |
| 2 | Align worker env fallback defaults with README + server TUNABLES (P1-2) | H | L | Now |
| 3 | Add `FrameJobData` to `@demo/shared`, parameterize `Job<FrameJobData>` (P2-2) | H | L | Soon |
| 4 | Add `worker.on('error')` listener (P2-3) | M | L | Soon |
| 5 | Fix R-218 helper ordering in `processFrame.ts` (P2-4) | L | L | Soon |
| 6 | Extract `ProcessDeps` to sibling `types.ts` (P2-5) | L | L | Soon |
| 7 | Narrow `TelemetryMsg.state` to `WorkerTelemetryState` union (P3-4) | M | L | Next |
| 8 | Extract magic numbers to named constants in `worker/src/index.ts` (P3-1) | L | L | Next |
| 9 | Extract exit code 137 to named constant (P3-2) | L | L | Next |
| 10 | Fix named import order in `shared/src/types.ts` (P3-3) | L | L | Next |
| 11 | Note `@demo/shared` vs R-236 for future production alignment (P3-5) | L | M | Deferred |

Items 1 and 2 are both tiny edits. Do them together in one commit.
