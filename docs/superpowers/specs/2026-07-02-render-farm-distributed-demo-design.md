# Render Farm - Distributed System Demo

**Status:** Approved design
**Date:** 2026-07-02

## Purpose

A visual, self-running demo of a distributed job-processing system built on **real Redis + real BullMQ**. It depicts a **render farm**: frames enter a shared queue and are processed by worker nodes running as **separate OS processes**. The demo runs on an accelerated clock (events every ~5-10s), is **cyclical** (starts empty, drains to all-complete, resets, repeats), and showcases four distributed-systems behaviors: load balancing, fault tolerance/retries, autoscaling, and job priorities. A browser UI shows a Kanban board, a live worker-node strip, and a scrolling event log, plus optional manual controls.

## Non-goals (YAGNI)

- Not deploy-ready for Railway; local demo only (Redis via Docker).
- No real rendering; "work" is simulated time in stages.
- No auth, no persistence beyond Redis, no multi-user coordination.
- No full E2E suite (optional single Playwright smoke test only).

## Architecture

### Process topology

```
+----------- Docker -----------+
|  Redis  (BullMQ + pub/sub)   |
+-------^--------------^--------+
        |              |
  +-----+--------------+----------------------+
  |  Orchestrator (Express) - control plane   |
  |   - owns BullMQ Queue (render jobs)       |
  |   - Director: autonomous cycle engine     |
  |   - forks / SIGKILLs worker child procs   |
  |   - listens: QueueEvents + Redis pub/sub  |
  |   - broadcasts world-state over WebSocket |
  +--^------------+-------------+--------------+
     | fork()     | fork()      | WebSocket
 +---+----+  +----+---+    +----+---------+
 |worker1 |  |worker2 | .. |  Vite SPA    |
 |(pid)   |  |(pid)   |    | kanban+nodes |
 +--------+  +--------+    | +log+controls|
  each = own BullMQ Worker +--------------+
  + own Redis connection
```

- **Control plane** = the Express orchestrator: owns the queue, runs the Director, manages the worker pool, aggregates state, serves the UI.
- **Data plane** = worker child processes, each a `fork()`ed Node process with its own Redis connection and BullMQ `Worker`.
- **View** = the browser SPA. It never talks to Redis; it only consumes world-state snapshots and sends commands over WebSocket.

### Two channels of truth (one per concern)

- **BullMQ `QueueEvents`** for authoritative job lifecycle (`waiting`/`active`/`completed`/`failed`/`stalled`) and queue counts.
- **Redis pub/sub channel `worker:telemetry`** for node-level detail BullMQ does not cheaply give: which node owns which frame, current stage, live %, heartbeat, per-node completed count. Workers publish; orchestrator subscribes.

The orchestrator's `worldState` service merges both into one snapshot and broadcasts it throttled (~5 Hz) to browsers.

## Job & stage model

A job = **one render frame**. Stages map directly to Kanban columns:

`QUEUED` -> `RENDERING` (worker phase 1, ~2-3s) -> `COMPOSITING` (worker phase 2, ~2-3s) -> `DONE`

- End-to-end a frame takes ~5-7s, so movement is continuously visible.
- Frames carry `{ id, cycle, priority }`. Some are flagged **high-priority** (BullMQ `priority`) and overtake normal frames in `QUEUED`.
- During processing the worker emits progress as structured `{ stage, pct, nodeId }` (via BullMQ `updateProgress` and/or the telemetry channel).

## The Director (autonomous cyclical engine)

A **cycle** = one batch of frames from empty to all-complete. State machine:

1. **SEED** - cycle starts empty; enqueue a batch (~12-20 frames, a few high-priority).
2. **RUN** - workers pull frames (load-balanced by the shared queue). On 5-10s ticks the Director injects scripted drama:
   - random **node crash** (real `SIGKILL`) when >1 node is busy;
   - **autoscale-up** (`fork` a worker) when queue depth exceeds a threshold;
   - **autoscale-down** (graceful `close`) as the queue drains below a threshold.
3. **COMPLETE** - when queue is empty *and* all frames `DONE`, hold a brief "cycle complete" beat.
4. **RESET** - increment cycle number, clear the board, return to SEED. Repeats forever.

Manual controls (inject / kill node / pause / reset) feed the **same command path** the Director uses, so there is one code path for each action.

### Tunables (in `config/`)

