import { z } from 'zod';
import { speakingEvidenceSchema, type SpeakingEvidence } from '@sotto/shared';
import type { ClassProgressBinding } from '../progress/useLearningProgress';

const fenceSchema = z.object({
  nonce: z.string().uuid().optional(),
  baseline: z.string().nullable(),
  binding: z
    .object({
      expectedAttempt: z.number().int().positive().safe(),
      taskMaterialRevision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  acknowledgedRecordingId: z.string().min(1).optional(),
});
const fences = new Map<string, z.infer<typeof fenceSchema>>();
const key = (endpoint: string, promptId: string) => `speaking-upload:${endpoint}/${promptId}`;

export function downloadSpeakingRecording(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = blob.type.startsWith('audio/mp4')
    ? 'speaking-recording.m4a'
    : 'speaking-recording.webm';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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

export function retainSpeakingUpload(
  endpoint: string,
  promptId: string,
  baseline: string | null,
  binding?: ClassProgressBinding
) {
  const identity = key(endpoint, promptId);
  if (fences.has(identity) || sessionStorage.getItem(identity) !== null)
    throw new Error('An earlier upload must be resolved before another recording is sent.');
  const value = {
    nonce: crypto.randomUUID(),
    baseline,
    ...(binding ? { binding: { ...binding } } : {}),
  };
  sessionStorage.setItem(identity, JSON.stringify(value));
  fences.set(identity, value);
  return value;
}

export function clearSpeakingUpload(
  endpoint: string,
  promptId: string,
  expected: z.infer<typeof fenceSchema>
) {
  const identity = key(endpoint, promptId);
  if (pendingSpeakingUpload(endpoint, promptId) !== expected) return false;
  sessionStorage.removeItem(identity);
  fences.delete(identity);
  return true;
}

export function rememberSpeakingUploadReceipt(
  endpoint: string,
  promptId: string,
  recordingId: string,
  expected: z.infer<typeof fenceSchema>
) {
  const identity = key(endpoint, promptId);
  const previous = pendingSpeakingUpload(endpoint, promptId);
  if (!previous || previous !== expected || !recordingId)
    throw new Error('The recording recovery identity is unavailable.');
  const value = { ...previous, acknowledgedRecordingId: recordingId };
  fences.set(identity, value);
  try {
    sessionStorage.setItem(identity, JSON.stringify(value));
    return { fence: value, persisted: true };
  } catch {
    return { fence: value, persisted: false };
  }
}

export async function readSpeakingUploadRecovery(
  endpoint: string,
  promptId: string,
  authority?: { classId: string; binding: ClassProgressBinding; isCurrent: () => boolean }
): Promise<{ evidence: SpeakingEvidence; commit: () => void }> {
  const fence = pendingSpeakingUpload(endpoint, promptId);
  if (
    authority &&
    (!fence?.binding ||
      fence.binding.expectedAttempt !== authority.binding.expectedAttempt ||
      fence.binding.taskMaterialRevision !== authority.binding.taskMaterialRevision ||
      !authority.isCurrent())
  )
    throw new Error(
      'The recording belongs to unverified class material. Check the class before continuing.'
    );
  const response = await fetch(endpoint.replace(/\/speaking$/, ''));
  if (!response.ok)
    throw new Error(
      'Saved recording could not be checked. Check again before recording another attempt.'
    );
  const parent = z
    .object({
      id: z.string().optional(),
      attempt: z.number().int().positive().optional(),
      taskMaterialRevision: z.string().optional(),
      prompts: z.array(z.unknown()).optional(),
      speakingPrompts: z.array(z.unknown()).optional(),
      sections: z.array(z.object({ prompts: z.array(z.unknown()) })).optional(),
    })
    .parse(await response.json());
  if (
    authority &&
    (!authority.isCurrent() ||
      pendingSpeakingUpload(endpoint, promptId) !== fence ||
      parent.id !== authority.classId ||
      parent.attempt !== authority.binding.expectedAttempt ||
      parent.taskMaterialRevision !== authority.binding.taskMaterialRevision)
  )
    throw new Error(
      'The class changed while checking this recording. Check the class before continuing.'
    );
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
  if (!fence?.acknowledgedRecordingId)
    throw new Error(
      'The upload outcome is still unknown and cannot be confirmed automatically. Keep your recording before leaving.'
    );
  if (
    !evidence.success ||
    evidence.data.recordingId === fence.baseline ||
    evidence.data.recordingId !== fence.acknowledgedRecordingId ||
    (record.success &&
      record.data.id &&
      record.data.recordingId &&
      record.data.id !== record.data.recordingId)
  )
    throw new Error(
      'The upload outcome is still unknown. Check saved recording again before recording another attempt.'
    );
  return {
    evidence: evidence.data,
    commit: () => {
      if (
        pendingSpeakingUpload(endpoint, promptId) !== fence ||
        (authority && !authority.isCurrent())
      )
        throw new Error('The recording check changed. Check saved recording again.');
      if (!clearSpeakingUpload(endpoint, promptId, fence))
        throw new Error('The recording check changed. Check saved recording again.');
    },
  };
}

export async function recoverSpeakingUpload(
  endpoint: string,
  promptId: string
): Promise<SpeakingEvidence> {
  const candidate = await readSpeakingUploadRecovery(endpoint, promptId);
  candidate.commit();
  return candidate.evidence;
}
