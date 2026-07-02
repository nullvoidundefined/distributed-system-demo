# Engineering Audit - Server Surface

**Date:** 2026-07-02
**Scope:** `server/src/**`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`
**Auditor role:** CTO (Engineering)
**Governing rules:** `~/.claude/CLAUDE.md`, `~/.claude/CLAUDE-BACKEND.md`, `/Users/iangreenough/Desktop/code/personal/.claude/CLAUDE.md`
**Note:** This is a local demo project. The spec explicitly declares "Not deploy-ready for Railway; no auth, no persistence beyond Redis, no multi-user coordination" as non-goals. Security, CI, and deployment findings that conflict with those stated non-goals are noted as such and not penalized.

---

## Executive Summary

The server is architecturally sound. The pure-reducer + runtime-orchestrator split is well-executed, the Redis connection model is correct for BullMQ, and the crash-recovery path works via real SIGKILL + BullMQ stalled detection. Three correctness bugs require fixes before the demo is reliable under all user interactions: (1) no shutdown handler means worker children become orphans, (2) a pause-during-seeding edge case causes the director to skip an entire cycle on resume, and (3) the director's internal node count drifts from reality after crashes and retirements, corrupting autoscale decisions.

**Top 3 priorities:**
1. P1 - F3: Pause during seeding resumes to `running` with no frames seeded - cycle immediately "completes" and resets.
2. P1 - F1: No SIGTERM/SIGINT handler - worker children are orphaned on server exit, holding Redis connections.
3. P1 - F4: `state.nodeCount` in `DirectorState` is never decremented after a crash or graceful retirement - autoscale uses a stale ceiling.

---

## Operational Basics

| Check | Status | Notes |
|---|---|---|
| Unit tests run | YES | `npm test -w server` - `reduceDirector` and `reduceWorldState` unit tests pass |
| Integration test | YES | `crashRecovery.test.ts` runs against real Redis + real BullMQ |
| CI | N/A | Local demo; "not deploy-ready" is a documented non-goal in the spec |
| Monitoring / error tracking | N/A | Local demo; no deploy surface |
| Rollback plan | N/A | Local demo |

The test suite is scoped correctly for the project's stated goals: pure reducer functions have full behavioral coverage, and the high-risk crash-recovery timing is validated by a real-Redis integration test. No blocking issues on operational basics.

---

## Credential Exposure Scan

Scan targets covered: git history (all refs), working tree (all `.ts`/`.json`/`.md`), Claude Code session transcript (`~/.claude/projects/-Users-iangreenough-Desktop-code-personal-development-distributed-system-demo/db45c648-dd80-41b0-a91b-e69b2366256c.jsonl`), shell history (`~/.zsh_history`, `~/.bash_history`), vendor CLI configs (`~/.railway/config.json`, `~/.config/gh/hosts.yml`).

Patterns scanned: Anthropic API, Stripe (live/test/webhook/restricted), GitHub tokens, Vercel, Resend, Render, Slack, AWS, SendGrid, Google API, private keys.

**Result: zero matches on all surfaces.** No credential exposure found.

---

## Architecture and Design

Overall structure follows the spec and conventions faithfully. Notable strengths:

- Pure reducers (`reduceDirector`, `reduceWorldState`) are cleanly separated from I/O - allows unit testing without Redis. The orchestrator/atomic split per R-227 is correctly applied.
- Two-channel truth model (BullMQ QueueEvents for job lifecycle, Redis pub/sub for intra-job telemetry) is correctly implemented: QueueEvents drives frame stage transitions, telemetry drives node strip updates.
- BullMQ connection split is correct: one connection per blocking consumer (queue, queueEvents, telemetry subscriber each get their own).
- The `createNodePool` correctly lets the `exit` event be the single source of removal from `children`, avoiding double-management.

One structural concern: `queue/` directory contains third-party BullMQ SDK wrappers. Per R-238 and R-220, these belong under `clients/`. See F12.

---

## Findings by Severity

### P1 - Blocker

---

**F1: No process shutdown handler - worker children orphaned on server exit**

File: `server/src/index.ts` (entire file - no `process.on` calls anywhere)

```typescript
// server/src/index.ts (last 4 lines)
httpServer.listen(TUNABLES.httpPort, () => {
    process.stdout.write(`orchestrator on :${TUNABLES.httpPort}\n`);
});
```

No `process.on('SIGTERM', ...)` or `process.on('SIGINT', ...)` handler exists. `pool.shutdown()` is defined (it sends SIGKILL to all children and clears the map) but is never called. When the orchestrator is stopped (Ctrl-C during `npm run dev`, or `kill`), all forked worker child processes become orphans. They continue holding Redis connections and processing from the BullMQ queue. On the next `npm run dev`, a second set of workers spawns alongside the orphans, producing duplicate processing and confusing world state.

Governing rule: General resource cleanup / graceful shutdown; CLAUDE-BACKEND.md worker pattern shows explicit SIGTERM/SIGINT handlers.

Direction: Register `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` in `index.ts` that call `pool.shutdown()`, `director.stop()`, close Redis connections, close `wss`, and close `httpServer`. The broadcaster's interval cleanup return value (currently discarded - see F7) would also be invoked here.

To confirm: whether `queueEvents` and the telemetry subscriber connection need explicit `quit()` calls or whether `pool.shutdown()` + process exit is sufficient for the demo's in-process cleanup.

---

**F2: Unguarded `JSON.parse` on WebSocket messages can crash the orchestrator**

File: `server/src/index.ts:69`

```typescript
socket.on('message', (raw) => {
    const cmd = JSON.parse(raw.toString()) as Command;
    handleCommand(cmd, {
```

`JSON.parse` throws `SyntaxError` on malformed input. In the `ws` library, an exception thrown synchronously inside a message listener propagates through Node's `EventEmitter` as an uncaught exception and will crash the process unless a `process.on('uncaughtException', ...)` handler is registered. Any browser tab that sends a non-JSON message (e.g., WebSocket ping frame contents, browser extension injection, or a typo in manual testing) kills the orchestrator.

Governing rule: R-208 (every user-input handler has one negative-input test: malformed encoding). The handler has no test for malformed input.

Direction: Wrap the `JSON.parse` + `handleCommand` call in a `try/catch`. On catch, log the raw message and return without crashing. Optionally `socket.send` an error response.

To confirm: whether the project's `ws` version (8.x) lets message listener exceptions propagate to process level or catches them internally - verify with `ws` 8 docs; `ws` 8 does not catch listener errors by default.

---

**F3: `state.nodeCount` in `DirectorState` never decremented after crash or graceful retirement**

File: `server/src/services/director/runDirector.ts:62-65` (the only place `nodeCount` is synced)

```typescript
function spawnNode(): void {
    const id = pool.spawn();
    state = { ...state, nodeCount: pool.size() };
    store.update((s) => appendEvent(s, 'success', `autoscaling up: ${id} spawned`));
}
```

`state.nodeCount` is set once at initialization and updated only on spawn. After `pool.crashRandom()` or `pool.killIdle()`, the `exit` event fires and removes the node from `children`, but neither the `onExit` callback in `index.ts` nor the callers `maybeCrash()` / `retireIdleNode()` in `runDirector.ts` update `state.nodeCount`.

```typescript
// server/src/index.ts:24-29
const pool = createNodePool({
    onExit: (nodeId, crashed) => {
        store.update((s) => ({ ...s, nodes: s.nodes.filter((node) => node.id !== nodeId) }));
        if (crashed) store.update((s) => appendEvent(s, 'warn', `${nodeId} process exited`));
    },
});
```

`worldState.nodes` (updated via `onExit`) is used for display only. `state.nodeCount` is what the reducer uses for autoscale bounds:

```typescript
// server/src/services/director/reduceDirector.ts:29-32
if (ctx.queueDepth >= ctx.scaleUpDepth && state.nodeCount < ctx.maxNodes) {
    effects.push({ type: 'spawn' });
} else if (ctx.queueDepth <= ctx.scaleDownDepth && state.nodeCount > ctx.minNodes) {
    effects.push({ type: 'kill', strategy: 'idle' });
}
```

Scenario: 4 nodes running. Director crashes one (`state.nodeCount` still 4). Queue depth rises. Autoscale condition `state.nodeCount(4) < maxNodes(6)` is true - spawns correctly. But after spawning: `pool.size() = 4` again (crashed one + new one = 4), `state.nodeCount = 4`. Over time, repeated crashes without correct decrements make `state.nodeCount` drift steadily above reality, ultimately preventing autoscale-up even when the true node count is at `minNodes`. Scale-down also fires spuriously when `state.nodeCount > minNodes` but real count equals `minNodes`.

Governing rule: Correctness - autoscale state machine has stale input.

Direction: Add `state = { ...state, nodeCount: pool.size() }` inside the `onExit` callback (or return a `nodeCount` update from `pool.crashRandom()` / `pool.killIdle()`). The canonical source of truth is `pool.size()`, which reads the live `children.size`.

To confirm: whether reading `pool.size()` from inside the async `onExit` callback is safe (it is - single-threaded event loop, exit handler fires synchronously relative to `state` reads in tick).

---

**F4: `resume` action unconditionally enters `running` - pausing during seeding skips the seed**

File: `server/src/services/director/reduceDirector.ts:42-43`

```typescript
if (action.type === 'pause') return { effects: [], state: { ...state, phase: 'paused' } };
if (action.type === 'resume') return { effects: [], state: { ...state, phase: 'running' } };
```

`pause` does not store the prior phase. `resume` always returns `phase: 'running'`. If a user pauses within the first tick (while phase is `seeding` and frames have not yet been enqueued), then resumes:

1. Director state: `phase: 'running'`, `state.cycle: 1`
2. `world.totals.total = 0`, `world.totals.done = 0`
3. Next `tick()`: `remaining = 0 - 0 = 0`; `state.phase !== 'seeding'` so `remaining` override is not applied
4. `reduceDirector(running, tick, ctx{remaining:0})` → `run()` sees `remaining === 0` → returns `phase: 'complete'`
5. Next tick: `complete` → `reset()` → cycle increments, board clears, next cycle begins with no frames ever processed

The cycle is silently skipped. This is a real user-visible bug triggered by pressing Pause within the first 5-10 seconds of any cycle.

The unit test does not catch this because it asserts the buggy outcome as expected:
```typescript
// server/src/__tests__/reduceDirector.test.ts:62-66
const paused = reduceDirector(seeding, { type: 'pause' }, baseCtx).state;
expect(paused.phase).toBe('paused');
...
const resumed = reduceDirector(paused, { type: 'resume' }, baseCtx).state;
expect(resumed.phase).toBe('running');  // asserts the bug
```

Governing rule: R-200 (tests must fail when implementation is wrong). The test passes but the behavior is incorrect.

Direction: `pause` must record the prior phase in `DirectorState`. `resume` reads it back. The simplest form: add a `priorPhase: DirectorPhase | null` field to `DirectorState`. On `pause`, set `priorPhase: state.phase`. On `resume`, restore `phase: state.priorPhase ?? 'running'`. Then write a failing test: pause from seeding, resume, tick - should produce `seed` effect and `running` state, NOT immediately `complete`.

To confirm: whether pausing from `complete` phase should resume to `complete` or to `seeding` (the spec implies complete is a transient hold beat, so `complete` is probably fine to resume to).

---

### P2

---

**F5: `reduceWorldState.ts` exports four functions - R-235 violation**

File: `server/src/services/worldState/reduceWorldState.ts:7,18,29,53`

```typescript
export function emptyWorld(cycle: number): WorldState { ... }        // line 7
export function appendEvent(state, level, message): WorldState { ... } // line 18
export function applyTelemetry(state, msg): WorldState { ... }        // line 29
export function applyQueueEvent(state, evt): WorldState { ... }       // line 53
```

R-235: "One exported function per file across the `services/` ... trees. A module exports exactly one public function." Four public functions violate this rule. Each reducer maps to a distinct operation on `WorldState` and has its own callers.

Governing rule: R-235, R-226.

Direction: Split into four files: `emptyWorld.ts`, `appendEvent.ts`, `applyTelemetry.ts`, `applyQueueEvent.ts` in `services/worldState/`. The `upsertNode` private helper moves to `applyTelemetry.ts` (its only caller). Update all import sites.

To confirm: whether R-223 (no single-file folders) is satisfied - yes, `worldState/` still has `createWorldStore.ts` plus the four new reducer files.

---

**F6: `WorldStore.reset()` is dead code that would corrupt state if called**

File: `server/src/services/worldState/createWorldStore.ts:19-21`

```typescript
reset: (cycle) => {
    state = emptyWorld(cycle);
},
```

`emptyWorld()` zeros out `nodes: []`. Calling `store.reset()` would remove all worker node records from world state while the workers continue running, breaking the node strip display and telemetry correlation for the remainder of the cycle.

`store.reset()` is never called from `runDirector.ts`. The actual cycle reset is done via a manual `store.update()` in `resetCycle()`:

```typescript
// server/src/services/director/runDirector.ts:81-87
store.update((s) => ({
    ...s,
    cycle: state.cycle,
    frames: [],
    phase: 'seeding',
    totals: { done: 0, total: 0 },
}));
```

This correctly preserves `nodes` and `events` across cycles, which is the right behavior. The `reset()` method on the store is therefore dead, misleadingly named, and dangerous.

Governing rule: Dead code; R-226 (one responsibility per file - the method implies a different responsibility than what `resetCycle` does).

Direction: Remove the `reset()` method from the `WorldStore` interface and `createWorldStore()` implementation. The cycle-reset behavior is correctly handled via `store.update()` in `runDirector.ts`.

To confirm: no other caller of `store.reset()` exists (confirmed - grep shows zero calls to `store.reset` in `server/src/`).

---

**F7: `DirectorEffect { type: 'crash' }` is a dead type variant**

File: `server/src/services/director/types.ts:29`

```typescript
export type DirectorEffect =
    | { type: 'seed'; count: number }
    | { type: 'spawn' }
    | { type: 'kill'; strategy: 'random' | 'idle' }
    | { type: 'crash' }          // <-- never produced
    | { type: 'resetQueue' };
```

`reduceDirector` never produces `{ type: 'crash' }`. Crashes are handled outside the pure reducer in `runDirector.ts`'s `maybeCrash()`. The dead variant adds noise to the discriminated union, and any engineer reading this type would reasonably expect the reducer to produce it.

Governing rule: Dead code; R-226.

Direction: Remove `{ type: 'crash' }` from `DirectorEffect`. If crash ever needs to become an effect (e.g., for testing), it can be re-added at that point with an implementation.

To confirm: that no call site handles `effect.type === 'crash'` (confirmed - `applyEffect` in `runDirector.ts` has no crash branch).

---

**F8: Broadcaster cleanup return value discarded - interval cannot be stopped**

File: `server/src/index.ts:65`

```typescript
createBroadcaster(wss, store, TUNABLES.broadcastHz);
```

`createBroadcaster` returns `() => clearInterval(timer)`:

```typescript
// server/src/websocket/createBroadcaster.ts:19
return () => clearInterval(timer);
```

The return value is not stored. There is no way to stop the broadcaster's 200ms broadcast interval after startup (see also F1 - no shutdown handler). In the absence of a shutdown handler, this leaks the interval when the server is stopping.

Governing rule: Resource cleanup / R-010 (durable fix, not expedient).

Direction: Store the return value in `index.ts` and call it in the shutdown handler (per F1's fix). `const stopBroadcaster = createBroadcaster(wss, store, TUNABLES.broadcastHz);` then `stopBroadcaster()` in the SIGTERM handler.

To confirm: no other callers exist. The function signature already returns the cleanup; this is a single-line fix at the call site.

---

### P3 - Convention / Style

---

**F9: R-219 - Three magic literals in `runDirector.ts`**

File: `server/src/services/director/runDirector.ts:50,52`

```typescript
await queue.add(
    'frame',
    { cycle: state.cycle, frameId, priority },
    { attempts: TUNABLES.jobAttempts, jobId: frameId, priority: priority ? 1 : 5 },
);
```

Three literals carry meaning with no named constant:
- `'frame'`: the BullMQ job name/type. If the worker's processor filters by job name, a rename here silently breaks that contract.
- `1`: BullMQ high-priority level.
- `5`: BullMQ normal-priority level.

Also in `server/src/websocket/handleCommand.ts:16`:
```typescript
if (cmd.type === 'inject') return deps.inject(cmd.count ?? 5);
```
- `5`: default inject count (magic number, appears once).

Governing rule: R-219.

Direction: Add constants to `@demo/shared/constants.ts` or a `server/src/constants/` module: `JOB_NAME = 'frame'`, `PRIORITY_HIGH = 1`, `PRIORITY_NORMAL = 5`, `DEFAULT_INJECT_COUNT = 5`.

To confirm: whether BullMQ job name must match on both producer and consumer sides (it does not by default in BullMQ 5 - the worker binds to a queue name, not a job name - so `'frame'` is cosmetic). Lower urgency for that one specifically.

---

**F10: R-218 - Helpers ordered before primary export in three files**

R-218 requires: `(4) primary export; (5) helper functions`.

`server/src/services/director/reduceDirector.ts:10-48`:
```typescript
function seed(state, ctx): Reduced { ... }   // line 10
function reset(state): Reduced { ... }        // line 17
function run(state, ctx): Reduced { ... }     // line 24
export function reduceDirector(...): Reduced { ... }  // line 37 -- primary export is last
```

`server/src/services/nodePool/createNodePool.ts:22-32`:
```typescript
function wasCrash(...): boolean { ... }     // line 22
function pickRandom(ids): string { ... }    // line 27
export function createNodePool(...): NodePool { ... }  // line 32 -- primary export is last
```

`server/src/services/worldState/reduceWorldState.ts:24-29`:
```typescript
function upsertNode(nodes, patch): WorkerNode[] { ... }  // line 24 -- private helper
export function applyTelemetry(...): WorldState { ... }  // line 29 -- its caller
```
`upsertNode` (callee) is above `applyTelemetry` (caller). R-218 requires caller above callee.

Governing rule: R-218.

Direction: Move each primary export above its private helpers. Since all are `function` declarations (hoisted), TypeScript does not require forward-reference workarounds - the reorder is purely cosmetic.

To confirm: no `const` arrow function definitions that would break if moved.

---

**F11: R-232 - Private helper names violate verb+noun**

`server/src/config/tunables.ts:3`:
```typescript
function num(name: string, fallback: number): number {
```
`num` is a bare noun with no verb. R-232: "verb + noun ... the noun is mandatory." Should be `parseEnvNumber` or `readEnvNumber`.

`server/src/services/director/runDirector.ts:21-25`:
```typescript
function idleCtx(): ReturnType<typeof buildCtx> {
    return buildCtx(0, 0, 1);
}

function buildCtx(queueDepth: number, activeCount: number, remaining: number) {
```
`idleCtx` is missing a verb. `buildCtx` should be `buildDirectorCtx` (the noun `Ctx` alone is too abbreviated; the domain entity is a `DirectorCtx`).

Governing rule: R-232.

Direction: Rename `num` -> `readEnvNumber`; `idleCtx` -> `buildIdleCtx`; `buildCtx` -> `buildDirectorCtx`. Private helper, so no external import sites to update.

To confirm: all call sites are within the same file.

---

**F12: R-233 - `result` variable name (generic name explicitly banned)**

File: `server/src/services/director/runDirector.ts:126`:
```typescript
const result = reduceDirector(state, { type: 'tick' }, ctx);
```

File: `server/src/services/director/runDirector.ts:144`:
```typescript
const result = reduceDirector(state, action, idleCtx());
```

R-233 explicitly lists `result` as a banned generic name. The value is a `{ state: DirectorState; effects: DirectorEffect[] }` object. A name like `reduction` or `directorOutput` communicates the domain.

Also: `server/src/services/worldState/reduceWorldState.ts:25`:
```typescript
const exists = nodes.some((node) => node.id === patch.id);
```
`exists` is a boolean that should follow R-232's `is`/`has`/`can`/`should` prefix. Should be `isNodeRegistered` or `hasExistingNode`.

Governing rule: R-233, R-232.

Direction: Rename `result` -> `reduction` (or similar) in both call sites in `runDirector.ts`. Rename `exists` -> `isRegistered` in `reduceWorldState.ts`.

To confirm: no shadowing conflicts at the rename sites.

---

**F13: R-238 - `queue/` directory should be under `clients/`**

Files: `server/src/queue/createRenderQueue.ts`, `server/src/queue/createQueueEvents.ts`

Both files create BullMQ SDK singleton objects (Queue and QueueEvents). Per R-220 and R-238, "Clients holds stateful singletons that wrap a third-party SDK or external service, one module per provider." BullMQ is the third-party provider. These belong under `clients/queue/` (alongside the existing `clients/redis/`).

```typescript
// server/src/queue/createRenderQueue.ts:6-8
export function createRenderQueue(connection: Redis): Queue {
    return new Queue(QUEUE_NAME, { connection });
}
```

The current `queue/` directory name is not in the R-238 taxonomy and creates a parallel to `clients/` for the same category of concern.

Governing rule: R-238, R-220.

Direction: Move `createRenderQueue.ts` and `createQueueEvents.ts` to `server/src/clients/queue/`. Update import paths in `server/src/index.ts`. No behavioral change.

To confirm: no other importers of these modules exist outside `index.ts`.

---

**F14: Duplicate `WORKER_ENTRY` path string - no shared constant**

File: `server/src/services/nodePool/createNodePool.ts:7`:
```typescript
const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
```

File: `server/src/__tests__/integration/crashRecovery.test.ts:8`:
```typescript
const WORKER_ENTRY = fileURLToPath(new URL('../../../../worker/src/index.ts', import.meta.url));
```

The same cross-workspace path string appears in two places. If the worker entry point moves, two files must be updated. The paths diverge from different directory depths, so the `'../../../../'` traversal should be checked if either file ever moves.

Governing rule: R-219 (literals appearing 2+ times become a named constant).

Direction: Extract to a shared constant. One approach: a `server/src/constants/workerEntry.ts` exporting `WORKER_ENTRY`. Alternatively, since the test needs the same path for the same reason, the test can import from `createNodePool.ts` if the constant is exported.

To confirm: that the relative path from `createNodePool.ts` (`server/src/services/nodePool/` -> `../../../../`) and from the integration test (`server/src/__tests__/integration/` -> `../../../../`) both resolve to the repo root correctly (they do).

---

**F15: `reduceDirector` test asserts the buggy resume behavior (related to F4)**

File: `server/src/__tests__/reduceDirector.test.ts:64-67`

```typescript
const resumed = reduceDirector(paused, { type: 'resume' }, baseCtx).state;
expect(resumed.phase).toBe('running');
```

The test pauses from `seeding` phase and asserts that resume enters `running`. This is the incorrect behavior identified in F4. Once F4 is fixed (pause stores prior phase), this assertion must be updated: resume from a seeding-paused state should return `phase: 'seeding'`, and a subsequent tick should produce the `seed` effect.

Governing rule: R-200 (tests must fail when implementation is wrong). Currently the test passes for the wrong reason.

Direction: After fixing F4's state machine, add a test: `pause during seeding then resume then tick -> produces seed effect`. Update the existing `resume` assertion to expect `'seeding'` not `'running'` when paused from seeding.

To confirm: the correct expected behavior - that resume from a seeding-paused state should go back to seeding (not running).

---

**F16: Test coverage gap - `between thresholds` case and `active` queue event not tested**

`server/src/__tests__/reduceDirector.test.ts` has no test for the "between thresholds" path: `scaleDownDepth < queueDepth < scaleUpDepth` with `remaining > 0`. This path produces `effects: []` (no scaling action). Not tested.

`server/src/__tests__/reduceWorldState.test.ts` has no test for `applyQueueEvent({ kind: 'active' })`. The implementation returns `state` unchanged. Not tested.

Governing rule: R-200 ("full branch coverage" per spec's stated goal).

Direction: Add one test per gap. Both are trivial: one assertion that `effects` is empty for between-thresholds; one assertion that `applyQueueEvent(state, {kind:'active', frameId})` returns the same frame untouched.

To confirm: the between-thresholds input values that avoid both scale conditions with the default `baseCtx` config (e.g., `queueDepth: 4`, `remaining: 5`, `nodeCount: 3`).

---

## Runbook vs Code Drift Scan

`README.md` tunables table was cross-checked against `server/src/config/tunables.ts`. All documented defaults match the code exactly:
- `BATCH_SIZE: 16` matches `tunables.ts:9`
- `TICK_MIN_MS/TICK_MAX_MS: 5000/10000` matches `tunables.ts:23-24`
- `STAGE_MS: 2500` matches `tunables.ts:21`
- `MIN_NODES/MAX_NODES: 2/6` matches `tunables.ts:17-18`
- `SCALE_UP_DEPTH/SCALE_DOWN_DEPTH: 6/2` matches `tunables.ts:19-20`
- `LOCK_DURATION_MS: 4000` matches `tunables.ts:14`
- `STALLED_INTERVAL_MS: 2000` matches `tunables.ts:22`

No runbook-vs-code drift found.

Minor note: the standalone worker defaults (`LOCK_DURATION_MS ?? 5000`, `STALLED_INTERVAL_MS ?? 3000` in `worker/src/index.ts`) differ from the server's `TUNABLES` defaults (4000 and 2000 respectively). This only matters when running the worker directly without environment variables. The nodePool always passes the server's TUNABLES values when forking, so the demo's orchestrated path is unaffected.

---

## Bug Fix Discipline

No `fix:`, `bug:`, `hotfix:`, or `bugfix:` commits found in the 14-commit history. All commits are `feat:`, `chore:`, `docs:`, or `refactor:`. Bug-fix discipline not exercised in this history; no unpaired fixes to report.

---

## Workspace Hygiene

One copy of this project found at `/Users/iangreenough/Desktop/code/personal/development/distributed-system-demo`. No duplicates detected.

---

## Tech Debt Register

| Item | Risk | Priority |
|---|---|---|
| F4: pause-during-seeding cycle skip | High - user-visible, breaks demo flow | P1 |
| F1: orphan workers on server exit | High - accumulates stale processes across dev sessions | P1 |
| F3: stale `state.nodeCount` | Medium - autoscale decisions degrade over long demo runs | P1 |
| F2: unguarded JSON.parse | Medium - single bad WS message kills the server | P1 |
| F5: `reduceWorldState.ts` multi-export | Medium - convention debt, split before adding more reducers | P2 |
| F6: `WorldStore.reset()` dead code | Low - dangerous if accidentally invoked | P2 |
| F8: broadcaster cleanup discarded | Low - leaks interval until process exits | P2 |

---

## Prioritized Recommendations

| # | Recommendation | Impact | Effort |
|---|---|---|---|
| 1 | Add SIGTERM/SIGINT shutdown handler in `index.ts` (F1 + F8) | H | L |
| 2 | Fix `reduceDirector` pause to store prior phase; add failing test first (F4 + F15) | H | M |
| 3 | Sync `state.nodeCount` from `pool.size()` in `onExit` callback (F3) | M | L |
| 4 | Wrap WebSocket `JSON.parse` in try/catch (F2) | M | L |
| 5 | Remove `WorldStore.reset()` dead method (F6) | M | L |
| 6 | Remove `{ type: 'crash' }` from `DirectorEffect` union (F7) | L | L |
| 7 | Store broadcaster cleanup return value (F8 - pairs with recommendation 1) | L | L |
| 8 | Split `reduceWorldState.ts` into 4 single-function files (F5) | L | M |
| 9 | Move `queue/` to `clients/queue/` (F13) | L | L |
| 10 | Rename `num()`, `buildCtx()`, `idleCtx()`, `result`, `exists` per R-232/R-233 (F11/F12) | L | L |
| 11 | Add missing branch-coverage tests (F16) | L | L |
| 12 | Extract magic literals to named constants (F9/F14) | L | L |
| 13 | Reorder helpers below primary export per R-218 (F10) | L | L |