| Tunable | Default | Purpose |
|---|---|---|
| `BATCH_SIZE` | 16 | frames seeded per cycle |
| `HIGH_PRIORITY_RATIO` | ~0.15 | fraction of frames flagged high-priority |
| `TICK_MS` | 5000-10000 | Director drama interval |
| `STAGE_MS` | 2000-3000 | per-stage simulated work |
| `MIN_NODES` / `MAX_NODES` | 2 / 6 | autoscale bounds |
| `SCALE_UP_DEPTH` / `SCALE_DOWN_DEPTH` | tuned | queue-depth thresholds |
| `STALLED_INTERVAL_MS` | ~4000 | BullMQ stalled-check (default 30000 too slow) |
| `LOCK_DURATION_MS` | tuned | worker lock, paired with stalled interval |

## Behavior realization

| Behavior | Mechanism |
|---|---|
| **Load balancing** | Shared BullMQ queue; whichever worker is free processes the next frame. No faking. |
| **Fault tolerance / retries** | A crash is a **real `SIGKILL`** of a worker child mid-job. Its Redis lock expires; BullMQ **stalled-job detection re-queues** the orphaned frame to a surviving worker. `STALLED_INTERVAL_MS` tuned to ~4s so recovery lands within ~4-8s (demo-visible). |
| **Autoscaling** | Director watches queue depth; `fork()` a new `worker.js` on backlog, gracefully `close()` one as it drains. Node cards appear/disappear in the strip. |
| **Priorities** | High-priority frames enqueued with BullMQ `priority`, overtaking normal frames; distinct card style. |

### Key technical risk (validate early)

Crash-to-recovery latency is governed by `STALLED_INTERVAL_MS` / `LOCK_DURATION_MS`. Real `SIGKILL` + BullMQ stalled recovery is authentic but timing-sensitive on the accelerated clock. **Validate in the integration test first.** If real-kill recovery proves too fiddly, the fallback is a **soft crash**: the worker throws inside the processor, triggering BullMQ `attempts` retry immediately. It looks nearly identical on screen. Real kill is the goal; soft-crash is the documented safety net.

## Frontend (Vite + React SPA)

One page, four regions, driven entirely by the world-state snapshot:

```
+------------------------- header --------------------------+
|  RENDER FARM . Cycle #7 . 14/20 frames done . 3 nodes     |
|  [ Pause ] [ + Inject 5 ] [ Kill a node ] [ Reset ]       |
+------------------------ kanban board ---------------------+
|  QUEUED        RENDERING       COMPOSITING     DONE        |
|  [] f18 *      [] f12 (node1)  [] f09 (node3)  ok f01      |
|  [] f19        [] f15 (node2)                   ok f02 ..  |
+------------------- worker-nodes strip --------------------+
| [node1 pid101 ###. 72% f12] [node2 pid102 #.. 20% f15]    |
| [node3 pid103 ##. 55% f09] [node4 SPAWNING..]             |
+----------------------- event log -------------------------+
| 12:04:03  node4 crashed (SIGKILL) - frame f11 orphaned    |
| 12:04:07  frame f11 re-queued after stall, node2 took it  |
| 12:04:08  backlog=9 -> autoscaling up (node5)             |
+-----------------------------------------------------------+
```

- **Kanban board** (primary graphic): cards = frames, sliding between columns on stage transitions; in-flight cards tagged with owning node. On a crash, orphaned cards slide back to `QUEUED`. High-priority frames get a badge.
- **Worker-nodes strip**: one card per live process: pid, status (idle/rendering/compositing/crashed/spawning), current frame, live progress bar, completed count. Cards appear/disappear with autoscaling.
- **Event log**: scrolling semantic feed, color-coded by severity; the human-readable narration of what the graphics show.
- **Control bar**: sends commands over the same WebSocket.

Accessibility: motion respects `prefers-reduced-motion` (slides become instant state changes); semantic HTML; native `<button>` controls; WCAG AA contrast.

## Transport

**WebSocket**, bidirectional:
- server->browser: initial full snapshot on connect, then throttled (~5 Hz) diffs;
- browser->server: control commands (pause/inject/kill/reset).

A late-joining browser gets a full snapshot on connect, so opening the page mid-cycle shows correct state.

## Project structure

Self-contained (not the full monorepo) but following the spirit of the conventions: `services/`/`clients/` split, one responsibility per file, descriptive names, file-level header comments.

