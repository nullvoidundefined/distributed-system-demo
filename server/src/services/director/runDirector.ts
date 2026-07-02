/** Drives the Director: randomized ticks, applies effects to the queue and node pool, logs events. */

import type { Queue } from 'bullmq';
import { TUNABLES } from '../../config/tunables.js';
import type { NodePool } from '../nodePool/createNodePool.js';
import type { WorldStore } from '../worldState/createWorldStore.js';
import { appendEvent } from '../worldState/reduceWorldState.js';
import { reduceDirector } from './reduceDirector.js';
import type { DirectorAction, DirectorEffect, DirectorState } from './types.js';

const CRASH_PROB_PER_TICK = 0.25;

export interface DirectorRuntime {
    dispatch: (action: DirectorAction) => Promise<void>;
    killNodeNow: () => void;
    priorityOf: (frameId: string) => boolean;
    seed: (count: number) => Promise<void>;
    stop: () => void;
}

function idleCtx(): ReturnType<typeof buildCtx> {
    return buildCtx(0, 0, 1);
}

function buildCtx(queueDepth: number, activeCount: number, remaining: number) {
    return {
        activeCount,
        batchSize: TUNABLES.batchSize,
        maxNodes: TUNABLES.maxNodes,
        minNodes: TUNABLES.minNodes,
        queueDepth,
        remaining,
        scaleDownDepth: TUNABLES.scaleDownDepth,
        scaleUpDepth: TUNABLES.scaleUpDepth,
    };
}

export function runDirector(queue: Queue, pool: NodePool, store: WorldStore): DirectorRuntime {
    let state: DirectorState = { cycle: 1, nodeCount: pool.size(), phase: 'seeding' };
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
                { attempts: TUNABLES.jobAttempts, jobId: frameId, priority: priority ? 1 : 5 },
            );
        }
        store.update((s) =>
            appendEvent(s, 'info', `seeded ${count} frames for cycle ${state.cycle}`),
        );
    }

    function spawnNode(): void {
        const id = pool.spawn();
        state = { ...state, nodeCount: pool.size() };
        store.update((s) => appendEvent(s, 'success', `autoscaling up: ${id} spawned`));
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
            phase: 'seeding',
            totals: { done: 0, total: 0 },
        }));
        store.update((s) => appendEvent(s, 'info', `cycle ${state.cycle} starting`));
    }

    async function applyEffect(effect: DirectorEffect): Promise<void> {
        if (effect.type === 'seed') await seed(effect.count);
        if (effect.type === 'spawn') spawnNode();
        if (effect.type === 'kill') retireIdleNode();
        if (effect.type === 'resetQueue') await resetCycle();
    }

    async function applyEffects(effects: DirectorEffect[]): Promise<void> {
        for (const effect of effects) await applyEffect(effect);
    }

    function maybeCrash(): void {
        if (state.phase !== 'running' || Math.random() > CRASH_PROB_PER_TICK) return;
        const busy = store
            .get()
            .nodes.filter((node) => node.state !== 'idle')
            .map((node) => node.id);
        if (busy.length <= 1) return;
        const crashed = pool.crashRandom(busy);
        if (crashed) {
            store.update((s) =>
                appendEvent(s, 'danger', `${crashed} crashed (SIGKILL); frame orphaned`),
            );
        }
    }

    async function tick(): Promise<void> {
        const counts = await queue.getJobCounts('waiting', 'active', 'prioritized');
        const world = store.get();
        const remaining = world.totals.total - world.totals.done;
        const ctx = buildCtx(
            (counts.waiting ?? 0) + (counts.prioritized ?? 0),
            counts.active ?? 0,
            state.phase === 'seeding' ? 1 : remaining,
        );
        const result = reduceDirector(state, { type: 'tick' }, ctx);
        state = result.state;
        store.update((s) => ({ ...s, cycle: state.cycle, phase: state.phase }));
        await applyEffects(result.effects);
        maybeCrash();
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
            const result = reduceDirector(state, action, idleCtx());
            state = result.state;
            store.update((s) => ({ ...s, phase: state.phase }));
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
