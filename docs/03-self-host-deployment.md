# Self-Host Deployment Guide

**Date:** 2026-10-16

**Summary:** Install Sotto on your computer with Docker, or deploy it to a VPS with explicit settings and private storage.

---

## Install on your computer

Start Docker and confirm `docker info` and `docker compose version` succeed.
Use Linux or macOS, or a WSL2 terminal with Docker Desktop integration on Windows.
Then run:

```bash
curl -fsSL https://sotto.fm/install.sh | bash
```

The installer verifies a matching published image pair before changing your
configuration. It downloads the release's Compose file, migrates the database,
seeds the curriculum, and waits for health. It stores settings in `~/.sotto/.env`.
Keep this file private and back it up along with your database and audio files.

Use the URL and instance password printed at completion. The default URL is
`http://localhost:3000`. The welcome wizard lets you configure languages and
providers. An OpenAI key covers generation and speech. Anthropic and local agent
logins cover generation; configure a speech provider for listening and speaking.

Choose option 5 to configure providers later in the browser. For unattended
installation, download the script first and pass the prompt settings to Bash:

```bash
curl -fsSL https://sotto.fm/install.sh -o install.sh
SOTTO_YES=1 SOTTO_AGENT_CHOICE=5 bash install.sh
```

Sotto Host is a desktop controller for an installed stack. Run the installer
first, then use the launcher to start or stop it. A Windows home directory differs
from a WSL home; use the browser from WSL if the launcher cannot find the stack.

```bash
sotto-host status
sotto-host update --check
sotto-host update
```

Updates use published images, rather than assuming the newest source commit has
a finished build. Failed downloads and pulls preserve your configuration.
`sotto-host rollback` restores the previous deployment files and images after an
update. Database migrations are forward-only; image rollback does not restore the
database. Keep the backup created before an update.

The Sidedoor conversion prepares canonical provider, model, storage, learner,
and encrypted credential state before switching releases. The active release
keeps its source tables during the candidate health check. Finalization removes
those tables only after health succeeds. Any preparation or finalization error
rolls back its database transaction and stops the update.

| Problem                                               | Action                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Docker is installed but unavailable                   | Start Docker Desktop or the Docker daemon. Confirm `docker info` works as your user.                                               |
| `denied` or `unauthorized` while pulling Sotto images | The public package or release is unavailable. Maintainers must fix registry visibility; a new user should not need a GitHub token. |
| `no matching manifest`                                | The selected release lacks an image for your architecture. Use a release with matching platform support.                           |
| Port is already in use                                | Choose another port when prompted. Open the URL printed by the installer.                                                          |
| Startup or migration fails                            | Run `cd ~/.sotto && docker compose logs --tail 100 web workers postgres`. Resolve the reported error before retrying.              |
| Linux AppImage reports missing `appsink`              | Use a launcher release that bundles the media framework. Reinstalling the Docker stack does not fix an older launcher binary.      |

The VPS instructions below are for operators deploying behind their own domain.

## Before You Start

You need:

- a Linux VPS with Ubuntu 24.04 or equivalent;
- a domain you control;
- DNS access for that domain;
- an SSH key installed on the VPS;
- provider accounts for the AI and TTS services you choose;
- a storage decision: local disk for first install, or S3-compatible object storage for production.

This guide assumes the app lives at `https://your-domain.example`. Replace that value everywhere with your own domain.

## 1. Provision the VPS

Run the server bootstrap as root:

```bash
ssh root@YOUR_SERVER_IP
bash -s < /path/to/local/scripts/setup-server.sh
```

The script creates a `sotto` user, installs Docker and Caddy, opens ports `22`, `80`, and `443`, and disables SSH password/root login.

Log back in as the app user:

```bash
ssh sotto@YOUR_SERVER_IP
```

## 2. Clone the Repository

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git ~/sotto
cd ~/sotto
```

## 3. Configure DNS

Create DNS records at your registrar:

| Type    | Host  | Value                                              |
| ------- | ----- | -------------------------------------------------- |
| `A`     | `@`   | `YOUR_SERVER_IPV4`                                 |
| `AAAA`  | `@`   | `YOUR_SERVER_IPV6` if used                         |
| `CNAME` | `www` | `your-domain.example` if you want the www redirect |

Wait until this resolves from your local machine:

```bash
dig your-domain.example +short
```

## 4. Create the Production Env File

```bash
cd ~/sotto
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

