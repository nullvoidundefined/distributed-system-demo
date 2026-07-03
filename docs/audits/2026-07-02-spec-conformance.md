# Spec-Conformance & Test-Enforcement Audit

**Date:** 2026-07-02
**Spec:** `docs/superpowers/specs/2026-07-02-render-farm-distributed-demo-design.md` (Approved design)
**Scope:** server, worker, shared, web, and the test harness. Four independent auditors (one per surface) plus dispatcher verification of every P1/P2 against source.
**Suite status at audit time:** 23/23 tests pass against live Redis (server 22, web 1).

## Verdict

The implementation is a faithful build of the spec's architecture: real `fork()`/`SIGKILL`, real BullMQ stalled recovery, two channels of truth (QueueEvents + `worker:telemetry` pub/sub), pure-reducer Director, one command path shared by Director and manual controls, ~5 Hz WebSocket broadcast, four-region UI, tunables in `config/`. It is **not** 100% one-to-one. Confirmed gaps:

- **1 live behavioral defect (P1):** pausing the Director does not stop crash injection.
- **2 unimplemented spec behaviors (P2):** Kanban cards do not slide between columns (the spec's primary graphic), and there is no telemetry heartbeat.
- **Diffs were never built:** transport sends full snapshots; the spec says "throttled (~5 Hz) diffs". README documents snapshots, so this is a documented deviation, but the spec was never amended.
- **The test harness is honest but under-enforcing:** zero mocks, real processes and signals, behavioral assertions. Yet four spec-named behaviors can silently break with a fully green suite, and one already has (the pause/crash defect).

## P1 findings

### P1-1: Director crashes keep firing while paused (live defect, untestable by design)

`server/src/services/director/reduceDirector.ts:42` sets `paused: true` but preserves `phase`:

```ts
if (action.type === 'pause') return { effects: [], state: { ...state, paused: true } };
```

`server/src/services/director/runDirector.ts:104-105` gates crash injection only on phase:

```ts
function maybeCrash(): void {
    if (state.phase !== 'running' || Math.random() > CRASH_PROB_PER_TICK) return;
```

and `runDirector.ts:133` calls `maybeCrash()` unconditionally after every tick. A paused Director therefore SIGKILLs a busy node on ~25% of ticks while the operator believes it is frozen. The reducer correctly suppresses seed/scale effects when paused (`reduceDirector.ts:45`), but crash lives outside the reducer/effect system, so the existing pause test (`reduceDirector.test.ts:68-73`, "a tick while paused produces no effects") passes while the real behavior violates the contract.

Spec clauses: RUN-phase drama ("random node crash") is Director behavior; "Manual controls (inject / kill node / **pause** / reset) feed the same command path"; Testing names "crash-target selection" as a required pure-function unit test. The selection logic is not pure today, which is the root cause of the coverage hole.

Fix direction: fold crash into the reducer as a `crash` effect (inject the random roll and busy-node list via `DirectorCtx` so the reducer stays deterministic), gated on `!state.paused`; unit-test "no crash effect while paused" and the `>1 busy` guard. To confirm: whether `killNodeNow`'s operator override (crash even when nothing busy, `runDirector.ts:157`) should remain outside the pause gate; an operator kill while paused is arguably intended.

### P1-2: Headline integration test omits both spec-named assertions

Spec: "kill a worker mid-job and assert the frame is **re-queued** and completed by **another** worker."

`server/src/__tests__/integration/crashRecovery.test.ts:61-68`:

```ts
await new Promise((resolve) => setTimeout(resolve, 1500));
doomed.kill('SIGKILL');
spawnWorker('node-healthy');

const completedId = await new Promise<string>((resolve) => {
    events.on('completed', ({ jobId }) => resolve(jobId));
});
expect(completedId).toBe('f1');
```

The kill is genuinely a real `SIGKILL` of a real forked child, which is good. But: (i) no `stalled` QueueEvent listener, so re-queue-via-stall is never verified; (ii) `f1` is the only job, so `toBe('f1')` is near-tautological and the only real gate is the 25s timeout; (iii) mid-job-ness is sleep-assumed (kill at ~2.1s into a 2x1200ms job), so if timing drifted and the doomed worker finished before the kill, the test would pass without exercising recovery at all.

Fix direction: assert a `stalled` event for `f1` fires before completion, and assert the completer identity is `node-healthy` (via the telemetry channel's `nodeId` or the job's final progress payload). To confirm: that BullMQ `QueueEvents` emits `stalled` with `{ jobId }`, and which payload carries completer identity.

### P1-3: Crash-target selection has zero tests (spec-named unit test missing)

Spec Testing: "Unit: Director state machine (SEED->RUN->COMPLETE->RESET transitions, autoscale up/down thresholds, **crash-target selection**). Pure functions, no Redis." No test covers `maybeCrash`'s busy-only filtering and `busy.length <= 1` bail (`runDirector.ts:106-110`) or `createNodePool.crashRandom`. The spec's ">1 node busy" crash rule is enforced by nothing. Same root cause and same fix as P1-1 (purify the selection).

## P2 findings

### P2-1: Kanban cards do not slide between columns

Spec: "cards = frames, **sliding between columns** on stage transitions... On a crash, orphaned cards **slide back** to QUEUED"; the accessibility clause "slides become instant state changes" under reduced motion presumes slides exist. Verified: the only transitions in the web client are progress-bar widths (`KanbanBoard.module.scss:70`, `NodeStrip.module.scss:60`); no FLIP/transform/keyframe animation exists in any web file. Cards jump instantly; reduced-motion users get the same experience as everyone, satisfying the a11y clause only vacuously. Not documented anywhere as a cut.

Fix direction: FLIP-style position animation keyed on the stable `key={frame.id}`, disabled under `prefers-reduced-motion`. To confirm: whether the stable key was left as the hook for an animation pass that was never built.

### P2-2: No telemetry heartbeat

Spec: the `worker:telemetry` channel carries "which node owns which frame, current stage, live %, **heartbeat**, per-node completed count." `worker/src/index.ts` publishes only on `ready`, per-progress-tick, and `completed` (`index.ts:58-63`); no `setInterval` exists in `worker/src/`. An idle worker is silent; orchestrator liveness comes from the child `exit` event instead (`createNodePool.ts:42-45`). That is functional for the demo, but it is not the spec's mechanism and is not documented as a substitution.

Fix direction: low-frequency `publishIdle()` interval, or document the exit-event substitution. To confirm: whether any server-side staleness logic exists that a missing heartbeat silently disables (none found).

### P2-3: Autoscale threshold tests miss exact boundaries and the MIN_NODES bound

`reduceDirector.test.ts:28` tests depth 9 against threshold 6; `:42` tests depth 1 against threshold 2. Implementation uses `>=`/`<=` (`reduceDirector.ts:29-31`); drifting to strict comparisons passes the suite. No test asserts *no kill* at `nodeCount === minNodes`. Note the spec says "exceeds a threshold", which reads strict. Decide the spec-correct inclusivity first, then pin it with boundary cases.

### P2-4: Priority overtaking is unenforced end-to-end

The mechanism, BullMQ `priority: priority ? 1 : 5` at `runDirector.ts:54`, has no test; deleting it leaves the suite green. Existing coverage asserts only the UI sort (`KanbanBoard.test.tsx`) and the reducer flag pass-through. Fix direction: integration test with one concurrency-1 worker, normal frames enqueued first, then a high-priority frame; assert completion order. To confirm: BullMQ prioritized-vs-plain overtaking semantics when jobs pre-exist worker start.

### P2-5: Stage model and plain lifecycle untested; WebSocket contract untested

- `worker/src/stages/processFrame.ts` (RENDERING before COMPOSITING, pct ramp, dual progress emit) is fully dependency-injected yet has zero tests; swapping stage order ships green.
- No happy-path integration test asserts `waiting -> active -> completed` (spec integration clause (a)).
- `server/src/websocket/handleCommand.ts` (pure 5-branch router, `?? 5` inject default) and `createBroadcaster.ts` (snapshot-on-connect, a spec transport clause) have no tests.

## P3 findings (summary)

| # | Finding | Evidence | Status |
|---|---|---|---|
| P3-1 | Full snapshots broadcast, never diffs; also broadcast when state unchanged | `createBroadcaster.ts:11-18`; no diff code anywhere | Documented in README ("renders WorldState snapshots"); spec never amended |
| P3-2 | `STALLED_INTERVAL_MS` default 2000 vs spec ~4000 | `tunables.ts:22`, `worker/src/constants.ts:6` | Documented in README tuning table; serves the spec's recovery goal |
| P3-3 | Permanently failed frames render as DONE at 100% | `applyQueueEvent.ts:9` folds `failed` into `markFrameDone` | Event log does say "failed permanently"; board contradicts stage model |
| P3-4 | QueueEvents `waiting`/`active` not consumed; dead `'active'` union member | `index.ts:54-85` registers 4 kinds; `worldState/types.ts:7` declares 5 | Spec open-question #2 pre-authorized the split; dead type member remains |
| P3-5 | `server/src/constants/`+`types/` replaced by `shared/` workspace | root `package.json:5-10` | Documented in README; better factoring than spec's tree |
| P3-6 | `state/useWorldState`+`useCommands` merged into `useOrchestrator` | `web/src/state/useOrchestrator.ts` | Sound merge (shared socket ref); undocumented |
| P3-7 | Hardcoded `ws://localhost:3001` while server honors `PORT` env | `web/src/config/websocket.ts:3` | Local-only demo, defensible; port drift silently breaks UI |
| P3-8 | `stages/` is a single-file folder (`processFrame.ts`); spec implies two phase modules | `worker/src/stages/` | Shared `runStage` is arguably better; violates R-223 single-file-folder rule |
| P3-9 | Awaited `job.updateProgress` has no server-side consumer (10 dead Redis round-trips/frame) | `processFrame.ts:42-43` | Spec's "and/or" permits dual emit |
| P3-10 | Web test coverage is one ordering assertion; column mapping, badge, node tag, NodeStrip/EventLog/ControlBar untested | `web/src/__tests__/` | README documents narrow scope |
| P3-11 | Load balancing has no direct test (relies on BullMQ contract) | - | Low risk |
| P3-12 | `highPriorityRatio` alone not env-overridable | `tunables.ts:11` | Trivial inconsistency |

## Exceeds-spec (benign)

`GET /health` endpoint; graceful SIGTERM/SIGINT shutdown; crashed-node linger (1500ms) for UX; `JOB_ATTEMPTS`/`MAX_STALLED_COUNT` tunables (the latter necessary: BullMQ's default `maxStalledCount: 1` would break the fault-tolerance headline); native `redis:start`/`redis:stop` scripts alongside Docker (README-documented); disconnect banner, `world.phase` in header, Pause/Resume toggle, `aria-live` event log; per-component SCSS module co-location; `workerShutdown` integration test; jsdom component test.

## Testing-harness verdict

**Honest:** zero mocks anywhere, real Redis, real BullMQ, real forked processes, real signals; reducer tests are genuinely behavioral; no skipped/fixme tests; no anti-patterns (self-mock, tautology-by-mock, snapshot-only) found.

**Under-enforcing:** the suite catches total breakage and any reducer regression, but these spec-named behaviors can drift with a green suite:

| Spec behavior | Enforcement |
|---|---|
| Pause suppresses Director drama | **Broken today, no test can catch it** (P1-1) |
| Crash-target selection (>1 busy rule) | UNCOVERED (P1-3) |
| Re-queued + completed by another worker | Assertions absent (P1-2) |
| Priority overtaking (queue level) | UNCOVERED (P2-4) |
| Stage order + progress emission | UNCOVERED (P2-5) |
| WS snapshot-on-connect, command routing | UNCOVERED (P2-5) |
| Autoscale exact boundaries, MIN_NODES floor | UNCOVERED (P2-3) |
| Load balancing distribution | UNCOVERED (P3-11) |

Covered well: SEED->RUN->COMPLETE->RESET transitions, pause/resume phase preservation, world-state merge reducers (11 behavioral tests including stalled->QUEUED and node-clear), graceful SIGTERM shutdown (exit-code assertion), real-SIGKILL recovery existence (the timing-risk validation the spec demanded), UI priority ordering.

## Recommended order of work

1. P1-1 + P1-3 together: purify crash selection into the reducer (one refactor fixes the bug and unlocks the spec-named unit tests). Test-first per R-201.
2. P1-2: strengthen the headline test's assertions (stalled event + completer identity).
3. P2-1 (card slides): the spec's primary graphic; either implement or explicitly cut it and amend the spec.
4. P2-3/P2-4/P2-5 enforcement gaps.
5. Reconcile documentation: amend the spec (or README) for snapshots-vs-diffs, `STALLED_INTERVAL_MS` 2000, `shared/` workspace, `useOrchestrator`, and the heartbeat substitution, so the next conformance pass has a truthful baseline.
