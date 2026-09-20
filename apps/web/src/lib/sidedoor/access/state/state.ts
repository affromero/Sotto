import { z } from 'zod';
import { accessStateSchema, initialAccessState } from 'thesidedoor-core/access';

export const CREDENTIAL_SCOPES = [
  'ai',
  'tts',
  'stt',
  'music',
  'visual',
  'storage',
  'pricing',
] as const;
export const INSTALLED_PROFILE_INITIALIZATION = 'sotto-installed-profiles-v1';
export const credentialScopeSchema = z.enum(CREDENTIAL_SCOPES);
export const sharedConfigurationValueSchema = z.record(z.string(), z.json());

/** Access and provider ownership changes share one database commit. */
export const sidedoorStateSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    access: accessStateSchema,
    configuration: z.object({
      site: sharedConfigurationValueSchema.nullable(),
      automaticModels: sharedConfigurationValueSchema.nullable(),
    }),
  })
  .refine((state) => {
    const privateIds = new Set(
      state.access.principals
        .filter(
          (principal) =>
            principal.passwordHash !== null ||
            state.access.passkeys.some((key) => key.principalId === principal.id)
        )
        .map((principal) => principal.id)
    );
    return !state.access.householdProfiles?.some((profile) => privateIds.has(profile.id));
  }, 'Credentialed learner accounts cannot remain selectable household profiles');
export type SidedoorState = z.infer<typeof sidedoorStateSchema>;
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

export function initialSidedoorState(): SidedoorState {
  return {
    version: 2,
    revision: 0,
    access: initialAccessState(),
    configuration: { site: null, automaticModels: null },
  };
}
