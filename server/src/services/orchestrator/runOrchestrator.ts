/** Drives the Orchestrator: randomized ticks, applies effects to the queue and node pool, logs events. */

import type { RenderState } from '@demo/shared';
import type { Queue } from 'bullmq';

import { TUNABLES } from '../../config/tunables.js';
import type { NodePool } from '../nodePool/types.js';
import { appendEvent } from '../renderState/appendEvent.js';
import { applyNodeSpawning } from '../renderState/applyNodeSpawning.js';
import type { RenderStore } from '../renderState/types.js';

import { reduceOrchestrator } from './reduceOrchestrator.js';
import type {
    OrchestratorCtx,
    OrchestratorEffect,
    OrchestratorRuntime,
    OrchestratorState,
} from './types.js';

interface ObservedCounts {
    activeCount: number;
    busyNodeIds: string[];
    nodeCount: number;
    queueDepth: number;
    remaining: number;
}

const HIGH_QUEUE_PRIORITY = 1;
const NORMAL_QUEUE_PRIORITY = 5;

function idleCtx(): OrchestratorCtx {
    return buildCtx({ activeCount: 0, busyNodeIds: [], nodeCount: 0, queueDepth: 0, remaining: 1 });
}

function buildCtx(observed: ObservedCounts): OrchestratorCtx {
    return {
        activeCount: observed.activeCount,
        batchSize: TUNABLES.batchSize,
        busyNodeIds: observed.busyNodeIds,
        crashRoll: Math.random(),
        maxNodes: TUNABLES.maxNodes,
        minNodes: TUNABLES.minNodes,
        nodeCount: observed.nodeCount,
        queueDepth: observed.queueDepth,
        remaining: observed.remaining,
        scaleDownDepth: TUNABLES.scaleDownDepth,
        scaleUpDepth: TUNABLES.scaleUpDepth,
        targetRoll: Math.random(),
    };
}

function displayStatus(state: OrchestratorState): RenderState['status'] {
    return state.paused ? 'paused' : state.status;
}

export function runOrchestrator(
    queue: Queue,
    pool: NodePool,
    store: RenderStore,
): OrchestratorRuntime {
    let state: OrchestratorState = { cycle: 1, paused: false, status: 'seeding' };
    let timer: ReturnType<typeof setTimeout>;
    let frameSeq = 0;
    const priorityById = new Map<string, boolean>();

    async function seed(count: number): Promise<void> {
        for (let i = 0; i < count; i += 1) {
            frameSeq += 1;
            const frameId = `f${state.cycle}-${frameSeq}`;
            const priority = Math.random() < TUNABLES.highPriorityRatio;
            priorityById.set(frameId, priority);
            await queue.add(
                'frame',
                { cycle: state.cycle, frameId, priority },
                {
                    attempts: TUNABLES.jobAttempts,
                    jobId: frameId,
                    priority: priority ? HIGH_QUEUE_PRIORITY : NORMAL_QUEUE_PRIORITY,
                },
            );
        }
        store.update((s) =>
            appendEvent(s, 'info', `seeded ${count} frames for cycle ${state.cycle}`),
        );
    }

    function spawnNode(): void {
        const { id, pid } = pool.spawn();
        store.update((s) =>
            appendEvent(applyNodeSpawning(s, id, pid), 'success', `autoscaling up: ${id} spawned`),
        );
    }

    function retireIdleNode(): void {
        const idle = store
            .get()
            .nodes.filter((node) => node.state === 'idle')
            .map((node) => node.id);
        const killed = pool.killIdle(idle);
        if (killed) {
            store.update((s) => appendEvent(s, 'warn', `autoscaling down: ${killed} retired`));
        }
    }

    async function resetCycle(): Promise<void> {
        await queue.obliterate({ force: true }).catch(() => undefined);
        priorityById.clear();
        store.update((s) => ({
            ...s,
            cycle: state.cycle,
            frames: [],
            status: 'seeding',
            totals: { done: 0, total: 0 },
        }));
        store.update((s) => appendEvent(s, 'info', `cycle ${state.cycle} starting`));
    }

    async function applyEffect(effect: OrchestratorEffect): Promise<void> {
        if (effect.type === 'seed') await seed(effect.count);
        if (effect.type === 'spawn') spawnNode();
        if (effect.type === 'kill') retireIdleNode();
        if (effect.type === 'crash') crashNode(effect.nodeId);
        if (effect.type === 'resetQueue') await resetCycle();
    }

    async function applyEffects(effects: OrchestratorEffect[]): Promise<void> {
        for (const effect of effects) await applyEffect(effect);
    }

    function crashNode(nodeId: string): void {
        const crashed = pool.crashRandom([nodeId]);
        if (crashed) {
            store.update((s) =>
                appendEvent(s, 'danger', `${crashed} crashed (SIGKILL); frame orphaned`),
            );
        }
    }

    function listBusyNodeIds(): string[] {
        return store
            .get()
            .nodes.filter((node) => node.state !== 'idle')
            .map((node) => node.id);
    }

    async function tick(): Promise<void> {
        const counts = await queue.getJobCounts('waiting', 'active', 'prioritized');
        const renderState = store.get();
        const remaining = renderState.totals.total - renderState.totals.done;
        const ctx = buildCtx({
            activeCount: counts.active ?? 0,
            busyNodeIds: listBusyNodeIds(),
            nodeCount: pool.size(),
            queueDepth: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
            remaining: state.status === 'seeding' ? 1 : remaining,
        });
        const result = reduceOrchestrator(state, { type: 'tick' }, ctx);
        state = result.state;
        store.update((s) => ({ ...s, cycle: state.cycle, status: displayStatus(state) }));
        await applyEffects(result.effects);
        schedule();
    }

    function schedule(): void {
        const span = TUNABLES.tickMaxMs - TUNABLES.tickMinMs;
        const delay = TUNABLES.tickMinMs + Math.random() * span;
        timer = setTimeout(() => void tick(), delay);
    }

    schedule();

    return {
        dispatch: async (action) => {
            const result = reduceOrchestrator(state, action, idleCtx());
            state = result.state;
            store.update((s) => ({ ...s, status: displayStatus(state) }));
            await applyEffects(result.effects);
        },
        killNodeNow: () => {
            const busy = store
                .get()
                .nodes.filter((node) => node.state !== 'idle')
                .map((node) => node.id);
            const crashed = pool.crashRandom(busy.length ? busy : pool.ids());
            if (crashed) {
                store.update((s) => appendEvent(s, 'danger', `${crashed} killed by operator`));
            }
        },
        priorityOf: (frameId) => priorityById.get(frameId) ?? false,
        seed,
        stop: () => clearTimeout(timer),
    };
}
