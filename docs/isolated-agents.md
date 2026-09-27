# Optional isolated Claude execution

Set `SOTTO_ISOLATED_CLAUDE_IMAGE` to a reviewed immutable image reference to opt
durable Claude lesson preparation into isolation. Leave it empty to preserve local
and SSH execution. Save the learner's personal Anthropic API key in Settings.
The model dropdown contains presets, so configure a canonical Claude API model
through the existing authenticated settings API. While signed in as that learner,
run this in the browser console on the Sotto origin, entering the exact canonical
model ID supported by your Anthropic endpoint:

```javascript
const model = prompt('Canonical Claude API model ID (starts with claude-)');
if (!model?.startsWith('claude-')) throw new Error('Canonical model ID required');
const response = await fetch('/api/v1/users/me', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ preferredAiModel: `claude-code:${model}` }),
});
if (!response.ok) throw new Error(await response.text());
```

This updates only that learner's preference. CLI aliases such as `sonnet` are
rejected because the broker pins the exact wire model. Saving a preset in the
model dropdown replaces the canonical preference.

The image and API credential revision are captured when preparation is admitted.
Changing either fences an existing task. Calls without a durable execution
workspace fail explicitly while this mode is selected. Isolation never falls back
to local or SSH execution when Docker, authentication or the protocol fails.

This mode requires a local Linux Docker host and an immutable reviewed image
containing Node and Claude Code 2.1.283. It supports text generation through an
Anthropic-compatible API endpoint. It does not support subscription credentials,
Codex, images, search or tools. Claude runs with `--bare`, which excludes OAuth
and keychain authentication. The real API key remains in a parent-owned broker.

The caller must supply an API credential captured under the learner's authority,
the exact endpoint, model selection, output-token limit, expiration, an authorized
fetch transport and a per-request admission callback. For preparations with a
request budget, admission reserves each attempt against that budget. Admission
also revalidates revocation and credential revision.
The execution signal must abort when an active task is cancelled or revoked.

Container identities, including Docker daemon identity, are fsynced into the
existing job journal's workspace before creation and removed after verified
cleanup. A lost creation acknowledgement or cleanup failure keeps the workspace
and its execution gate unresolved. For preparations with a request budget, the
provider transport charges each HTTP attempt to the preparation grant. Manual
preparations without a request budget do not count attempts. The isolated CLI never receives a real
API key. Per-request output is capped at 16,384 tokens and each invocation expires
after ten minutes.

Sidedoor's isolated runner provides non-root execution, no external networking,
a read-only root filesystem, bounded private scratch storage and resource limits.
The only host mount in the agent is its broker socket directory. The host and
Docker daemon remain trusted. Docker Desktop broker mounts from a macOS process
are unsupported.

The Sidedoor implementation includes a pinned CLI protocol fixture and a Linux
container-to-broker probe using synthetic responses. No paid model request is
needed for these checks. A deployment must additionally verify its chosen image,
provider endpoint and persisted recovery integration before enabling the mode.

Stop the original supervisor and all of its I/O before recovery. Copy the exact
`id`, `parentId`, `executorId` and `fingerprint` fields from its original
`JobExecutionJournal` record into `execution-binding.json`. The command accepts
only isolated class-preparation executions. From `apps/web`, with the original
database and `SIDEDOOR_EXECUTION_DIR` configuration loaded, run:

```bash
npx tsx scripts/reconcile-isolated-agent.ts execution-binding.json --supervisor-stopped
```

The command validates the exact parent and execution binding, revokes the task
grant and keeps the task unresolved. It verifies the original workspace location
and inode, reconciles containers against the recorded Docker daemon and labels,
then removes the workspace through Sidedoor's canonical cleanup function. Only
after that proof does it release the workspace receipt and settle the local
execution journal.

An absent or replaced attached workspace fails closed because missing identity
files cannot prove that a container stopped. An interrupted operator recovery can
also leave an unresolved receipt; do not clear it based on file absence. A replay
after confirmed journal release can finish journal settlement.

Provider attempts and charges remain unknown. The learner must acknowledge that
uncertainty through preparation recovery before the task can be cancelled and
replaced. This also checks descendant audio cleanup. Never run operator recovery
against an active supervisor.
