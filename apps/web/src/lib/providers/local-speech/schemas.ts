import { z } from 'zod';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';

const localId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/+-]*$/);
const endpoint = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => Boolean(resumeEndpoint(value)),
    'Use an HTTP(S) endpoint without credentials, query parameters or fragments.'
  );
const language = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*$/);

export const localSpeechDiscoverSchema = z.object({ endpoint }).strict();
export const localSpeechPreviewSchema = z
  .object({
    endpoint,
    model: localId,
    voiceId: localId,
    language: language.optional(),
    text: z.string().trim().min(1).max(240),
  })
  .strict();
export const localVoiceCatalogSchema = z.object({
  voices: z
    .array(
      z.object({
        id: localId,
        name: z.string().trim().min(1).max(160).optional(),
        label: z.string().trim().min(1).max(160).optional(),
        language: language.optional(),
      })
    )
    .min(1)
    .max(128)
    .refine((voices) => new Set(voices.map((voice) => voice.id)).size === voices.length),
});
