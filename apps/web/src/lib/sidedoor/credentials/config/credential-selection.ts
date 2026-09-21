import { AccessError } from 'thesidedoor-core/access';
import type { Prisma } from '@/generated/prisma/client';
import { sottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-endpoints';
import {
  captureSottoCredentialOwner,
  sottoCredentialRows,
  sottoCredentialSlot,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import {
  credentialSelectionEnvelopeSchema,
  type CredentialSelectionEnvelope,
} from '@/lib/sidedoor/credentials/config/credential-selection-contract';
import { getAiProviderIds } from '@/lib/providers/ai-registry';
import { getProviderIds } from '@/lib/providers/tts-registry';
import { getSttProviderIds } from '@/lib/providers/stt-registry';

interface Preferences {
  aiProvider?: string | null;
  ttsProvider?: string | null;
  sttProvider?: string | null;
}

/** Pins personal settings. Actual provider execution must independently validate its effective selection. */
export async function validateSottoCredentialSelection(
  database: Prisma.TransactionClient,
  userId: string,
  envelope: CredentialSelectionEnvelope,
  ...preferences: (Preferences | undefined)[]
) {
  const captured = credentialSelectionEnvelopeSchema.parse(envelope);
  const storage = await sottoCredentialRows(database);
  const owner = await captureSottoCredentialOwner(database, userId);
  if (
    captured.context.instanceId !== storage.instance.instanceId ||
    captured.context.owner.subjectId !== owner.subjectId ||
    captured.context.owner.generation !== owner.generation
  )
    throw new AccessError('conflict', 'The displayed credential owner changed');
  const selected = new Set<string>();
  for (const selection of captured.selections) {
    const endpoint = sottoCredentialEndpoint(selection.endpoint);
    if (!endpoint.providers.includes(selection.provider))
      throw new AccessError('invalid', 'Unsupported credential selection');
    const slot = sottoCredentialSlot(endpoint.scope(selection.provider), selection.provider);
    const identity = `${slot.modality}:${slot.provider}`;
    if (selected.has(identity)) throw new AccessError('invalid', 'Duplicate credential selection');
    selected.add(identity);
    const head = await storage.owned.head({ ...slot, owner });
    if (
      head.revision !== selection.expectedRevision ||
      (head.credential && head.credential.availability !== 'enabled')
    )
      throw new AccessError('conflict', 'The displayed credential selection changed');
  }
  for (const preferred of preferences) {
    for (const [scope, provider, registered, keyless] of [
      ['ai', preferred?.aiProvider, getAiProviderIds(), ['local', 'claude-code', 'codex']],
      ['tts', preferred?.ttsProvider, getProviderIds(), ['local', 'kokoro']],
      ['stt', preferred?.sttProvider, getSttProviderIds(), ['local']],
    ] as const) {
      if (!provider) continue;
      if (!(registered as readonly string[]).includes(provider))
        throw new AccessError('invalid', 'Unsupported provider selection');
      if ((keyless as readonly string[]).includes(provider)) continue;
      const slot = sottoCredentialSlot(scope, provider);
      if (!selected.has(`${slot.modality}:${slot.provider}`))
        throw new AccessError('invalid', 'Missing selected provider credentials');
    }
  }
}
