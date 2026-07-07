# PR: Isolate integration tests on a dedicated Redis DB and channel

Branch: `fix/integration-redis-isolation`
Date: 2026-07-07
Time since implementation: the integration tests were written 2026-07-02 (commit `e64c35e` and follow-ups), so this hardening lands ~5 days later.

## Summary

The integration tests shared one Redis instance, one queue name, and one telemetry channel with any locally running dev server. A dev server autoscaling `node-N` workers on db 0 stole the tests' queued frames and polluted their telemetry subscriber, making `loadBalancing` and `crashRecovery` fail with phantom node ids. This routes the tests onto a dedicated Redis DB (queue isolation) and a dedicated pub/sub channel (telemetry isolation), so a running dev server can no longer interfere.

## What changed

Worker gains a `TELEMETRY_CHANNEL` env override (production default unchanged):

- `ProcessDeps` carries `telemetryChannel`; `publishTelemetry(publisher, channel, msg)` takes the channel explicitly; `simulateStageWork` and `worker/src/index.ts` thread the resolved channel through; `subscribeTelemetry` reads the same env default.

Test isolation:

- New `__tests__/integration/testRedis.ts`: `TEST_REDIS_URL` (`redis://127.0.0.1:6379/1`) and `TEST_TELEMETRY_CHANNEL`.
- `spawnTestWorker` injects both into every spawned worker.
- All six integration tests use the isolated DB and channel, and `flushall` became `flushdb` so the tests never wipe a dev server's db 0.

## Architectural decisions

- **DB isolates the queue; a separate channel isolates telemetry.** Redis pub/sub is not DB-scoped: `SUBSCRIBE` receives messages published anywhere on the instance regardless of the selected DB. A dedicated DB alone would still leave the telemetry-based assertions (`loadBalancing`, `crashRecovery`) exposed. Both levers are required. Alternative considered: a separate Redis instance on a test port, which isolates both with no worker change but needs the test harness to manage a second server; rejected as heavier for a single-instance local/CI setup.
- **Env override, not a hardcoded test constant, in production code.** The worker already resolves `REDIS_URL`, `STAGE_MS`, etc. from env with a default; the channel now follows the same pattern. Production behavior is unchanged (default channel when the env var is unset).
- **`flushdb` over `flushall`.** With isolation, `flushall` would wipe every DB on the instance, destroying a running dev server's db 0 state. `flushdb` scopes the reset to the test DB.

## Testing

- `tsc --noEmit` green across all four workspaces.
- Full suite green: 48 server (all 8 integration) + 12 web + 1 worker.
- Adversarial proof: started the real demo server as a polluter (autoscaling `node-N` workers on db 0, publishing to the default channel, an active `bull:render-frames` queue on db 0), then ran `loadBalancing` and `crashRecovery` on the isolated DB and channel. Both passed. The same conditions failed before this change. The full server suite also passed while a separate dev environment was running on db 0.

## Reflection

- What is clearer now: the original "flaky" failures were never flaky and never a code defect. They were a shared-state collision with a leaked dev server. The durable fix is isolation, not weakening the assertions (which was the first instinct and would have hidden a valid check).
- What was subtle: DB isolation feels sufficient until you remember pub/sub ignores the DB. Getting only half the isolation would have looked fixed while `loadBalancing` stayed exposed.
