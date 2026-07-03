/** Central timing and threshold knobs for the demo. Values chosen for an accelerated clock. */

const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_BROADCAST_HZ = 5;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2000;
const DEFAULT_HIGH_PRIORITY_RATIO = 0.15;
const DEFAULT_HTTP_PORT = 3001;
const DEFAULT_JOB_ATTEMPTS = 20;
const DEFAULT_LOCK_DURATION_MS = 6000;
const DEFAULT_MAX_NODES = 6;
const DEFAULT_MAX_STALLED_COUNT = 10;
const DEFAULT_MIN_NODES = 2;
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';
const DEFAULT_SCALE_DOWN_DEPTH = 2;
const DEFAULT_SCALE_UP_DEPTH = 6;
const DEFAULT_STAGE_MS = 2500;
const DEFAULT_STALLED_INTERVAL_MS = 2000;
const DEFAULT_TICK_MAX_MS = 10000;
const DEFAULT_TICK_MIN_MS = 5000;

function num(name: string, fallback: number): number {
    const raw = process.env[name];
    return raw === undefined ? fallback : Number(raw);
}

export const TUNABLES = {
    batchSize: num('BATCH_SIZE', DEFAULT_BATCH_SIZE),
    broadcastHz: num('BROADCAST_HZ', DEFAULT_BROADCAST_HZ),
    heartbeatIntervalMs: num('HEARTBEAT_INTERVAL_MS', DEFAULT_HEARTBEAT_INTERVAL_MS),
    highPriorityRatio: num('HIGH_PRIORITY_RATIO', DEFAULT_HIGH_PRIORITY_RATIO),
    httpPort: num('PORT', DEFAULT_HTTP_PORT),
    jobAttempts: num('JOB_ATTEMPTS', DEFAULT_JOB_ATTEMPTS),
    lockDurationMs: num('LOCK_DURATION_MS', DEFAULT_LOCK_DURATION_MS),
    maxNodes: num('MAX_NODES', DEFAULT_MAX_NODES),
    maxStalledCount: num('MAX_STALLED_COUNT', DEFAULT_MAX_STALLED_COUNT),
    minNodes: num('MIN_NODES', DEFAULT_MIN_NODES),
    redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
    scaleDownDepth: num('SCALE_DOWN_DEPTH', DEFAULT_SCALE_DOWN_DEPTH),
    scaleUpDepth: num('SCALE_UP_DEPTH', DEFAULT_SCALE_UP_DEPTH),
    stageMs: num('STAGE_MS', DEFAULT_STAGE_MS),
    stalledIntervalMs: num('STALLED_INTERVAL_MS', DEFAULT_STALLED_INTERVAL_MS),
    tickMaxMs: num('TICK_MAX_MS', DEFAULT_TICK_MAX_MS),
    tickMinMs: num('TICK_MIN_MS', DEFAULT_TICK_MIN_MS),
} as const;
