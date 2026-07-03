# Stop the render board freezing when `done` overshoots `total`

**Branch:** `fix/telemetry-done-resurrection` -> `main`
**Date:** 2026-07-03 (fix committed ~11 minutes before this doc, same session)
**Type:** fix

## Summary

The live board froze with a drained queue that never reset, and frames (usually two) got stuck at 100% in COMPOSITING. Two separate world-state fold bugs caused it, both provoked by BullMQ at-least-once delivery and the fact that the queue-lifecycle channel and the worker-telemetry channel are unordered relative to each other. This PR makes the fold treat DONE as terminal and count each frame's completion exactly once.

## What changed

- `server/src/services/worldState/applyTelemetry.ts` - telemetry no longer moves a frame that is already `DONE`. Guard added to the frame-sync condition (`frame.stage !== 'DONE'`); the node upsert is unchanged, so live node status still updates.
- `server/src/services/worldState/applyQueueEvent.ts` - `markFrameDone` now increments `done` only when a matching, not-already-DONE frame transitions into DONE. A duplicate completed/failed event, or one for an unknown frame, is a no-op.
- `server/src/__tests__/worldStateReducers.test.ts` - three new tests (one per failure mode) written failing first.

## The two root causes

### Bug 1: telemetry resurrected DONE frames (stuck in COMPOSITING)

A frame's final progress telemetry (`stage=COMPOSITING, pct=100`) is published on Redis pub/sub, while its `completed` lands on the BullMQ QueueEvents channel. The two are unordered. When the telemetry arrived after the completed event, `applyTelemetry` overwrote the frame's stage and dragged it back out of DONE into COMPOSITING, where nothing further touched it. Live evidence: `done/total=10/16` with only `D9` in the DONE column and `f7-103@node-10(100%)` frozen in COMPOSITING for the entire cycle.

### Bug 2: `done` counted per event, not per frame (the freeze)

`markFrameDone` incremented `done` on every completed/failed event. BullMQ delivers at least once, and a false stall (worsened here because `LOCK_DURATION_MS`=4000 is shorter than the 5000 ms of total per-frame work) causes a job to be re-processed and re-completed. Each duplicate pushed `done` past `total`. The Director resets a cycle only when `total - done === 0`; once `done` overshot, that gauge skipped zero and went negative, so the cycle never completed. Caught live at `done/total=21/16, remaining=-5`. The same unknown-frame path explains the original screenshot's impossible `9/0`: after a dev-server restart, `completed` events for pre-restart jobs whose frames no longer existed inflated `done` against a `total` of 0.

## Architectural decisions

- **Make the fold idempotent and terminal-aware, rather than tune timing.** Chosen because duplicate and out-of-order lifecycle events are an inherent property of an at-least-once queue, not an anomaly to eliminate. The world-state fold is the correct place to enforce that DONE is terminal and each frame completes once. Alternative considered: raise `LOCK_DURATION_MS` above total frame work to suppress false stalls. Rejected as primary fix because it only reduces the frequency of duplicates; the fold would still be wrong under any duplicate, and the counter could still drift. (Raising the lock is a reasonable secondary tuning follow-up, not required for correctness.)
- **Keep `done` as an incremental counter guarded by a transition check, rather than deriving it from `frames.filter(DONE).length` on every update.** Chosen for a minimal, local change that preserves the existing incremental-totals design. Deriving would be robust too but is a larger refactor of the totals model for no additional correctness given the transition guard.
- **`applyTelemetry` still upserts the node for a DONE frame's telemetry.** The node message is valid (the worker really is reporting its state and completed count); only the frame must not regress. The guard is scoped to the frame map, not the node upsert.

## Testing

- Test-first: three new tests in `worldStateReducers.test.ts` (DONE not resurrected by late telemetry; duplicate completed counts once; completed for unknown frame does not inflate `done`). Confirmed failing against the old code, then green.
- `npx vitest run` on the four non-integration server unit files: 40/40 pass. The integration suite was intentionally not run because it shares (and flushes) the Redis the live demo uses.
- Server typecheck (`tsc --noEmit`) clean.
- Verified live over cycles 3 to 5 via a WebSocket snapshot observer: `done` tracks `total` exactly, the DONE column matches `done` one to one, no frames stick in COMPOSITING, and cycles complete and reset.

## Reflection

The first read of the screenshot pointed at "added events not folding" because `total=0` looked like frames were never created. That was wrong: added folding works fine, and the `9/0` was phantom `done` counted for frames that did not exist after a restart. The lesson was to stop reasoning from the static image and gather live evidence; the per-second snapshot observer immediately showed both the resurrection (done count ahead of the DONE column) and the overshoot (`done` climbing past `total`), which a single frame could never have revealed. The two bugs also turned out to share one theme once seen side by side: the fold trusted best-effort, at-least-once event streams as if they were exactly-once and ordered.

## Out of scope (follow-ups)

- The pool can run below `MIN_NODES` after a crash until queue depth grows again (the screenshot's "1 nodes"). Cosmetic; self-heals.
- `LOCK_DURATION_MS` < total frame work invites the false stalls that produce duplicate completions. The fold is now correct regardless, but raising the lock would reduce the churn.