```
distributed-system-demo/
+- docker-compose.yml            # redis
+- package.json                  # workspaces: server, worker, web
+- server/
|  +- src/
|     +- index.ts              # express + ws bootstrap
|     +- config/               # env, tunables
|     +- constants/            # stage names, event types, queue name
|     +- types/                # WorldState, Frame, NodeStatus, Event, Command
|     +- clients/
|     |  +- redis/             # connection factory (one file per lifecycle fn)
|     +- queue/                # BullMQ Queue + QueueEvents setup
|     +- services/
|     |  +- director/          # cycle engine: seed, tick, crash, scale, reset
|     |  +- nodePool/          # fork/kill/track worker child processes
|     |  +- telemetry/         # subscribe worker:telemetry -> world state
|     |  +- worldState/        # merge sources -> snapshot, diff, throttle
|     +- websocket/            # broadcaster + command handler
+- worker/
|  +- src/
|     +- index.ts              # BullMQ Worker entry (own redis conn)
|     +- stages/               # render phase, composite phase (progress emit)
|     +- telemetry/            # publish node status/progress to pub/sub
+- web/
   +- src/
      +- main.tsx
      +- state/                # useWorldState hook (ws client), useCommands
      +- components/
      |  +- KanbanBoard/
      |  +- NodeStrip/
      |  +- EventLog/
      |  +- ControlBar/
      +- styles/               # SCSS modules
```

## Running

```
docker compose up -d        # redis
npm run dev                 # concurrently: server + vite web (server forks workers)
# open http://localhost:5173
```

## Testing

- **Unit**: Director state machine (SEED->RUN->COMPLETE->RESET transitions, autoscale up/down thresholds, crash-target selection) and world-state merge/diff logic. Pure functions, no Redis.
- **Integration**: against **real Redis + real BullMQ**: enqueue frames, run a worker, assert lifecycle; and the headline case, kill a worker mid-job and assert the frame is re-queued and completed by another worker. Validates the timing risk early.
- **Optional**: a single Playwright smoke test: load the page, assert a cycle reaches all-complete.

## Open questions / to validate first

1. **Stalled-recovery timing** on the accelerated clock: validate `STALLED_INTERVAL_MS`/`LOCK_DURATION_MS` in the integration test before building UI polish. Soft-crash fallback documented above.
2. Whether progress is carried via BullMQ `updateProgress` alone or the dedicated telemetry channel: resolve during the queue/telemetry slice (leaning: lifecycle via QueueEvents, node status + intra-job progress via pub/sub).

## Post-implementation amendments (2026-07-02)

Resolutions and deliberate deviations ratified after the build and the spec-conformance audit (`docs/audits/2026-07-02-spec-conformance.md`):

1. **Open question 1 resolved:** real-`SIGKILL` recovery works on the accelerated clock; the soft-crash fallback was never needed and does not exist. `STALLED_INTERVAL_MS` landed at 2000 (tighter than the ~4000 sketched above) so recovery stays inside the 4-8s window with `LOCK_DURATION_MS` 4000.
2. **Open question 2 resolved:** lifecycle rides QueueEvents (`added`/`completed`/`stalled`/`failed`); node status and intra-frame progress ride the `worker:telemetry` pub/sub channel exclusively. `updateProgress` is not used.
3. **Transport sends full snapshots, not diffs:** at demo scale a snapshot is small enough that diffing buys nothing, and every message doubles as late-join state. The "diffs" wording above is superseded.
4. **Shared contract package:** stage names, event types, queue name, and all wire types live in a fourth workspace, `shared/` (`@demo/shared`), instead of `server/src/constants|types/`, because worker and web consume the same contract.
5. **Web state hook:** `state/useOrchestrator` merges the sketched `useWorldState` + `useCommands` (one socket serves both concerns).
6. **Autoscale comparisons are strict** ("exceeds" / "drains below"), pinned by boundary unit tests.
7. **Extra resilience tunables:** `JOB_ATTEMPTS` (20) and `MAX_STALLED_COUNT` (10) exist so a crashed frame re-queues instead of failing permanently; a frame that somehow exhausts them lands in `DONE` (so a cycle cannot deadlock) but carries a `failed` flag rendered as a red-bordered `FAILED` card, and the event log records `failed permanently`.
8. **Operator kill bypasses pause:** pause freezes the Director's autonomous drama (seed/scale/crash); the manual `Kill a node` control still works while paused.
