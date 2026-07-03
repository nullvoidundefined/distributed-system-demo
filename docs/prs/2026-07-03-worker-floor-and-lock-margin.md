# Maintain the MIN_NODES floor and lengthen the worker lock

**Branch:** `fix/node-floor-and-lock-margin` -> `main`
**Date:** 2026-07-03 (same session as the freeze fix, PR #1)
**Type:** fix

## Summary

Two robustness follow-ups called out in the freeze-fix write-up (`docs/prs/2026-07-03-worldstate-done-terminal-idempotent.md`):

1. The worker pool could sit below `MIN_NODES` after a crash until queue depth happened to trigger a scale-up. The Director now replenishes the floor on the next tick.
2. `LOCK_DURATION_MS` (4000) was shorter than a frame's total work (2 x `STAGE_MS` = 5000), so a worker legitimately still processing a frame could be declared stalled and re-processed. Raised to 6000 so the lock outlasts a full frame.

## What changed

- `server/src/services/director/reduceDirector.ts` - `run` spawns a replacement when `nodeCount < minNodes`, before considering queue-depth scaling. One spawn per tick, converges back to the floor.
- `server/src/config/tunables.ts` - `LOCK_DURATION_MS` default 4000 -> 6000.
- `server/src/__tests__/reduceDirector.test.ts` - two new tests (floor replenished below min; no spurious spawn at min), written failing first.
- `README.md` - tunables table and the crash-recovery note updated for the new lock value and the floor behavior.

## The two changes

### Node floor

Previously the only spawn path was autoscale-up (`queueDepth > SCALE_UP_DEPTH`). After a crash during a shallow queue, the pool could hold below `MIN_NODES` indefinitely (the original screenshot's "1 nodes"). The floor check is a safety constraint distinct from drama-driven scaling, so it takes priority over the queue-depth branches and runs regardless of depth. It stays one spawn per tick, so a pool that lost several nodes climbs back one at a time rather than thrashing.

The crash guard (`busyNodeIds.length > 1`) already prevents the Director from crashing the last busy node, so the floor and the crash logic do not fight: the pool cannot be driven below one by autonomous drama, and an operator kill that drops it below the floor is repaired on the next tick.

### Lock margin

BullMQ renews a worker's lock at `lockDuration / 2` while the processor runs, so in principle renewal covers work longer than the lock. In practice, with the lock (4000) below a frame's total work (5000) on the accelerated clock, a delayed renewal under load could let the lock lapse and a still-working frame be re-queued and completed twice. The idempotent world-state fold from PR #1 already makes duplicate completions harmless, but the spurious re-processing is wasted work and shows a frame bouncing back to QUEUED with no real crash. Setting the lock above a full frame's work removes the dependency on renewal timing for correctness: only a genuinely dead worker's lock lapses.

Recovery latency is bounded by `LOCK_DURATION_MS + STALLED_INTERVAL_MS`, now 6000 + 2000 = 8000 ms worst case (was 6000). Still inside the watchable window; the README note is updated to say roughly 6 to 8 seconds.

## Architectural decisions

- **Floor enforcement lives in the pure reducer, not the pool's exit handler.** Chosen so all scaling policy (up, down, floor) stays in one tested place (`reduceDirector`), consistent with the design's "the Director owns scaling." Alternative considered: respawn immediately inside `createNodePool`'s `onExit`. Rejected because it splits scaling policy across the reducer and the wiring, and the reducer is the unit-testable seam. Cost: replenishment takes up to one drama interval (<=10s) rather than being instant, which is acceptable and matches the demo's cadence.
- **Raise the lock rather than lower the stage time.** Lowering `STAGE_MS` would also make the lock relatively longer, but it changes the visible pacing of the board. The lock is the knob that should track "how long may a worker legitimately hold a frame," so it is the one to lift above total work.
- **Left the crash-recovery integration test's explicit `LOCK_DURATION_MS='4000'` alone.** That test uses `STAGE_MS='1200'` (total work 2400), so its lock already exceeds its work; it is a self-contained scenario, not an assertion of the production default, so the default change does not make it stale.

## Testing

- Test-first: two new `reduceDirector` tests, confirmed failing then green.
- `npx vitest run` on the four non-integration server unit files: 42/42 pass. `tsc --noEmit` clean.
- Integration suite intentionally not run (shares and flushes the Redis the live demo uses).
- Live: forced repeated operator kills against the running demo and confirmed the pool drops toward the floor and is replenished back to `MIN_NODES`, never stuck below it.

## Reflection

The floor gap was visible in the very first screenshot ("1 nodes") but was correctly deferred while the freeze was the priority; it is a smaller robustness issue, not a correctness break, because the pool self-heals as soon as the queue grows. Writing the reducer test first made the placement decision obvious: the floor is just another branch of the same scaling decision, so it belongs beside the up/down branches, not bolted onto the exit handler. The lock change is the one place a config value, not code, was the right lever, and pairing it with PR #1's idempotent fold means duplicates are both rarer and harmless.
