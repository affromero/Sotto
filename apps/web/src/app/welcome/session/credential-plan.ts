import {
  providerCredentials,
  providerIdentity,
  type ProviderModality,
} from 'thesidedoor-core/providers/catalog';
import type { CredentialValues } from 'thesidedoor-core/ai';
import type { KeyPost } from '../providerMap';

export interface PlannedCredentialEdit {
  endpoint: KeyPost['endpoint'];
  provider: string;
  baseUrl?: string;
  values: CredentialValues;
}

function modality(post: KeyPost): ProviderModality {
  switch (post.endpoint) {
    case 'ai-keys':
      return providerIdentity(post.provider).modalities.includes('text') ? 'text' : 'transcription';
    case 'visual-cues':
      return 'visual';
    case 'byok':
      return post.provider === 'suno' ? 'music' : 'speech';
  }
}

function typedValues(post: KeyPost): CredentialValues {
  const descriptor = providerCredentials(post.provider, modality(post));
  const catalogue = new Map(
    [...descriptor.fields, ...descriptor.configurationFields].map((field) => [field.id, field])
  );
  const supplied: Record<string, string> = { ...post.extra, apiKey: post.apiKey };
  if (post.extra?.apiKey !== undefined && post.extra.apiKey !== post.apiKey)
    throw new Error(`Conflicting API keys for ${post.provider}.`);
  const values: CredentialValues = {};
  for (const name of Object.keys(supplied)) {
    const field = catalogue.get(name);
    if (!field) throw new Error(`Unknown credential field for ${post.provider}: ${name}`);
    const raw = supplied[name]!;
    switch (field.kind) {
      case 'string':
        values[name] = raw;
        break;
      case 'number': {
        const number = Number(raw);
        if (!Number.isFinite(number)) throw new Error(`Check ${field.label} for ${post.provider}.`);
        values[name] = number;
        break;
      }
      case 'boolean':
        if (raw !== 'true' && raw !== 'false')
          throw new Error(`Check ${field.label} for ${post.provider}.`);
        values[name] = raw === 'true';
    }
  }
  return values;
}

/** Finish all alias and field checks before the caller can dispatch a write. */
export function planCredentialWrites(
  posts: readonly KeyPost[]
): Map<string, PlannedCredentialEdit> {
  const plan = new Map<string, PlannedCredentialEdit>();
  for (const post of posts) {
    const slot = [post.endpoint, post.provider].join(':');
    const candidate: PlannedCredentialEdit = {
      provider: post.provider,
      endpoint: post.endpoint,
      baseUrl: post.baseUrl,
      values: typedValues(post),
    };
    const previous = plan.get(slot);
    if (!previous) {
      plan.set(slot, candidate);
      continue;
    }
    if (candidate.baseUrl !== previous.baseUrl)
      throw new Error(`Resolve different endpoints for ${post.provider} before continuing.`);
    for (const [field, value] of Object.entries(candidate.values)) {
      if (Object.hasOwn(previous.values, field) && !Object.is(previous.values[field], value))
        throw new Error(
          `Resolve different ${field} settings for ${post.provider} before continuing.`
        );
    }
    plan.set(slot, { ...candidate, values: { ...previous.values, ...candidate.values } });
  }
  return plan;
}
