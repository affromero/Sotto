import {
  providerCredentials,
  providerIdentity,
  type ProviderModality,
} from 'thesidedoor-core/providers/catalog';

/** Preserve the existing settings form shape while sharing provider credential definitions. */
export function providerCredentialForm(provider: string, modality: ProviderModality) {
  const metadata = providerCredentials(provider, modality);
  return {
    getApiKeyUrl: metadata.helpUrl,
    fields: metadata.fields.map((field) => ({
      key: field.id,
      label: field.label,
      placeholder: field.placeholder ?? '',
      ...(field.kind === 'number' ? { type: 'number' as const } : {}),
      ...(!field.required ? { optional: true } : {}),
    })),
  };
}

/** The AI settings section also holds credentials for transcription-only providers. */
export function aiCredentialForm(provider: string) {
  const modality = providerIdentity(provider).modalities.includes('text')
    ? 'text'
    : 'transcription';
  return providerCredentialForm(provider, modality);
}
