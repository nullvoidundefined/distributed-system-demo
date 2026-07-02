/** Central timing and threshold knobs for the demo. Values chosen for an accelerated clock. */

function num(name: string, fallback: number): number {
    const raw = process.env[name];
    return raw === undefined ? fallback : Number(raw);
}

export const TUNABLES = {
    batchSize: num('BATCH_SIZE', 16),
    broadcastHz: num('BROADCAST_HZ', 5),
    heartbeatIntervalMs: num('HEARTBEAT_INTERVAL_MS', 2000),
    highPriorityRatio: 0.15,
    httpPort: num('PORT', 3001),
    jobAttempts: num('JOB_ATTEMPTS', 20),
    lockDurationMs: num('LOCK_DURATION_MS', 4000),
    maxNodes: num('MAX_NODES', 6),
    maxStalledCount: num('MAX_STALLED_COUNT', 10),
    minNodes: num('MIN_NODES', 2),
    redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    scaleDownDepth: num('SCALE_DOWN_DEPTH', 2),
    scaleUpDepth: num('SCALE_UP_DEPTH', 6),
    stageMs: num('STAGE_MS', 2500),
    stalledIntervalMs: num('STALLED_INTERVAL_MS', 2000),
    tickMaxMs: num('TICK_MAX_MS', 10000),
    tickMinMs: num('TICK_MIN_MS', 5000),
} as const;
