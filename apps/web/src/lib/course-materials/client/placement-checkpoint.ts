import { z } from 'zod';
import { restoreMaterialUploadClientState } from './uploads';
import { placementConfirmRequestSchema } from '@sotto/shared';
import type { MaterialPlacementCheckpoint } from './analysis';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z
  .object({
    clientId: z.uuid(),
    name: z.string(),
    size: z.number().int().nonnegative(),
    type: z.string(),
  })
  .strict();
const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileId: z.string().min(1),
    native: z.string().regex(/^[a-z]{2}$/),
    target: z.string().regex(/^[a-z]{2}$/),
    requestId: z.uuid(),
    contentSha256: hash,
    files: z.array(fileSchema).max(10),
    upload: z.unknown(),
    analysisId: z.uuid().nullable(),
    confirmation: z
      .object({ requestId: z.uuid(), body: z.string().max(8192) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type SavedMaterialPlacementCheckpoint = Omit<z.infer<typeof checkpointSchema>, 'upload'> & {
  upload: ReturnType<typeof restoreMaterialUploadClientState> | null;
};

function key(profileId: string, native: string, target: string) {
  return `sotto.material-placement.v1:${encodeURIComponent(profileId)}:${native}:${target}`;
}

export async function materialPlacementContentHash(content: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readSavedMaterialPlacement(
  profileId: string,
  native: string,
  target: string
): SavedMaterialPlacementCheckpoint | null {
  const serialized = window.localStorage.getItem(key(profileId, native, target));
  if (serialized === null) return null;
  if (serialized.length > 2 * 1024 * 1024)
    throw new Error('Saved source-analysis metadata exceeds its size limit.');
  const result = checkpointSchema.parse(JSON.parse(serialized));
  if (result.profileId !== profileId || result.native !== native || result.target !== target)
    throw new Error('The saved source analysis belongs to another learner or language pair.');
  if (result.confirmation) {
    const confirmation = placementConfirmRequestSchema.parse(JSON.parse(result.confirmation.body));
    if (
      confirmation.requestId !== result.confirmation.requestId ||
      confirmation.analysisId !== result.analysisId ||
      confirmation.native !== native ||
      confirmation.target !== target
    )
      throw new Error('The saved confirmation does not match its original source analysis.');
  }
  return {
    ...result,
    upload: result.upload === null ? null : restoreMaterialUploadClientState(result.upload),
  };
}

export function saveMaterialPlacement(state: MaterialPlacementCheckpoint, contentSha256: string) {
  const previous = readSavedMaterialPlacement(state.profileId, state.native, state.target);
  const value = checkpointSchema.parse({
    schemaVersion: 1,
    profileId: state.profileId,
    native: state.native,
    target: state.target,
    requestId: state.requestId,
    contentSha256,
    files: state.files,
    upload: state.upload,
    analysisId: state.analysisId,
    confirmation:
      previous?.analysisId === state.analysisId && previous?.requestId === state.requestId
        ? previous.confirmation
        : null,
  });
  window.localStorage.setItem(
    key(state.profileId, state.native, state.target),
    JSON.stringify(value)
  );
}

export function restoreMaterialPlacement(input: {
  profileId: string;
  native: string;
  target: string;
  content: string;
  contentSha256: string;
  files: readonly File[];
}): MaterialPlacementCheckpoint | null {
  const previous = readSavedMaterialPlacement(input.profileId, input.native, input.target);
  if (
    !previous ||
    previous.contentSha256 !== input.contentSha256 ||
    previous.files.length !== input.files.length ||
    previous.files.some(
      (file, index) =>
        file.name !== input.files[index].name ||
        file.size !== input.files[index].size ||
        file.type !== input.files[index].type
    )
  )
    return null;
  return {
    profileId: previous.profileId,
    native: previous.native,
    target: previous.target,
    requestId: previous.requestId,
    content: input.content,
    files: previous.files,
    upload: previous.upload,
    analysisId: previous.analysisId,
  };
}

export function saveMaterialPlacementRetry(
  profileId: string,
  native: string,
  target: string,
  parentId: string,
  analysisId: string
) {
  const previous = readSavedMaterialPlacement(profileId, native, target);
  if (!previous || previous.analysisId !== parentId)
    throw new Error('The source selection changed before its retry was opened.');
  const next = checkpointSchema.parse({ ...previous, analysisId, confirmation: null });
  window.localStorage.setItem(key(profileId, native, target), JSON.stringify(next));
}

export function forgetMaterialPlacement(profileId: string, native: string, target: string) {
  window.localStorage.removeItem(key(profileId, native, target));
}

export function saveMaterialPlacementConfirmation(
  profileId: string,
  native: string,
  target: string,
  body: string
) {
  const previous = readSavedMaterialPlacement(profileId, native, target);
  const confirmation = placementConfirmRequestSchema.parse(JSON.parse(body));
  if (
    !previous ||
    previous.analysisId !== confirmation.analysisId ||
    native !== confirmation.native ||
    target !== confirmation.target
  )
    throw new Error(
      'The confirmation no longer matches the saved learner, language pair and source analysis.'
    );
  const next = checkpointSchema.parse({
    ...previous,
    confirmation: { requestId: confirmation.requestId, body },
  });
  window.localStorage.setItem(key(profileId, native, target), JSON.stringify(next));
}
