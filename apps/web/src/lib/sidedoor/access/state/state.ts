import { z } from 'zod';
import { accessStateSchema, initialAccessState } from 'thesidedoor-core/access';

export const INSTALLED_PROFILE_INITIALIZATION = 'sotto-installed-profiles-v1';
export const sharedConfigurationValueSchema = z.record(z.string(), z.json());

/** Access and provider ownership changes share one database commit. */
export const sidedoorStateSchema = z.object({
  version: z.literal(2),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  access: accessStateSchema,
  configuration: z.object({
    site: sharedConfigurationValueSchema.nullable(),
    automaticModels: sharedConfigurationValueSchema.nullable(),
  }),
});
export type SidedoorState = z.infer<typeof sidedoorStateSchema>;
export type CredentialScope = 'ai' | 'tts' | 'stt' | 'music' | 'visual' | 'storage' | 'pricing';

export function initialSidedoorState(): SidedoorState {
  return {
    version: 2,
    revision: 0,
    access: initialAccessState(),
    configuration: { site: null, automaticModels: null },
  };
}
