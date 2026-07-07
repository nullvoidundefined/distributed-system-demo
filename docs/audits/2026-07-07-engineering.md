# Engineering Audit: Domain Naming & Structure

Date: 2026-07-07
Role: Engineering (CTO)
Scope: two operator-reported problems. (1) non-service files inside service folders, (2) domain-naming coherence across `server/`, `web/`, `shared/`, `worker/`.
Method: interactive call-and-response review, one term at a time, each decision backed by grep/import evidence.

## System under review

A distributed render-farm demo. An orchestration engine drives cycles; each cycle seeds `Frame`s onto a BullMQ queue; a pool of worker child processes pulls frames through `Stage`s (`RENDERING`, `COMPOSITING`, `DONE`); telemetry streams back over Redis pub/sub and a WebSocket to the web client.

## Organizing finding: metaphor coherence

The codebase speaks one metaphor almost everywhere: **film/VFX production** (`Frame`, `render`, `composite`, `Stage`, `cycle`, and the coordinating "director"). That coherence is what makes the outliers legible. Three terms imported foreign metaphors:

- **World** (`WorldState`, `emptyWorld`): game-engine / simulation vocabulary. The core mismatch.
- **seed / seeding**: gardening. Mild; also an established software idiom.
- **KanbanBoard**: agile / PM / manufacturing.

## Naming decisions

| # | Term | Decision | Rationale |
|---|---|---|---|
| 1 | `WorldState` / `WorldStore` / `emptyWorld` / `worldState/` | to `RenderState` / `RenderStore` / `emptyRenderState` / `renderState/` | Aggregate holds `frames` + `nodes` + `events` + `totals`; `RenderState` reads clean across all fields (no `framesState.frames` stutter, no `boardState.nodes` narrowing) and stays on-domain. |
| 2 | `seed` / `seeding` | **kept** | Established software idiom (seed data), not a true metaphor break. Low harm. Renaming was optional; declined. |
| 3 | `KanbanBoard` | to `RenderDisplay` | Drops the agile/PM metaphor. Renders `renderState.frames` grouped by stage. |
| 4 | `WorkerNode` | to `RenderNode` | Only name fusing "worker" + "node." "worker" stays for the process/BullMQ layer (`worker/`), "node" for the domain entity, consistent with `NodePool`/`NodeStrip`/`nodeId`/`killNode`. "node" is on-domain (render farms have render nodes). |
| 5 | `Director*` / `director/` | to `Orchestrator*` / `orchestrator/` | BullMQ is the real scheduler; the engine orchestrates (seed, autoscale, chaos, cycle lifecycle). "Orchestrator" already exists in the codebase (`useOrchestrator`, banner, server role), so unifying removes the Director/orchestrator split with zero web-side renames. |
| 6 | `phase` / `DirectorPhase` | to `status` / `OrchestratorStatus` | Original `phase`/`Stage` pairing was defensible, but "status" avoids any `step`/`stage` synonym clash and reads naturally for `seeding/running/complete/paused`. |

Rejected alternatives worth recording:

- `FarmState`, `BoardState`, `FramesState` for the aggregate. `BoardState`/`FramesState` narrow the name to `frames` while the type also holds worker-process state and a system log; `RenderState` chosen instead.
- `Scheduler` for the engine. Collides semantically with BullMQ's actual job scheduling.
- `step` for the lifecycle. Synonym of the existing `Stage` used for per-frame pipeline position; rejected to avoid conflation.

## Problem 1: non-service files in service folders

Claim under test: constants/types mixed into service folders should live elsewhere. Import tracing (grep of every consumer) resolves this per-file rather than wholesale, applying the operator's own test ("is it actually shared?").

| File / member | Real consumers | Verdict |
|---|---|---|
| `worldState/constants.ts` (`MAX_EVENTS`) | only `appendEvent.ts` | **Inline, delete file** |
| `QueueEventInput` (in `types.ts`) | only `applyQueueEvent.ts` | **Inline into that file** |
| `WorldStore`/`RenderStore` (in `types.ts`) | index, broadcaster, runOrchestrator, createRenderStore, subscribeTelemetry (6 files) | **Keep, genuinely shared** |
| `director/types.ts` | reduceOrchestrator + runOrchestrator + index + test | **Keep, shared** |
| `nodePool/types.ts` | createNodePool + runOrchestrator + index | **Keep, shared** |

Conclusion: "a lot of non-service files" resolves to **one file to delete** and **one type to inline**. The remaining three type-modules are shared across multiple files (some cross-service) and correctly earn their own file per R-307/R-319. Co-location is the prescribed pattern, not a violation. No top-level `types/`/`constants/` hoist and no R-307 override needed.

## Execution

Cross-cutting refactor (~30 files incl. tests) on branch `refactor/domain-naming` per R-511. One commit per ledger row, `tsc --noEmit` green between each, full vitest suite at pre-push. No behavior changes: pure rename + inline.
