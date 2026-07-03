# Render Farm - Distributed System Demo

A self-running, cyclical visual demo of a distributed job-processing system built on **real Redis + real BullMQ**. It depicts a render farm: frames enter a shared queue and are processed by worker nodes running as **separate OS processes**. The demo runs on an accelerated clock (events every ~5-10s), starts empty, drains every frame to done, resets, and repeats forever. A browser UI shows a Kanban board, a live worker-node strip, and a scrolling event log, plus operator controls.

## What it demonstrates

| Behavior                      | How it works                                                                                                                                                                     | Where you see it                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Load balancing**            | A shared BullMQ queue; whichever worker is free pulls the next frame.                                                                                                            | Frames spread across nodes in the Kanban board and node strip.                                                                                    |
| **Fault tolerance / retries** | A "crash" is a real `SIGKILL` of a worker child process mid-frame. Its Redis lock expires and BullMQ's stalled-job detection re-queues the orphaned frame to a surviving worker. | A node card goes red, its frame slides back to `QUEUED`, then completes on another node. Log shows `crashed (SIGKILL)` then `stalled; re-queued`. |
| **Autoscaling**               | The Director watches queue depth: deep backlog forks a new worker process, a draining queue gracefully retires an idle one.                                                      | Node cards appear and disappear. Log shows `autoscaling up/down`.                                                                                 |
| **Job priorities**            | High-priority frames are enqueued with BullMQ `priority` and overtake normal frames.                                                                                             | Purple-bordered `PRIORITY` cards jump toward the front of `QUEUED`.                                                                               |

## Architecture

```
+----------- Redis (BullMQ queue + pub/sub) -----------+
+--------^------------------------------^--------------+
         |                              |
  +------+------------------------------+--------------+
  |  Orchestrator (Express) - control plane            |
  |   - owns the BullMQ Queue of render frames         |
  |   - Director: autonomous cycle engine (seed / tick |
  |     / crash / autoscale / reset)                   |
  |   - forks and SIGKILLs worker child processes      |
  |   - merges QueueEvents + telemetry into WorldState |
  |   - broadcasts WorldState over WebSocket           |
  +--^--------------+-----------------+----------------+
     | fork()        | fork()          | WebSocket
 +---+----+     +----+---+       +-----+--------+
 | worker |     | worker |  ...  |  Vite + React |
 | (pid)  |     | (pid)  |       |  SPA (view)   |
 +--------+     +--------+       +---------------+
  each = its own BullMQ Worker + Redis connection
```

- **Control plane** (`server/`): owns the queue, runs the Director, manages the worker pool, aggregates state, serves the UI over WebSocket.
- **Data plane** (`worker/`): each node is its own forked Node process with a BullMQ `Worker` and its own Redis connection. It runs each frame through `RENDERING` then `COMPOSITING`, publishing progress telemetry over Redis pub/sub.
- **View** (`web/`): a Vite/React SPA. It never touches Redis; it only renders `WorldState` snapshots and sends operator commands.
- **Contract** (`shared/`): the `@demo/shared` package holds the types and constants all three speak.

Two channels of truth: BullMQ `QueueEvents` is authoritative for job lifecycle (`added`/`completed`/`stalled`); a Redis pub/sub channel carries fine-grained node status and intra-frame progress. The orchestrator merges both into one `WorldState` broadcast at ~5 Hz.

## Prerequisites

- Node 20+ (developed on Node 25)
- A Redis server on `localhost:6379`

Redis can come from either:

- **Native (recommended here):** `npm run redis:start` (uses a local `redis-server`; stop with `npm run redis:stop`), or
- **Docker:** `docker compose up -d` (starts `redis:7-alpine`).

## Run it

```bash
npm install
npm run redis:start      # or: docker compose up -d
npm run dev              # starts the orchestrator (which forks workers) + the Vite SPA
# open http://localhost:5173
```

Leave it running and it cycles on its own. Or drive it with the controls:

- **Pause / Resume** - freeze and resume the autonomous Director.
- **+ Inject 5** - add five frames to the current cycle.
- **Kill a node** - `SIGKILL` a busy worker to watch fault recovery.
- **Reset** - clear the board and restart the cycle.

## Ports

- Web SPA: `5173`
- Orchestrator HTTP + WebSocket: `3001`
- Redis: `6379`

## Tuning

All timing and threshold knobs live in `server/src/config/tunables.ts` and can be overridden by environment variables. Key ones:

