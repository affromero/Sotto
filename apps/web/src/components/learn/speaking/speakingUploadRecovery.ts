import { z } from 'zod';
import { speakingEvidenceSchema, type SpeakingEvidence } from '@sotto/shared';

const fenceSchema = z.object({ baseline: z.string().nullable() });
const fences = new Map<string, { baseline: string | null }>();
const key = (endpoint: string, promptId: string) => `speaking-upload:${endpoint}/${promptId}`;

export function pendingSpeakingUpload(endpoint: string, promptId: string) {
  const identity = key(endpoint, promptId);
  const existing = fences.get(identity);
  if (existing) return existing;
  try {
    const parsed = fenceSchema.safeParse(JSON.parse(sessionStorage.getItem(identity) ?? 'null'));
    if (parsed.success) {
      fences.set(identity, parsed.data);
      return parsed.data;
    }
  } catch {
    /* In-memory recovery remains available when storage is unavailable. */
  }
  return null;
}

export function retainSpeakingUpload(endpoint: string, promptId: string, baseline: string | null) {
  const identity = key(endpoint, promptId);
  const value = { baseline };
  fences.set(identity, value);
  try {
    sessionStorage.setItem(identity, JSON.stringify(value));
  } catch {
    /* Retain the in-memory fence. */
  }
}

export function clearSpeakingUpload(endpoint: string, promptId: string) {
  const identity = key(endpoint, promptId);
  fences.delete(identity);
  try {
    sessionStorage.removeItem(identity);
  } catch {
    /* The current view retains the acknowledged recording. */
  }
}

export async function recoverSpeakingUpload(
  endpoint: string,
  promptId: string
): Promise<SpeakingEvidence> {
  const fence = pendingSpeakingUpload(endpoint, promptId);
  const response = await fetch(endpoint.replace(/\/speaking$/, ''));
  if (!response.ok)
    throw new Error(
      'Saved recording could not be checked. Check again before recording another attempt.'
    );
  const parent = z
    .object({
      prompts: z.array(z.unknown()).optional(),
      speakingPrompts: z.array(z.unknown()).optional(),
      sections: z.array(z.object({ prompts: z.array(z.unknown()) })).optional(),
    })
    .parse(await response.json());
  const prompts = [
    ...(parent.prompts ?? []),
    ...(parent.speakingPrompts ?? []),
    ...(parent.sections?.flatMap((section) => section.prompts) ?? []),
  ];
  const prompt = prompts
    .map((item) =>
      z.object({ id: z.string(), latestRecording: z.unknown().optional() }).safeParse(item)
    )
    .find((item) => item.success && item.data.id === promptId);
  const value = prompt?.success ? prompt.data.latestRecording : null;
  const record = z
    .object({ id: z.string().optional(), recordingId: z.string().optional() })
    .passthrough()
    .safeParse(value);
  const evidence = speakingEvidenceSchema.safeParse(
    record.success
      ? { ...record.data, recordingId: record.data.recordingId ?? record.data.id }
      : null
  );
  if (!evidence.success || evidence.data.recordingId === fence?.baseline)
    throw new Error(
      'The upload outcome is still unknown. Check saved recording again before recording another attempt.'
    );
  clearSpeakingUpload(endpoint, promptId);
  return evidence.data;
}
