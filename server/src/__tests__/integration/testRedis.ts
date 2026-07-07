/**
 * Isolated Redis config for integration tests. A dedicated DB keeps the BullMQ queue
 * off db 0, and a dedicated pub/sub channel keeps telemetry off the default channel, so
 * a local dev server running on the same Redis instance cannot steal jobs or pollute
 * telemetry. Pub/sub is not DB-scoped, so the channel must be isolated separately.
 */

export const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1';
export const TEST_TELEMETRY_CHANNEL = 'worker:telemetry:test';
