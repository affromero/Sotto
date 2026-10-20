import { z } from 'zod';
import { restoreMaterialUploadClientState, type MaterialUploadClientState } from './uploads';

const namespace = 'sotto.material-upload.v1';
const envelope = z
  .object({
    schemaVersion: z.literal(1),
    profileId: z.string().min(1),
    scope: z.string().min(1),
    state: z.unknown(),
  })
  .strict();

function key(profileId: string, scope: string) {
  return `${namespace}:${encodeURIComponent(profileId)}:${encodeURIComponent(scope)}`;
}

/** Stores transfer metadata and checksums. Original file bytes stay in the selected File. */
export function saveBrowserUploadCheckpoint(
  profileId: string,
  scope: string,
  state: MaterialUploadClientState
) {
  if (state.expectedProfileId !== profileId)
    throw new Error('Saved upload progress belongs to another learner.');
  const serialized = JSON.stringify({
    schemaVersion: 1,
    profileId,
    scope,
    state,
  });
  try {
    window.localStorage.setItem(key(profileId, scope), serialized);
  } catch {
    throw new Error(
      'The browser could not save upload progress. Free some local storage before resuming.'
    );
  }
}

export function readBrowserUploadCheckpoint(profileId: string, scope: string) {
  const serialized = window.localStorage.getItem(key(profileId, scope));
  if (serialized === null) return null;
  if (serialized.length > 2 * 1024 * 1024)
    throw new Error('Saved upload progress exceeds its metadata limit.');
  const saved = envelope.parse(JSON.parse(serialized));
  if (saved.profileId !== profileId || saved.scope !== scope)
    throw new Error('Saved upload progress belongs to another learner or course.');
  const state = restoreMaterialUploadClientState(saved.state);
  if (state.expectedProfileId !== undefined && state.expectedProfileId !== profileId)
    throw new Error('Saved upload progress belongs to another learner.');
  return { ...state, expectedProfileId: profileId };
}

export function clearBrowserUploadCheckpoint(profileId: string, scope: string) {
  window.localStorage.removeItem(key(profileId, scope));
}
