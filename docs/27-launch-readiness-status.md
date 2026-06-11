# Launch Readiness Status

Last updated: 2026-03-13

This document summarizes the recent production infrastructure work, what is fixed, what is still risky, and what should happen before launch day.

## Current Production State

- App hosting remains on Hetzner.
- PostgreSQL has been moved off the Hetzner box to Neon production.
- Redis has been moved off the Hetzner box to Redis Cloud.
- Local Redis, Postgres, and PgBouncer were removed from the Sotto server deploy stack.
- Production secrets now use managed `DATABASE_URL` and `REDIS_URL`.
- Blue-green app deploys are still in place for the web tier.

## What Was Fixed

### 1. Database isolation

Postgres is no longer competing with the app and workers for CPU, memory, and disk on the same Hetzner machine. This reduces noisy-neighbor problems and makes the web server more predictable under load.

### 2. Redis infrastructure separation

Redis is no longer a local container on the app server. That removes the old single-box dependency and makes Redis easier to scale independently.

### 3. Local infra cleanup

The deploy stack no longer starts local Redis/Postgres/PgBouncer. This avoids confusion about which services production is actually using.

### 4. BullMQ connection reduction

Worker code was refactored to reduce Redis client usage:

- queue events were removed from the worker path
- failure/completion handling moved into worker lifecycle hooks
- queue startup is filterable by profile and allowlist

This reduced Redis pressure, but it did not fully solve the connection ceiling for the full worker fleet.

### 5. Launch-safe worker mode

Production workers are currently stable because they are running a reduced "core" queue set:

- `heavy`: `audio-generation`, `audio-stitching`
- `pipeline`: `content-extraction`, `script-generation`, `script-verification`, `reference-validation`, `interactions`, `segment-regeneration`, `audio-import`
- `light`: `notifications`

This is the current safe operating mode.

### 6. Avatar route Redis connection leak

`GET /api/v1/podcasts/[podcastId]/video/avatars` was calling `createRedisConnection('avatar-cache')` on every request, creating a new ioredis TCP connection that was never closed. Under traffic, this silently exhausted Redis client slots. Fixed by switching to the `cache` singleton helper that reuses the module-level `getRedisClient()` connection.

## What Is Still Not Solved

### 1. Redis Cloud client ceiling for the full queue set

The current Redis Cloud plan cannot support all workers and all queues at once. If the full queue fleet starts, production will likely return to:

`ERR max number of clients reached`

Important: these Redis "clients" are backend connections from Sotto processes, not website visitors.

Connection breakdown per container (each worker creates 1 connection per queue for the Worker + 1 shared Queue connection):

| Container | Profile | Preset=core | Preset=full |
|---|---|---|---|
| workers-heavy | heavy | 4 | 16 |
| workers-pipeline | pipeline | 9 | 14 |
| workers-light | light | 3 | 23 |
| web (active slot) | — | 2 | 2 |
| **Total** | | **18** | **55** |

The 30MB Essentials plan has a 30 connection limit. The core preset fits (18), but the full preset overflows by ~25 connections.

### 2. Full-capacity launch readiness

Sotto is currently stable only in reduced worker mode. This is enough for the core podcast pipeline, but not for every background feature.

Non-core queues should remain disabled until either:

- the Redis plan is upgraded, or
- worker connection count is reduced further in code

### 3. Redis eviction policy

Redis Cloud is currently reporting:

`volatile-lru`

BullMQ expects:

`noeviction`

This should be corrected before launch to avoid queue correctness issues under memory pressure.

### 4. Monitoring and alerting gap

There is still no complete launch-grade alerting layer for:

- Redis connected clients
- queue backlog growth
- worker restart loops
- API health failures
- Neon connection or latency issues

## Recommended Launch-Day Configuration

Until Redis capacity is increased, launch with the reduced core worker set only. Treat all non-core queues as disabled by default.

Safe-for-launch core flow:

1. user creates podcast (status: EXTRACTING)
2. content extraction runs
3. script generation and verification run (≤3 loops)
4. reference validation runs (if references exist)
5. SCRIPT_READY pause (Pro/BYOK web users review and approve; Twitter/API/Telegram auto-approve)
6. audio generation (parallel per segment) and stitching run
7. notifications run

Note: `PENDING`/`DISCOVERING` statuses are used by BYOK resume, agent/manual setup, and admin paths. Standard web creation starts directly at `EXTRACTING`.

Everything outside that path should be considered optional for day one.

`deploy.sh` reads the env file selected by `SOTTO_ENV_FILE`, so launch-day queue and worker preset changes can be made without changing repository files.

## Required Next Steps Before Launch

### High priority

1. Increase Redis Cloud capacity so the system has headroom, not just a narrow pass condition.
2. Change Redis Cloud eviction policy to `noeviction`.
3. Make the reduced worker preset the enforced deploy default until Redis capacity is proven safe.
4. Add alerts for Redis client count, queue backlog, worker crashes, and app health.

### Medium priority

1. Continue reducing BullMQ connections by consolidating low-volume queues.
2. Add explicit kill switches for noncritical queue groups.
3. Run a launch-style load test against the core pipeline.

## Launch-Day Runbook

If Redis pressure returns:

1. keep web up
2. keep core podcast queues on
3. disable non-core queues first
4. check Redis connected client count
5. check queue backlog for core queues
6. only re-enable optional queues after Redis headroom is confirmed

## Bottom Line

Sotto is in a much better place than before:

- database and cache are now separated from the app server
- deploy infrastructure is cleaner
- the core podcast pipeline is currently stable in production

But the system is not yet safe to run the full worker fleet on the current Redis Cloud limits. Launch is safest if we keep the reduced core worker configuration, raise Redis headroom, fix Redis eviction policy, and add monitoring before opening traffic.
