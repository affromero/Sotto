import {
  credentialSaveRequestSchema,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { WelcomeCredentialSession } from '@/app/welcome/session/credential-session';
import type { KeyPost } from '@/app/welcome/providerMap';

/** HTTP boundary for wizard tests. Real client schemas and receipt reconciliation still execute. */
export function createWelcomeCredentialBoundary() {
  const snapshots = new Map<string, CredentialSettingsSnapshot>();
  const saved = new Map<string, Record<string, string | number | boolean>>();
  const providers = {
    'ai-keys': ['anthropic', 'openai', 'google'],
    byok: ['cartesia', 'elevenlabs', 'playht'],
    'visual-cues': ['pexels'],
  };
  for (const [scope, ids] of Object.entries(providers))
    snapshots.set(scope, {
      context: {
        instanceId: 'fixture-instance',
        scope,
        owner: { subjectId: 'fixture-owner', generation: 1 },
      },
      heads: Object.fromEntries(ids.map((id) => [id, null])),
      keys: [],
    });
  const session = new WelcomeCredentialSession();
  let loaded: Promise<void> | undefined;
  const signal = new AbortController().signal;
  return {
    saved,
    handle(input: RequestInfo | URL, init?: RequestInit) {
      const endpoint = String(input).match(
        /^\/api\/v1\/settings\/(ai-keys|byok|visual-cues)$/
      )?.[1];
      if (!endpoint) return undefined;
      const snapshot = snapshots.get(endpoint)!;
      if (!init?.method) return Response.json(snapshot);
      if (init.method !== 'POST') return Response.json({}, { status: 405 });
      const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
      if (snapshot.heads[command.provider] !== command.expectedRevision)
        return Response.json({}, { status: 409 });
      const slot = `${endpoint}:${command.provider}`;
      const values = 'values' in command ? { ...command.values } : { ...saved.get(slot) };
      if ('patch' in command)
        for (const [field, value] of Object.entries(command.patch)) {
          if (value === null) delete values[field];
          else values[field] = value;
        }
      saved.set(slot, values);
      snapshot.heads[command.provider] = command.operationId;
      snapshot.keys = [
        ...snapshot.keys.filter((key) => key.provider !== command.provider),
        {
          provider: command.provider,
          revision: command.operationId,
          isValid: true,
          verification: {
            lastAttempt: { status: 'verified', checkedAt: 1 },
            lastConfirmed: { status: 'verified', checkedAt: 1 },
          },
        },
      ];
      return Response.json({
        status: 'saved',
        revision: command.operationId,
        context: command.context,
        validation: { status: 'valid', readiness: { code: 'ready', checkedAt: 1 } },
      });
    },
    async submitSetup(payload: Record<string, unknown>) {
      return fetch('/api/v1/onboarding/save', {
        method: 'POST',
        credentials: 'include',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    async saveCredentials(posts: readonly KeyPost[]) {
      if (posts.length) {
        loaded ??= session.load(signal);
        await loaded;
      }
      return (await session.save(posts, signal)).status === 'ready';
    },
  };
}

export function withWelcomeCredentialBoundary(
  boundary: ReturnType<typeof createWelcomeCredentialBoundary>,
  fallback: (...args: Parameters<typeof fetch>) => unknown
) {
  return (...args: Parameters<typeof fetch>) => boundary.handle(...args) ?? fallback(...args);
}
