import { z } from 'zod';
import {
  createMaterialUploadClientState,
  uploadMaterialFiles,
  type MaterialUploadClientProgress,
} from './uploads';
import {
  readBrowserUploadCheckpoint,
  saveBrowserUploadCheckpoint,
  clearBrowserUploadCheckpoint,
} from './browser-checkpoint';

/** Transfer only bounded chunks. A reselected original resumes its exact profile-scoped receipt. */
export async function uploadBrowserMaterialFiles(input: {
  files: readonly File[];
  scope: string;
  signal: AbortSignal;
  onProgress?: (value: MaterialUploadClientProgress) => void;
}) {
  const response = await fetch('/api/v1/users/me', {
    signal: input.signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Sign in to the learner profile before uploading.');
  const profile = z.object({ id: z.string().min(1) }).parse(await response.json());
  input.signal.throwIfAborted();
  const previous = readBrowserUploadCheckpoint(profile.id, input.scope);
  if (previous?.courseId) throw new Error('This upload checkpoint belongs to a course attachment.');
  if (
    previous &&
    (previous.request.files.length !== input.files.length ||
      previous.request.files.some(
        (file, index) =>
          file.name !== input.files[index].name.trim() ||
          file.byteSize !== input.files[index].size ||
          file.mimeType !== (input.files[index].type || 'application/octet-stream')
      ))
  )
    throw new Error(
      'Reselect the same original files in the same order to resume the saved upload.'
    );
  const state =
    previous ??
    createMaterialUploadClientState(
      input.files.map((file) => ({ clientId: crypto.randomUUID(), file })),
      { expectedProfileId: profile.id }
    );
  saveBrowserUploadCheckpoint(profile.id, input.scope, state);
  const uploaded = await uploadMaterialFiles({
    files: input.files.map((file, index) => ({
      clientId: state.request.files[index].clientId,
      file,
    })),
    state,
    signal: input.signal,
    deadlineAt: Date.now() + 7_200_000,
    onState: (value) => {
      input.signal.throwIfAborted();
      saveBrowserUploadCheckpoint(profile.id, input.scope, value);
    },
    onProgress: input.onProgress,
  });
  input.signal.throwIfAborted();
  clearBrowserUploadCheckpoint(profile.id, input.scope);
  return uploaded.batch.uploads.map((upload) => ({
    id: upload.materialId,
    name: upload.file.name,
  }));
}
