# PR: Domain-naming refactor

Branch: `refactor/domain-naming`
Date: 2026-07-07
Time since implementation: the render-farm code was first written 2026-07-02 (commit `e64c35e`), so this rename lands ~5 days after the code it renames.

## Summary

Pure rename + inline pass to make the codebase speak one domain metaphor (film/VFX render production) and to remove foreign-metaphor vocabulary. No behavior changes. Backed by the interactive audit in `docs/audits/2026-07-07-engineering.md`.

## What changed

Six naming rows plus one structural inline, one commit each:

| Commit | Change |
|---|---|
| Row 1 | `WorldState`/`WorldStore`/`emptyWorld`/`worldState/` to `RenderState`/`RenderStore`/`emptyRenderState`/`renderState/` |
| Row 4 | `WorkerNode` type to `RenderNode` |
| Row 5 | `Director*` engine and `director/` folder to `Orchestrator*` and `orchestrator/` |
| Row 6 | lifecycle `phase`/`DirectorPhase` to `status`/`OrchestratorStatus` |
| Row 3 | `KanbanBoard` component to `RenderDisplay` |
| Problem 1 | inline `MAX_EVENTS` into `appendEvent.ts` and `QueueEventInput` into `applyQueueEvent.ts`; delete `renderState/constants.ts` |

`seed`/`seeding` was reviewed and deliberately kept (established software idiom, not a metaphor break). The shared `RenderStore` type stayed in `renderState/types.ts` because six files consume it.

## Architectural decisions

- **Aggregate state name.** Chosen: `RenderState`. Alternatives: `FarmState`, `BoardState`, `FramesState`. Why: the aggregate holds `frames` + `nodes` + `events` + `totals`; `BoardState`/`FramesState` narrow the name to the frames view and read badly against `.nodes` (worker PIDs) and `.events` (system log). `RenderState` reads clean across every field with no stutter.
- **Coordinating engine name.** Chosen: `Orchestrator`. Alternative: `Scheduler`. Why: BullMQ is the real job scheduler; the engine orchestrates (seed, autoscale, chaos, cycle lifecycle). "Orchestrator" already existed in the codebase (`useOrchestrator`, banner, server role), so unifying removed the `Director`/`orchestrator` split with zero web-side renames.
- **Lifecycle field name.** Chosen: `status`. Alternative: `step`. Why: `step` is a synonym of the existing `Stage` (per-frame pipeline position) and would conflate two distinct concepts. `status` reads naturally for `seeding/running/complete/paused` and avoids the clash.
- **Structural placement.** Chosen: inline only the two genuinely single-use members; keep the three shared type-modules co-located per R-307/R-319. Alternative: hoist all types/constants to top-level `types/`/`constants/`. Why: import tracing showed only `MAX_EVENTS` and `QueueEventInput` have a single consumer; the rest are shared across services and correctly earn their own file. No R-307 override needed.

## Testing

- `tsc --noEmit` green across all four workspaces (`server`, `web`, `shared`, `worker`) after every commit.
- Unit/component suites green: 42 server + 12 web.
- Web ESLint clean.
- Integration suite: 6 of 8 pass. Two (`loadBalancing`, and one heartbeat/crash test) fail on this branch. Verified they fail identically on `main`: the autoscaler spawns nondeterministic extra nodes and the assertions are too strict. Pre-existing flakiness, not introduced here, and out of scope for a rename. Flagged as tech-debt for a separate PR.

## Reflection

- What is clearer now: the codebase already had a strong, consistent film/VFX metaphor; the only real problems were three imported metaphors (`World` game-engine, `Kanban` agile, and to a lesser degree `seed` gardening). Naming the aggregate was the hardest call because the frames view is genuinely a board, but the state object is broader than the board.
- What was wrong first: the initial instinct to hoist all types/constants out of service folders. Import tracing showed the operator-reported "a lot of non-service files" was actually one deletable constant and one inlineable type; the rest are the R-307 co-location pattern working as intended, not a violation.
