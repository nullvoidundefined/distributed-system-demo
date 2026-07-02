/** Central timing and threshold knobs for the demo. Values chosen for an accelerated clock. */

function num(name: string, fallback: number): number {
    const raw = process.env[name];
    return raw === undefined ? fallback : Number(raw);
}

export const TUNABLES = {
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    httpPort: num('PORT', 3001),
    batchSize: num('BATCH_SIZE', 16),
    highPriorityRatio: 0.15,
    tickMinMs: num('TICK_MIN_MS', 5000),
    tickMaxMs: num('TICK_MAX_MS', 10000),
    stageMs: num('STAGE_MS', 2500),
    minNodes: num('MIN_NODES', 2),
    maxNodes: num('MAX_NODES', 6),
    scaleUpDepth: num('SCALE_UP_DEPTH', 6),
    scaleDownDepth: num('SCALE_DOWN_DEPTH', 2),
    stalledIntervalMs: num('STALLED_INTERVAL_MS', 3000),
    lockDurationMs: num('LOCK_DURATION_MS', 5000),
    maxStalledCount: num('MAX_STALLED_COUNT', 10),
    jobAttempts: num('JOB_ATTEMPTS', 20),
    broadcastHz: num('BROADCAST_HZ', 5),
} as const;