Set these first:

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.example
BYOK_ENCRYPTION_KEY=<openssl rand -base64 32>
```

Set database and Redis values for the included compose stack:

```bash
POSTGRES_USER=sotto
POSTGRES_PASSWORD=<strong password>
POSTGRES_DB=sotto
DATABASE_URL=postgresql://sotto:<strong password>@pgbouncer:5432/sotto?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://sotto:<strong password>@postgres:5432/sotto
REDIS_PASSWORD=<strong password>
REDIS_URL=redis://:<strong password>@redis:6379
```

Storage ownership uses `DIRECT_DATABASE_URL` for session-level PostgreSQL locks.
Point it at PostgreSQL directly or a session pool, never a transaction pool.
When it is unset, storage uses `DATABASE_URL`, which must meet the same requirement.
An invalid or unavailable configured direct connection fails without switching databases.

Public images run as UID 1001. Production builds that share CLI homes with other
applications use `RUNTIME_UID=1000` for both web and workers. Every process sharing
a CLI home must use its owner UID; supplementary groups cannot access the CLI's
private directories. Keep one shared credential file so token refreshes remain
visible to every consumer. Do not recursively change CLI file modes.

Changing an existing deployment's runtime UID requires a coordinated stop of its
web and workers, a backup, and an ownership migration of its storage and execution
volumes. Preserve file contents, modes, inodes, and execution markers. Record the
previous ownership for rollback, including how to reverse ownership of newly
created files. Shared CLI homes need a separate audit of all consumers before any
ownership change. The default public images retain their existing UID, so normal
self-host updates do not require this transition.

Start the stack, open `/welcome`, and choose the AI, speech, and storage providers. Save hosted credentials or local service URLs there. Sidedoor encrypts credentials and applies the same configuration to web and worker processes. Provider usage and limits are configured in Admin alongside the corresponding saved credential.

For local media storage, select **Local** in `/welcome` or Admin and save the mounted shared storage root.

For optional Caddy www-redirect:

```bash
SOTTO_WWW_DOMAIN=www.your-domain.example
```

Leave that unset if you do not want the optional www-redirect Caddy block rendered.

## 5. Configure Caddy Import

As root, make sure `/etc/caddy/Caddyfile` imports fragments:

```bash
sudo mkdir -p /etc/caddy/conf.d
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
{
	email admin@your-domain.example
}

