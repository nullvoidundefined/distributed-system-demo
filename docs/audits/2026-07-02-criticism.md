# Criticism Audit - Render Farm Distributed System Demo

**Date:** 2026-07-02
**Scope:** Full application - `shared/`, `server/`, `worker/`, `web/`, README, spec, plan, sibling engineering audit
**Goal as stated:** A self-running, cyclical, visual demo of a distributed system on real Redis + BullMQ, worker nodes as separate OS processes, showcasing load balancing, fault tolerance/retries, autoscaling, and job priorities, on an accelerated clock.

---

## The Brutal Truth

The core distributed mechanics are genuine: separate OS processes, real Redis, real BullMQ, real SIGKILL from the parent orchestrator. That part is not theater. But the two most visually dramatic moments the README promises - "a node card goes red" on crash, and "priority cards jump toward the front of QUEUED" - never happen in the running code. The crashed node card vanishes instead of flashing red (the `crashed` CSS class exists and is styled but nothing ever sets a node's state to `'crashed'` before removal). Priority frames have a purple badge but the QUEUED column renders in insertion order with no sort. The `'spawning'` node state is similarly defined, styled, and dead. The demo is 70% of what it claims to be. The foundation is solid enough that these are fixable gaps, not fundamental dishonesty - but they are gaps between the stated goal and the delivered artifact.

---

## What's Actually Good

- **The real crash/recovery path is genuine.** `pool.crashRandom()` in `createNodePool.ts:70` calls `child.kill('SIGKILL')`. The Director's `maybeCrash()` in `runDirector.ts:102-115` invokes this. BullMQ's stalled-job detection requeues the orphaned frame. This is the hard part, and it works.
- **Pure reducer + runtime split is well-executed.** `reduceDirector.ts` and `reduceWorldState.ts` as pure functions, with the I/O and async side effects in `runDirector.ts`, is the right design for a system you want to demonstrate and test. It made the unit tests meaningful rather than theatrical.
- **The two-channel truth model is correctly architected.** QueueEvents for job lifecycle (`added`/`completed`/`stalled`), Redis pub/sub for intra-job progress. The concern division is real and the implementation is clean.
- **Risk was front-loaded.** Task 4 (crash recovery integration test) was written before UI polish, exactly as the spec required.
- **BullMQ connection hygiene is correct.** Separate ioredis instances for queue, queueEvents, and telemetry subscriber - a BullMQ blocking-consumer footgun that was explicitly avoided.
- **The engineering audit (sibling) is high-quality.** Its P1 findings are real bugs, correctly cited.

---

## What's Broken

### Significant - S1: The 'crashed' and 'spawning' node states are dead code

The spec's most memorable visual moment - "A node card goes red, its frame slides back to QUEUED" - does not happen.

**File:** `server/src/index.ts:24-29`
```typescript
const pool = createNodePool({
    onExit: (nodeId, crashed) => {
        store.update((s) => ({ ...s, nodes: s.nodes.filter((node) => node.id !== nodeId) }));
        if (crashed) store.update((s) => appendEvent(s, 'warn', `${nodeId} process exited`));
    },
});
```

When a worker dies, the `onExit` callback immediately removes it from `worldState.nodes`. There is no intermediate update setting `node.state = 'crashed'`. The node card vanishes. The CSS class `.crashed` in `web/src/components/NodeStrip/NodeStrip.module.scss:10` is defined and styled (`border-color: var(--danger)`) but is never applied because no node ever carries `state: 'crashed'` in the broadcast.

Same for `'spawning'`: after `pool.spawn()` returns, the node only appears in the world state when the worker sends its first telemetry message - at `state: 'idle'`. The dashed-border spawning card in the spec diagram never renders. `NodeStrip.module.scss:12` (`.spawning { border-style: dashed; }`) is dead CSS.

To confirm: search for any `state: 'crashed'` or `state: 'spawning'` assignment in the server or worker source trees. None exist.

### Significant - S2: Priority cards do not visually reorder in the QUEUED column

**README, line 12:** "Purple-bordered `PRIORITY` cards jump toward the front of `QUEUED`."

**File:** `web/src/components/KanbanBoard/KanbanBoard.tsx:15-16`
```typescript
const columnFrames = frames.filter((frame) => frame.stage === stage);
// (no .sort() follows)
```

Frames are filtered into columns and rendered in their array order (insertion order from the queue's `added` events). High-priority frames get a purple border and a "priority" badge (`KanbanBoard.tsx:28-31`), but they do not move to the top of the QUEUED column. The visual ordering effect claimed in the README does not exist. BullMQ does dequeue them first, which is the real mechanism, but the board does not reflect this.

To confirm: add `.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0))` before the `.map()` call and verify priority frames appear above normal frames in the QUEUED column.

### Significant - S3: Cycle can stall permanently when jobs exhaust all retry attempts

**File:** `server/src/index.ts:34-56`
```typescript
queueEvents.on('added', ...);
queueEvents.on('completed', ...);
queueEvents.on('stalled', ...);
// no 'failed' handler
```

BullMQ fires a `failed` event when a job exhausts all retry attempts. With `maxStalledCount=10` (`tunables.ts:12`) and `jobAttempts=20` (`tunables.ts:13`), a job that stalls repeatedly without recovery will eventually fail permanently. When it does, `totals.done` is never incremented (`applyQueueEvent` in `reduceWorldState.ts:76-81` only handles `completed`). `remaining = totals.total - totals.done` never reaches zero. The Director stays in `running` phase indefinitely. The cycle never transitions to `complete` and never resets.

The adversarial sequence: the user presses "Kill a node" repeatedly. `killNodeNow()` in `runDirector.ts:149-157` kills any node (including below `minNodes`), bypassing autoscale bounds. If the user kills all active workers, in-flight jobs lose their lock holders. Each stalledInterval check requeues them. If no healthy workers exist, the jobs stall again. After `maxStalledCount` stalls, BullMQ fires `failed`. Cycle stalls.

To confirm: add a `queueEvents.on('failed', ...)` handler that logs the event, then manually trigger the failure path by killing all workers and waiting.

### Worth Addressing - W1: The integration test validates process.exit, not SIGKILL, but the README claims the opposite

**README, lines 90-91:**
> "The integration test `crashRecovery.test.ts` validates that a `SIGKILL`ed worker's frame is recovered and completed by another worker."

**File:** `server/src/__tests__/integration/crashRecovery.test.ts:53`
```typescript
const doomed = spawnWorker('node-doomed', 1); // crashes on first tick
```

**File:** `worker/src/stages/processFrame.ts:32-33`
```typescript
if (deps.crashRoll()) {
    process.exit(137); // simulate a hard crash mid-stage (real SIGKILL-like death)
}
```

`CRASH_PROB=1` in the test causes the worker to call `process.exit(137)`, not receive SIGKILL. This is the "soft crash fallback" documented in the spec. For BullMQ stalled-detection purposes, both exit paths are functionally equivalent (lock expires, stall is detected, job is requeued). The recovery test IS valid. But the README's statement that it validates "a SIGKILLed worker's frame" is false. The actual SIGKILL path (orchestrator sends `child.kill('SIGKILL')` via `crashRandom`) is never covered by an automated test. The comment `// real SIGKILL-like death` is aspirational, not accurate.

To confirm: the test uses `CRASH_PROB` not a real signal; the production kill path goes through `createNodePool.ts:70` (`child.kill('SIGKILL')`), which no test exercises.

### Worth Addressing - W2: Async dispatch and timer tick can race at await boundaries

**File:** `server/src/services/director/runDirector.ts:117-132` (tick function) and `runDirector.ts:143-147` (dispatch)

Both `tick()` and `dispatch()` are async and mutate the shared `state` variable. In JavaScript's cooperative concurrency model, they interleave at `await` points.

Critical scenario: the user presses Reset while `tick()` is in the middle of `await seed(count)` (adding frames one-by-one to the queue). `dispatch({ type: 'reset' })` fires concurrently, sets `state.phase = 'seeding'` and calls `resetCycle()`, which obliterates the queue via `await queue.obliterate()`. The partially-added frames from `seed()` are wiped. But `seed()` continues and adds more frames after the obliterate. Those frames trigger `added` QueueEvents in a world whose `frames: []` was just reset. They appear as orphaned frames in the new cycle.

No lock or mutual-exclusion mechanism exists around the `state` variable. The `tick()` function reschedules itself at the END (not the beginning), so tick-over-tick races are prevented, but timer-vs-operator races are not.

To confirm: test by starting the demo and pressing Reset rapidly during the seeding phase to observe phantom frames in the next cycle.

---

## What's Weak

**The `'spawning'` visual feedback gap.** Between `pool.spawn()` being called (an event the orchestrator knows about immediately and logs) and the first idle telemetry message arriving from the new worker, there is a period where the node card is absent but a spawn was announced in the event log. On a fast machine this is imperceptible, but on a slow Redis connection or under load this creates a noticeable inconsistency between the event log ("autoscaling up: node-3 spawned") and the node strip (no node-3 card yet).

Direction: After `pool.spawn()` returns, insert the new node into `worldState.nodes` with `state: 'spawning'` immediately. The telemetry's first `idle` message then upserts it to the real state. The `.spawning` CSS class finally earns its existence.

**The two-WebSocket-connection design in the SPA.** `useWorldState.ts` opens one connection, `useCommands.ts` opens a second. Both receive all broadcast snapshots (200ms interval). The second connection's incoming messages are silently discarded. For a local demo this is harmless, but it doubles connection count and doubles server-side broadcast work. One bidirectional socket with a message-type discriminator would serve both purposes.

**Reset while workers are mid-frame causes visual incoherence.** `resetCycle()` in `runDirector.ts:78-89` obliterates the queue and zeroes `frames: []`. Workers in mid-frame continue sending telemetry for frame IDs that no longer exist in the world state. `applyTelemetry` in `reduceWorldState.ts:39-50` matches on `frame.id === msg.frameId` - with no matching frame, the node upsert still fires, so the node strip shows nodes processing orphaned frame IDs (e.g., `f1-5`) while the board shows cycle-2 frames.

**`killNodeNow` ignores `minNodes`.**

**File:** `server/src/services/director/runDirector.ts:149-157`
```typescript
killNodeNow: () => {
    const busy = store.get().nodes.filter((node) => node.state !== 'idle').map((node) => node.id);
    const crashed = pool.crashRandom(busy.length ? busy : pool.ids());
```

The autoscaler respects `minNodes`. `killNodeNow` does not. The user can press "Kill a node" until zero workers remain, which is the trigger for the cycle-stall path described in S3. This is either a feature (operators take responsibility) or a bug (demo breaks). The README implies it is intentional but doesn't mention the stall risk.

---

## What's Missing

**No `failed` event handler** (see S3). A minimal handler that moves the frame to `DONE` and logs a `danger` event would prevent cycle stall. Whether the frame is actually "done" is arguable, but cycling is more important for a demo than perfect semantics.

**No sort in the QUEUED Kanban column** (see S2). One line of JavaScript.

**No `crashed` state transition before node removal** (see S1). A two-step update with a brief delay before removal would make the crash moment visible.

**No `spawning` state before first telemetry** (see W1 in What's Weak).

**No guard on the number of "Kill a node" presses.** The ControlBar offers no feedback about current node count and no disable state when only `minNodes` workers are alive.

---

## Lies the Team Tells Itself

**"A node card goes red."** (`README.md:10` and `docs/superpowers/specs/2026-07-02-render-farm-distributed-demo-design.md:126`) The card disappears. The red state is defined and styled but never reached.

**"The integration test validates that a SIGKILLed worker's frame is recovered."** (`README.md:90`) It validates a `process.exit(137)` recovery. The SIGKILL production path is untested by any automated test.

**"Priority cards jump toward the front of QUEUED."** (`README.md:12`) They have a purple border and badge. The column is unsorted.

**"Slides become instant state changes"** for reduced-motion. (`spec:131`) There are no slide animations to become instant. `global.scss:17-19` fires `animation: none !important; transition: none !important` which correctly disables the progress-bar width transition, but there is no frame-movement animation to suppress in the first place. The `prefers-reduced-motion` handling is correct but reduces what was never there.

**"`state.nodeCount` in `DirectorState` tracks the node pool."** (implicit in the design) As the engineering audit's F3 found, `state.nodeCount` is only updated on spawn - it is stale after crashes and graceful retirements. The autoscale checks in `reduceDirector.ts:29-32` are operating on incorrect input after the first crash or scale-down.

---

## The User's Experience, Honestly

On first open, the board shows nothing (cycle in seeding phase). Within 5-10 seconds, 16 frames appear in QUEUED and workers start pulling them. The progress bars animate. This is genuinely compelling for the first 30 seconds.

The crash event: the event log says `node-2 crashed (SIGKILL); frame orphaned`. The user looks at the node strip and... node-2 is already gone. No red flash, no dramatic moment. Then 4-6 seconds later, the orphaned frame appears as a stall event and another worker picks it up. The recovery IS visible but the crash is anticlimactic. This is the biggest gap between the spec's promise and the runtime experience.

Priority frames: if you're watching carefully and know to look, the purple-bordered cards appear first in QUEUED because BullMQ dequeues them before normal frames - so workers claim them quickly. But they don't visually move to the top of the column. A viewer expecting "jump toward the front" will not see it.

Autoscaling: genuinely visible. When the queue depth rises (early in a cycle), a new node appears in the strip. When draining, a node card disappears with "autoscaling down" in the log. This works and is visible.

Cycle reset: the board clears and new frames appear. Clean.

Controls work. Pause/Resume, Inject 5, Reset are all functional. "Kill a node" works but is anticlimactic for the reasons above.

---

## Theater Check

**Confidence theater (S-tier concern):** `server/src/__tests__/integration/crashRecovery.test.ts` is presented (README, line 90) as a test of SIGKILL recovery. It is a test of `process.exit(137)` recovery. The distinction matters because: (a) the production crash path (`pool.crashRandom` -> `child.kill('SIGKILL')`) is different code from the worker's `crashRoll` path; (b) any bug in the orchestrator's SIGKILL handling would not be caught by this test. The test IS valid and does test the stalled-recovery timing, but it does not test the production kill path.

**Dead-state theater:** `NodeState` includes `'crashed'` and `'spawning'`. `NodeStrip.module.scss` styles both. Neither is ever set in any running code path. The type system and CSS both describe a system that doesn't exist.

**Process theater:** None found. The plan/spec/test structure is proportionate to the project size. There is no excessive meta-work.

**Metrics theater:** Not applicable to a local demo project.

---

## Is It Actually Running?

This is a local-only development demo. No CI, no production deployment. Evaluation is limited to static analysis of the committed code.

| Component | Claim | Status |
|---|---|---|
| Redis server | README: `npm run redis:start` or `docker compose up -d` | **UNVERIFIED** - not observable during this audit |
| Worker processes | README: "Workers are genuinely separate processes" | **VERIFIED IN CODE** - `createNodePool.ts:39-57` uses `fork()` with real env vars; confirmed real OS processes |
| BullMQ stalled recovery | README: "real BullMQ stalled-job detection re-queues the orphaned frame" | **VERIFIED IN CODE** - `createQueueEvents.ts` + `index.ts:48-56` subscribe to `stalled` and re-render; timing validated by integration test (with caveat in W1) |
| Autoscaling | README: "Director watches queue depth" | **VERIFIED IN CODE** - `runDirector.ts:117-132` queries `getJobCounts` each tick and applies spawn/kill effects |
| WebSocket broadcasts | README: "broadcasts WorldState over WebSocket" | **VERIFIED IN CODE** - `createBroadcaster.ts` sends on connect + interval |
| `crashed` node visual | README: "A node card goes red" | **DOES NOT EXIST** in current code - see S1 |
| Priority reordering visual | README: "jump toward the front of QUEUED" | **DOES NOT EXIST** in current code - see S2 |

---

## Process-vs-Outcome Balance

14 commits. Zero are process/meta commits. The sequence is: scaffold, implement slice by slice, test, readme, audit. The engineering audit (sibling) is a process artifact but it was explicitly requested and found real bugs. No moratorium warranted. This is a healthy ratio for a focused demo project.

---

## Where the Sibling Audit Is Wrong

The engineering audit (`2026-07-02-engineering-server.md`) is technically sound and its 16 findings are all legitimate. It deserves credit. But it has four blind spots:

**1. It missed the 'crashed' and 'spawning' state gap (S1 above).** The engineering audit reviewed the server surface but didn't cross-check the defined `NodeState` type against whether any code path actually emits those states. This is a cross-layer failure: the server removes nodes immediately on exit; the web client styles states that never appear. The engineering audit stayed inside its lane.

**2. It missed the cycle-stall risk (S3 above).** The `failed` event handler gap is visible in `index.ts`, which the engineering audit read in full. The audit noted the missing `'active'` QueueEvent handler (in a note, not a finding) but missed `'failed'`. A failed job permanently breaks the cycle. This is higher severity than several of the P2 findings the audit did report.

**3. It missed the README false claim about the integration test.** The audit's "Operational Basics" section notes the integration test runs but doesn't verify what the test actually exercises vs. what the README claims it exercises.

**4. It missed the priority card visual gap (S2 above).** The audit scoped itself to `server/src/**`. The Kanban column sort is a `web/` concern. Fair from a scope perspective, but the stated goal says visual demo - someone should own that claim end-to-end.

The engineering audit correctly noted (as a minor item) that the worker's standalone defaults differ from the server's TUNABLES. I agree with all 16 of its findings. I disagree with their relative ordering: F4 (pause-during-seeding skips a cycle) is genuinely a P1 user-visible bug and was correctly rated P1. F3 (stale nodeCount) is correctly P1. But the missing `failed` handler (not listed at all) is arguably the same severity as F4 - it breaks the cycle permanently under adversarial use, not just edge timing.

---

## The Rules That Run Claude

This project does not carry a project-level `CLAUDE.md` (inherits the parent personal directory's conventions at `/Users/iangreenough/Desktop/code/personal/.claude/CLAUDE.md`). The only project-level config is `.claude/settings.local.json` (allows MCP doc query tool, nothing else). The meta-rule layer for this project is minimal and appropriate.

No gaps, conflicts, waste, redundancy, or dead rules are present specific to this project's configuration. The global rules apply and were evidently followed (file-level header comments, descriptive names, pure reducer separation, R-219 magic literals flagged in engineering audit F9). No rule-layer findings.

**Rule layer health: Minor** (nothing wrong, nothing to add for a dev demo project).

---

## The Hard Prioritization

If the demo is going to be shown to anyone, fix these five things first:

**1. Add the 'crashed' node state transition before removal.** The crash moment is the most impactful visual in the demo. In `index.ts:25-27`, before filtering the node out, first update its state to `'crashed'`, broadcast it, then remove it after ~1500ms. The CSS is already written. This is a ~10-line change that delivers the demo's headline promise.

**2. Handle the `failed` QueueEvent in `server/src/index.ts`.** One `queueEvents.on('failed', ...)` call. Without it, the demo can stall permanently in adversarial use (repeated "Kill a node" presses). For a demo being observed by people pressing all the buttons, this WILL happen.

**3. Sort the QUEUED column by priority in `KanbanBoard.tsx`.** One `.sort()` call before `.map()`. The README claims this behavior explicitly.

**4. Fix the pause-during-seeding bug (engineering audit F4).** The engineering audit rated this P1. Pressing Pause within the first tick of a new cycle causes the cycle to immediately complete and reset, producing a confusing "why is it resetting?" experience.

**5. Add a `SIGTERM`/`SIGINT` shutdown handler in `server/src/index.ts` (engineering audit F1).** Without it, every `Ctrl-C` orphans worker child processes. On the next `npm run dev`, orphan workers compete with the new workers on the same Redis queue. The demo degrades in ways that look like bugs but are just accumulation of zombie processes. This is the kind of silent corruption that makes a demo look unreliable to an observer.

---

## What Would Make Me Wrong

**For S1 (crashed/spawning state never set):** Find a code path in `server/src/` or `worker/src/` that sets `node.state = 'crashed'` or `'spawning'` on a WorldNode that is then broadcast. I found none. Grep `server/src worker/src -r "state: 'crashed'"` returns zero matches (excluding CSS and type definitions).

**For S2 (priority cards don't reorder):** Find a `.sort()` or equivalent in `KanbanBoard.tsx` applied to `columnFrames` before rendering. The relevant code is at `KanbanBoard.tsx:15`. No sort exists.

**For S3 (cycle stalls on failed jobs):** Find a `queueEvents.on('failed', ...)` handler in `server/src/index.ts`. The file has three QueueEvents listeners (`added`, `completed`, `stalled`) and no `failed` listener.

**For W1 (integration test tests process.exit not SIGKILL):** Find a use of `child.kill('SIGKILL')` or `process.kill(pid, 'SIGKILL')` inside `crashRecovery.test.ts`. The test uses `CRASH_PROB=1` which triggers `process.exit(137)` inside the worker.

**For the concurrency race (W2):** Show that `tick()` and `dispatch()` cannot interleave at `await` points, or that state mutations are serialized by some locking mechanism. The current code has no such mechanism. The race is real under adversarial button-mashing.