| Env var                               | Default      | Meaning                                                                      |
| ------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `BATCH_SIZE`                          | 16           | Frames seeded per cycle.                                                     |
| `TICK_MIN_MS` / `TICK_MAX_MS`         | 5000 / 10000 | Director drama interval (randomized per tick).                               |
| `STAGE_MS`                            | 2500         | Simulated work per stage.                                                    |
| `MIN_NODES` / `MAX_NODES`             | 2 / 6        | Autoscale bounds.                                                            |
| `SCALE_UP_DEPTH` / `SCALE_DOWN_DEPTH` | 6 / 2        | Queue-depth thresholds for scaling.                                          |
| `LOCK_DURATION_MS`                    | 4000         | Worker lock TTL; a crashed worker's frame is recoverable after this expires. |
| `STALLED_INTERVAL_MS`                 | 2000         | How often a worker checks for stalled (orphaned) frames.                     |
| `HEARTBEAT_INTERVAL_MS`               | 2000         | How often an idle worker re-announces itself on the telemetry channel.       |
| `HIGH_PRIORITY_RATIO`                 | 0.15         | Fraction of seeded frames flagged high-priority.                             |
| `JOB_ATTEMPTS` / `MAX_STALLED_COUNT`  | 20 / 10      | Retry headroom so crashed frames re-queue instead of failing permanently.    |

Autoscale thresholds are strict comparisons per the design spec: scale up when depth *exceeds* `SCALE_UP_DEPTH`, scale down when it drains *below* `SCALE_DOWN_DEPTH`.

The crash-recovery timing is the one thing tuned for the accelerated clock: `LOCK_DURATION_MS` + `STALLED_INTERVAL_MS` bound how fast an orphaned frame comes back (BullMQ's defaults of 30s are far too slow to watch). The integration test `server/src/__tests__/integration/crashRecovery.test.ts` validates that a `SIGKILL`ed worker's frame is recovered and completed by another worker.

## Testing

```bash
npm test                 # all workspaces
npm run test -w server   # director + world-state unit tests, plus integration tests (need Redis)
npm run test -w web      # component tests (jsdom)
npm run lint -w web      # eslint (flat config)
```

Stop `npm run dev` before running the server integration tests: the demo and the tests share the same Redis queue, so a running demo steals test jobs (and the tests flush Redis).

- **Unit:** the Director cycle-engine state machine (including pause-gated crash selection and exact autoscale boundaries) and the world-state merge reducers are pure functions; the worker's stage pipeline (`RENDERING` before `COMPOSITING`, full progress ramp) and the WebSocket command router are covered without Redis; the broadcaster's snapshot-on-connect runs against a real `ws` socket.
- **Integration (needs Redis, run sequentially since files share the queue):** SIGKILL crash recovery asserts the frame stalls, re-queues, and is completed by the *surviving* worker; plain lifecycle (`added -> active -> completed`); priority overtaking (a late high-priority frame completes first); load balancing across two workers; idle heartbeat; graceful `SIGTERM` shutdown.
- **Web (jsdom):** column-stage mapping, priority ordering and badge, node tags, node-strip fields, event-log severity, and control-bar commands.

## Project layout

```
shared/   @demo/shared - types + constants (the contract)
server/   orchestrator: queue, director, node pool, telemetry, world-state, websocket
worker/   forked worker process: staged frame processing + telemetry
web/       Vite + React SPA: KanbanBoard, NodeStrip, EventLog, ControlBar
```

## Notes

- Workers are genuinely separate processes; `Kill a node` sends a real `SIGKILL`, and recovery is real BullMQ stalled-job detection, not a simulation.
- `docker-compose.yml` is provided for portability, but the native `redis:start` script is the path used here.
- The web client's single `state/useOrchestrator` hook merges the spec's `useWorldState` + `useCommands` (both concerns share one socket); `VITE_WS_URL` overrides the WebSocket endpoint.
- The transport sends full `WorldState` snapshots at ~5 Hz rather than diffs; at demo scale (≤20 frames, ≤6 nodes) a snapshot is already small, and every message doubles as a late-join state.
- A frame that somehow exhausts all 20 attempts lands in `DONE` as a red-bordered `FAILED` card (so a cycle can never deadlock; the event log says `failed permanently`); with `MAX_STALLED_COUNT` 10 this is effectively unreachable in practice. To see it, run with `MAX_STALLED_COUNT=0 JOB_ATTEMPTS=1` and kill a node.
- Operator `Kill a node` works even while paused (deliberate: pause freezes the Director's own drama, not the operator).