import /etc/caddy/conf.d/*
CADDY
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`scripts/deploy.sh` renders the repository `Caddyfile` template with your `NEXT_PUBLIC_APP_URL` host and installs the result as `/etc/caddy/conf.d/sotto.conf`.

## 6. Deploy

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

Production deployment uses `SOTTO_IMAGE_SOURCE=registry` and rejects server builds. Build the web and worker images on a separate machine or CI runner. The web image must include your `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` at build time. Local development and the OSS installer keep their existing compose workflows.

Set `SOTTO_RELEASE_SHA` to the full committed checkout SHA and provide complete digest references in `SOTTO_WEB_IMAGE_REF` and `SOTTO_WORKERS_IMAGE_REF`. Both images must carry that revision in the `org.opencontainers.image.revision` label. Supply measured positive byte counts from the builder: `SOTTO_WEB_IMAGE_BYTES`, `SOTTO_WEB_TRANSFER_BYTES`, `SOTTO_WORKERS_IMAGE_BYTES`, and `SOTTO_WORKERS_TRANSFER_BYTES`. Expanded image sizes and compressed transfer sizes are separate inputs. The checkout and submodules must be clean and match the selected release; the script does not pull a moving branch.

The production image workflow publishes `production-release.json` and
`production-release-metadata.json` in the same release artifact. The first file
retains the source SHA and three immutable image references. The second binds
each image's actual ID, configuration digest, architecture, source revision and
canonical storage measurements to the successful source-validation and image
build runs. Worker metadata also includes the schema, rolling contract, queue
names and complete provider asset inventory. Verify the artifact's run and
source identities before using these records. Operators can use the published
measurements and inventories without downloading the images locally.

Failed-job retries reuse the exact artifacts from successful image jobs in the
same run. Each receipt retains its actual attempt number. Full reruns preserve
separate image receipts and replace the final release artifact with the latest
verified aggregate.

The builder runs `scripts/deploy/images/measure_image.py` against each verified
image. Expanded bytes retain the larger of allocated layer storage and image
history. Transfer bytes retain the larger of the saved archive and its gzip.
Production uses a containerd image store so the recorded image ID matches the
digest that the serving daemon will inspect. Configuration digests remain
separate identities. Registry build caches have separate writers for each image
and platform. A cache miss rebuilds the image through the same smoke checks.

Source validation runs independent web, package, deployment-tooling and speech
checks in parallel on the same source revision. The final source check requires
every group to succeed. Local `npm run ci` still runs the complete check suite.

Install your reviewed shared-host capacity checker before using this production script. `PRODUCTION_CAPACITY_CHECKER` defaults to `/usr/local/lib/production/production_capacity.py`. Its `before-import` command receives `--image-bytes` and `--transfer-bytes`; `before-switch` checks remaining capacity after imports. A missing checker or rejected allocation stops deployment. Use a policy that reserves at least 10 GiB, rejects disk or inode usage at 85%, and requires 100,000 free inodes. The script holds `/var/lock/production-build.lock` through health verification. Preinstall any required infrastructure/helper images through the same admission process; service commands cannot pull unbudgeted images.

Provide `SOTTO_BACKUP_BYTES` as a measured allowance for the database archive. The checker reserves that allocation alongside absent images; exact digests already present need no import budget. `SOTTO_BACKUP_DIR` defaults to `$HOME/.local/state/sotto-backups/$SOTTO_STACK`. Before candidate startup, the script checks database size, creates a custom-format `pg_dump`, reads the full archive with `pg_restore` without restoring a database, and retains its checksum. The current site keeps serving during this transactionally consistent backup. Completed deployments retain the newest ten successful backups and all backups younger than thirty days, including the current and previous deployment. Cleanup removes only older backups with matching success metadata and checksums. Failed, unmarked, malformed, and symlinked backups remain for review.

Existing-stack deployments require identical Prisma schema and migration assets. The default rolling path also requires identical shared job contracts and Sidedoor runtime assets between current and candidate workers. The runner verifies applied migration checksums and finalized access state without writing to the database. It preserves shared credentials and running infrastructure. Runtime differences require the exact-pair compatibility procedure below. Schema changes require a separate migration procedure.

The old site serves pages, APIs and audio throughout backup, candidate startup and worker draining. After candidate health and smoke checks pass, the runner saves each queue's original pause flag, pauses delivery and waits for active jobs and provider cleanup to settle. New asynchronous requests remain durable and wait for delivery to resume. Workers are replaced individually only after their captured process trees are idle. Caddy then routes to the healthy candidate, the runner restores the original queue flags and gracefully retires the old web slot without a forced-kill deadline. Routine compatible releases do not install a full-site maintenance response.

A failed candidate leaves the old slot serving. Failures during replacement restore old routing and verified workers before resuming queues. Unknown provider ownership, unresolved cleanup or an unverified rollback retains the deployment lock and evidence, with queues paused. The durable `$HOME/.local/state/sotto-deploy/unresolved.json` marker also blocks a new attempt after an interrupted controller. Inspect the recorded containers, queue manifest and cleanup state before clearing that marker. Never clear it to bypass unresolved work.

Matching schema-review hashes cannot bypass this restriction. Additive enum changes can still make newly written rows unreadable by older Prisma clients. Before a separate schema-changing rollout, fence HTTP admissions, preserve and pause the affected queues, verify that active jobs and provider executions have settled, and only then stop the old services. Worker shutdown cancels active jobs; it does not safely drain them. The migration procedure must define the point after which recovery keeps admissions fenced and proceeds with compatible code instead of restarting the previous release.

### Reviewed runtime compatibility

For a runtime upgrade with unchanged Prisma assets, independently review the
exact current and candidate immutable images before enabling overlap. Compare
installed dependency versions and executable changes, existing queued job
versions and payloads, credential envelopes, authority checks, storage records,
provider execution ownership, and cleanup semantics. Verify that old HTTP
requests can finish safely while new workers run. Verify that shared state
written before old HTTP retirement remains readable by the old code. Defer
new provider state when the old catalog cannot read it. A version number or passing schema hash does not establish
that compatibility.

Set `SOTTO_COMPATIBILITY_REVIEW_FILE` and
`SOTTO_COMPATIBILITY_EVIDENCE_FILE` to private, operator-owned regular files.
The evidence contains the actual independent review. A schema version 1 review
file is JSON with exactly these fields:

| Field                     | Required value                                                              |
| ------------------------- | --------------------------------------------------------------------------- |
| `schemaVersion`           | Integer `1`                                                                 |
| `procedure`               | `compatible-runtime-overlap`                                                |
| `stack`                   | Exact `SOTTO_STACK`                                                         |
| `releaseSha`              | Full candidate source SHA                                                   |
| `candidateWebImage`       | Exact digest-pinned web reference                                           |
| `candidateWorkersImage`   | Exact digest-pinned worker reference                                        |
| `previousWebImage`        | Captured previous web image ID                                              |
| `previousWorkerContracts` | Object mapping every captured worker image ID to its measured contract hash |
| `candidateContract`       | Measured candidate worker contract hash                                     |
| `reviewer`                | Independent reviewer identity                                               |
| `evidenceSha256`          | SHA-256 of the exact evidence file bytes                                    |

Use `scripts/deploy/checks/rolling-contract.cjs` against the exact images to
measure runtime hashes. It follows Node's workspace package search paths while
rejecting symlinked or incomplete executable packages. The validator rejects
duplicate JSON fields, stale identities, extra fields, changed evidence, and
unreviewed mismatches. Accepted review and evidence bytes are saved together
in the durable attempt directory before services change.

For first activation, the Fish upgrade also inspects existing credentials, profile and server
selections, episodes, segments, voice assignments, and queued work without
changing them. Existing Fish state rejects
this procedure. The candidate web and workers receive a read-only directory
mount with `SOTTO_PROVIDER_ACTIVATION_FILE`, bound to `SOTTO_RELEASE_SHA`.
It keeps Fish credential saves, selections, configuration writes, episode
admission, audio retries, and HTTP dispatch disabled while old HTTP remains
active. Other providers stay usable.
The mounted gate is readable by the verified runtime UID without exposing the
private review directory. Missing, unreadable, malformed, oversized, symlinked,
empty, or mismatched configured gates fail closed. An absent variable preserves
ordinary local behavior.

An already-enabled Fish installation can instead use a schema version 2 review.
It retains every version 1 field and adds `providerActivation` with these exact
fields:

| Field                  | Required value                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `mode`                 | `preserve-existing`                                                                                                      |
| `previousReleaseSha`   | Full source SHA of the currently enabled installation                                                                    |
| `previousAssetsHash`   | Complete protected asset hash of the previous workers                                                                    |
| `candidateAssetsHash`  | Complete protected asset hash of the candidate workers                                                                   |
| `reviewedRuntimeFiles` | Exact changed file paths, each with `previousSha256` and `candidateSha256`; use `null` only for an added or removed file |
| `previousRuntimes`     | Exact `containerId` and `imageId` for `web`, `workers-heavy`, `workers-pipeline` and `workers-light`                     |

Generate both asset inventories with
`scripts/deploy/runtime/provider-assets.cjs`. Independently review the complete
changed file set and the resulting behavior. Every changed asset must appear in
the review; wildcards, missing changes and unrelated entries are rejected. The
runner verifies each captured runtime's source revision, enabled activation
record and unique read-only mount. It prepares an enabled candidate record,
then checks old and candidate mounts again before switching traffic. This
preserves the existing activation while retaining compatibility, backup, queue,
capacity and recovery checks. It does not authorize first activation or accept
provider changes without review.

After saving original queue flags, a compatibility rollout persists a
`compatibility-preparation` recovery marker before pausing or replacing
workers. A crash blocks subsequent deployments so the original queue manifest
cannot be overwritten. Verified failures before candidate routing may restore
the old services and clear only that attempt's preparation marker.

Before installing candidate routing, the runner atomically advances the
marker to `compatibility-cutover`. From that point, new features may write
state or jobs that old code cannot process. Automatic rollback to old code is
disabled. Any failure retains the deployment lock, compatible services,
review evidence and original queue manifest. The runner attempts to pause
delivery again and records observed queue flags, including after a partial
restore. Unconfirmed fencing remains an error; active work is never killed to
claim a drain. Recovery requires reviewed forward progress with compatible
code. Do not clear the marker to retry a deployment.

Successful rollout clears its cutover marker only after public health, old
HTTP retirement, image retention, backup retention and rollback-tag updates
finish. Only then does a first-activation rollout atomically enable Fish. The mounted gate
directory remains available for the active containers. Saved old image digests remain recovery evidence. They do not authorize
rolling back after a new provider or job format has been activated. Register
the operator's Fish key and test it after old services have fully settled.

Rollback protection records live in `PRODUCTION_IMAGE_RETENTION_DIR`, defaulting to `$HOME/.local/state/production-image-retention`. Each attempt protects its incoming and existing image IDs before service changes. Success retains the new images and pre-deploy images; failed-attempt records remain until reviewed maintenance retires them. Deployment does not prune images, build caches or volumes.

If your host already uses rollback tags, set `SOTTO_WORKERS_ROLLBACK_TAG` and `SOTTO_WEB_ROLLBACK_TAG` to those exact existing references. After successful health verification, the script updates them to the captured pre-deploy image IDs. Failed deployments leave those tags unchanged.

The deploy script:

1. verifies the exact committed release and acquires the shared lock;
2. copies `.env.production` to `.env` for Docker Compose;
3. admits the measured image budget, pulls verified digests and rechecks capacity;
4. records rollback image protection and validates Caddy;
5. verifies existing infrastructure, access state and migration checksums (first install starts infrastructure and initializes the database);
6. backs up the database while the current site serves, then checks RAM for overlapping web slots;
7. starts and health-checks the new web slot, then runs `scripts/smoke-prod.sh`;
8. preserves queue flags, pauses delivery and drains jobs before replacing idle workers individually;
9. switches Caddy to the verified candidate and restores queue flags;
10. gracefully stops the previous web slot and records successful image retention after final capacity verification.

## 7. Verify

```bash
curl -s https://your-domain.example/api/v1/health
docker compose -f docker-compose.infra.yml ps
docker compose -f docker-compose.workers.yml ps
```

Check app-slot containers by project name:

```bash
docker compose -f docker-compose.app.yml -p sotto-blue ps
docker compose -f docker-compose.app.yml -p sotto-green ps
```

Exactly one app slot should be active after a successful deploy.

## 8. Storage CORS

For S3-compatible storage, restrict CORS to your exact public app URL:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.example"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

Do not use wildcard origins for private episode audio.

## 9. Backups

Enable database backups:

```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo "0 3 * * * ~/sotto/scripts/backup.sh") | crontab -
```

Also back up the selected storage backend. A database backup without the generated audio files is not a complete restore path.

## Troubleshooting

| Symptom                     | Check                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Deploy cannot find env      | `SOTTO_ENV_FILE` path or `~/sotto/.env.production`                                                   |
| Caddy reload fails          | `sudo caddy validate --config /etc/caddy/Caddyfile`                                                  |
| Health check fails          | `docker compose -f docker-compose.app.yml -p sotto-blue logs web --tail 80` and the green equivalent |
| Workers do not process jobs | `REDIS_URL`, `DATABASE_URL`, and worker logs                                                         |
| Audio is not reachable      | storage provider env, bucket CORS, and private stream route authorization                            |

## Update Flow

After the first deploy, updates are the same command:

```bash
cd ~/sotto
SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh
```

The slot file at `~/.sotto-deploy-slot` records which app slot is active. Do not edit it during a deploy.
