import { z } from 'zod';
import {
  materialUploadBatchReceiptSchema,
  materialUploadBatchRequestSchema,
  materialUploadCompletionRequestSchema,
  materialUploadLimits,
  materialUploadPartHeaders,
  materialUploadPartMetadataSchema,
  materialUploadResumeSchema,
  type MaterialUploadBatchReceipt,
  type MaterialUploadPartMetadata,
  type MaterialUploadResume,
} from '@sotto/shared';
import {
  planMaterialUploadPart,
  planMaterialUploadParts,
  sameMaterialUploadPartIdentity,
  validateMaterialUploadCompletion,
} from '../uploads/protocol';

const endpoint = '/api/v1/materials/uploads';
const maximumParts =
  materialUploadLimits.maxFiles *
  Math.ceil(materialUploadLimits.maxFileBytes / materialUploadLimits.partBytes);
const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    request: materialUploadBatchRequestSchema,
    courseId: z.string().min(1).max(100).optional(),
    batch: materialUploadBatchReceiptSchema.nullable(),
    partIdentities: z
      .array(z.object({ clientId: z.uuid(), part: materialUploadPartMetadataSchema }).strict())
      .max(maximumParts),
    completions: z
      .array(
        z.object({ uploadId: z.uuid(), request: materialUploadCompletionRequestSchema }).strict()
      )
      .max(materialUploadLimits.maxFiles),
  })
  .strict();

export type MaterialUploadClientState = z.infer<typeof checkpointSchema>;
export interface MaterialUploadClientFile {
  clientId: string;
  file: File;
}
export interface MaterialUploadClientProgress {
  phase: 'ADMITTING' | 'VERIFYING' | 'UPLOADING' | 'FINALIZING' | 'POLLING' | 'COMPLETE';
  clientId: string | null;
  uploadId: string | null;
  materialId: string | null;
  fileBytes: number;
  fileVerifiedBytes: number;
  fileUploadedBytes: number;
  batchBytes: number;
  batchUploadedBytes: number;
}

export class MaterialUploadClientError extends Error {
  constructor(
    readonly code:
      'NETWORK' | 'HTTP' | 'PROTOCOL' | 'FILE_CHANGED' | 'STATE' | 'CANCELLED' | 'DEADLINE',
    message: string,
    readonly state: MaterialUploadClientState,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'MaterialUploadClientError';
  }
}

/** Caller owns profile-scoped checkpoint retention. This module persists nothing. */
export function createMaterialUploadClientState(
  files: readonly MaterialUploadClientFile[],
  options: { requestId?: string; courseId?: string } = {}
): MaterialUploadClientState {
  return checkpointSchema.parse({
    schemaVersion: 1,
    request: {
      schemaVersion: 1,
      requestId: options.requestId ?? crypto.randomUUID(),
      files: files.map(({ clientId, file }) => ({
        clientId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        byteSize: file.size,
      })),
    },
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
    batch: null,
    partIdentities: [],
    completions: [],
  });
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException('Upload cancelled.', 'AbortError'));
    if (signal.aborted) {
      promise.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One invocation makes no automatic network retries. Resume explicitly with the saved state. */
export async function uploadMaterialFiles(options: {
  files: readonly MaterialUploadClientFile[];
  state: MaterialUploadClientState;
  signal: AbortSignal;
  deadlineAt: number;
  pollIntervalMs?: number;
  fetch?: typeof fetch;
  onState?: (state: MaterialUploadClientState) => void;
  onProgress?: (progress: MaterialUploadClientProgress) => void;
}): Promise<MaterialUploadClientState & { batch: MaterialUploadBatchReceipt }> {
  const state = checkpointSchema.parse(options.state);
  const snapshot = () => structuredClone(state);
  function fail(
    code: MaterialUploadClientError['code'],
    message: string,
    status: number | null = null
  ): never {
    throw new MaterialUploadClientError(code, message, snapshot(), status);
  }
  const deadline = new AbortController();
  const duration = options.deadlineAt - Date.now();
  if (!Number.isFinite(duration) || duration > 2_147_483_647)
    fail('STATE', 'Provide a finite upload deadline within 24 days.');
  const timer = setTimeout(
    () => deadline.abort(new DOMException('Upload deadline exceeded.', 'TimeoutError')),
    Math.max(0, duration)
  );
  if (duration <= 0) deadline.abort(new DOMException('Upload deadline exceeded.', 'TimeoutError'));
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const pollInterval = options.pollIntervalMs ?? 1000;
  const request = options.fetch ?? fetch;
  let current: MaterialUploadResume | undefined;
  let verifiedBytes = 0;
  const save = () => {
    signal.throwIfAborted();
    options.onState?.(snapshot());
  };
  const progress = (phase: MaterialUploadClientProgress['phase']) => {
    signal.throwIfAborted();
    const uploaded = (upload: MaterialUploadResume) =>
      upload.original?.byteSize ?? upload.parts.reduce((total, part) => total + part.byteSize, 0);
    options.onProgress?.({
      phase,
      clientId: current?.file.clientId ?? null,
      uploadId: current?.uploadId ?? null,
      materialId: current?.materialId ?? null,
      fileBytes: current?.file.byteSize ?? 0,
      fileVerifiedBytes: verifiedBytes,
      fileUploadedBytes: current ? uploaded(current) : 0,
      batchBytes: state.request.files.reduce((total, file) => total + file.byteSize, 0),
      batchUploadedBytes:
        state.batch?.uploads.reduce((total, upload) => total + uploaded(upload), 0) ?? 0,
    });
  };
  const partKey = (clientId: string, index: number) => `${clientId}:${index}`;
  const identities = new Map(
    state.partIdentities.map((item) => [partKey(item.clientId, item.part.index), item.part])
  );
  const remember = (clientId: string, part: MaterialUploadPartMetadata) => {
    const key = partKey(clientId, part.index);
    const previous = identities.get(key);
    if (
      previous &&
      (previous.sha256 !== part.sha256 ||
        previous.offset !== part.offset ||
        previous.byteSize !== part.byteSize)
    )
      fail('FILE_CHANGED', 'A part no longer matches the saved upload identity.');
    if (!previous) {
      identities.set(key, { ...part });
      state.partIdentities.push({ clientId, part: { ...part } });
    }
  };
  const accept = (input: unknown, expected: MaterialUploadResume) => {
    const upload = materialUploadResumeSchema.parse(input);
    if (
      upload.uploadId !== expected.uploadId ||
      upload.materialId !== expected.materialId ||
      upload.batchId !== expected.batchId ||
      JSON.stringify(upload.file) !== JSON.stringify(expected.file) ||
      upload.revision < expected.revision
    )
      fail('PROTOCOL', 'The server returned a different or stale upload identity.');
    for (const part of upload.parts) {
      const planned = planMaterialUploadPart(upload.file.byteSize, part.index);
      if (part.offset !== planned.offset || part.byteSize !== planned.byteSize)
        fail('PROTOCOL', 'The server part receipt differs from the exact file plan.');
      remember(upload.file.clientId, {
        schemaVersion: 1,
        index: part.index,
        offset: part.offset,
        byteSize: part.byteSize,
        sha256: part.sha256,
      });
    }
    state.batch!.uploads = state.batch!.uploads.map((item) =>
      item.uploadId === upload.uploadId ? upload : item
    );
    current = upload;
    save();
    if (!['UPLOADING', 'FINALIZING', 'COMPLETE'].includes(upload.status))
      fail('STATE', `Material upload is ${upload.status.toLowerCase()}.`);
    return upload;
  };
  const json = async (url: string, init: RequestInit = {}) => {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await withSignal(
        request(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal }),
        signal
      );
    } catch (error) {
      signal.throwIfAborted();
      throw new MaterialUploadClientError(
        'NETWORK',
        'Material upload connection interrupted. Resume with the saved checkpoint.',
        snapshot(),
        null,
        { cause: error }
      );
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      fail('HTTP', `Material upload request failed (${response.status}).`, response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) fail('PROTOCOL', 'The server returned an empty upload response.');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const next = await withSignal(reader.read(), signal);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 256 * 1024)
          fail('PROTOCOL', 'The upload metadata response exceeds its byte limit.');
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return JSON.parse(text) as unknown;
  };
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(pollInterval) || pollInterval < 1 || pollInterval > 60_000)
      fail('STATE', 'Invalid upload poll interval.');
    if (
      new Set(state.partIdentities.map((item) => partKey(item.clientId, item.part.index))).size !==
        state.partIdentities.length ||
      new Set(state.completions.map((item) => item.uploadId)).size !== state.completions.length
    )
      fail('STATE', 'The checkpoint contains duplicate part or completion identities.');
    const files = new Map(options.files.map((item) => [item.clientId, item.file]));
    if (files.size !== options.files.length || files.size !== state.request.files.length)
      fail('STATE', 'Select exactly the files declared in this upload checkpoint.');
    for (const declaration of state.request.files) {
      const file = files.get(declaration.clientId);
      if (
        !file ||
        file.size !== declaration.byteSize ||
        file.name.trim() !== declaration.name ||
        (file.type || 'application/octet-stream') !== declaration.mimeType
      )
        fail('FILE_CHANGED', 'A selected file differs from its declared metadata.');
    }
    for (const identity of state.partIdentities) {
      const declaration = state.request.files.find((item) => item.clientId === identity.clientId);
      if (!declaration) fail('STATE', 'A saved part belongs to an undeclared file.');
      const planned = planMaterialUploadPart(declaration.byteSize, identity.part.index);
      if (planned.offset !== identity.part.offset || planned.byteSize !== identity.part.byteSize)
        fail('STATE', 'A saved part differs from its declared file plan.');
    }
    save();
    const validateBatch = (batch: MaterialUploadBatchReceipt) => {
      if (
        batch.requestId !== state.request.requestId ||
        batch.uploads.length !== state.request.files.length ||
        state.request.files.some(
          (declaration) =>
            !batch.uploads.some(
              (upload) => JSON.stringify(upload.file) === JSON.stringify(declaration)
            )
        )
      )
        fail(
          'PROTOCOL',
          'The server batch does not match the declared files and request identity.'
        );
    };
    if (!state.batch) {
      if (state.completions.length > 0)
        fail('STATE', 'Completion identities require an admitted batch checkpoint.');
      progress('ADMITTING');
      const batch = materialUploadBatchReceiptSchema.parse(
        await json(
          endpoint + (state.courseId ? `?courseId=${encodeURIComponent(state.courseId)}` : ''),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.request),
          }
        )
      );
      validateBatch(batch);
      state.batch = batch;
    }
    validateBatch(state.batch);
    if (
      state.completions.some(
        (completion) =>
          !state.batch!.uploads.some((upload) => upload.uploadId === completion.uploadId)
      )
    )
      fail('STATE', 'A saved completion belongs to another upload batch.');
    save();
    for (const initial of [...state.batch.uploads]) {
      verifiedBytes = 0;
      for (const part of initial.parts)
        remember(initial.file.clientId, {
          schemaVersion: 1,
          index: part.index,
          offset: part.offset,
          byteSize: part.byteSize,
          sha256: part.sha256,
        });
      let upload = accept(await json(`${endpoint}/${initial.uploadId}`), initial);
      if (!['UPLOADING', 'FINALIZING', 'COMPLETE'].includes(upload.status))
        fail('STATE', `Material upload is ${upload.status.toLowerCase()}.`);
      for (const planned of planMaterialUploadParts(upload.file.byteSize)) {
        const known = identities.get(partKey(upload.file.clientId, planned.index));
        if (upload.status === 'COMPLETE' && !known)
          fail(
            'STATE',
            'Completed upload parts were cleaned up and no saved checksum can verify this local file.'
          );
        progress('VERIFYING');
        const data = await withSignal(
          files
            .get(upload.file.clientId)!
            .slice(planned.offset, planned.offset + planned.byteSize)
            .arrayBuffer(),
          signal
        );
        if (data.byteLength !== planned.byteSize)
          fail('FILE_CHANGED', 'A selected file returned an incomplete part.');
        const digest = await withSignal(crypto.subtle.digest('SHA-256', data), signal);
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('');
        const part = { schemaVersion: 1 as const, ...planned, sha256 };
        remember(upload.file.clientId, part);
        verifiedBytes += data.byteLength;
        save();
        const receipt = upload.parts.find((item) => item.index === part.index);
        if (
          receipt &&
          !sameMaterialUploadPartIdentity(receipt, { ...part, uploadId: upload.uploadId })
        )
          fail(
            'FILE_CHANGED',
            'The selected file checksum differs from its committed server part.'
          );
        if (receipt || upload.status === 'COMPLETE') {
          progress('VERIFYING');
          continue;
        }
        if (upload.status !== 'UPLOADING')
          fail('PROTOCOL', 'A finalizing upload is missing a committed part.');
        progress('UPLOADING');
        upload = accept(
          await json(`${endpoint}/${upload.uploadId}/parts/${part.index}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              [materialUploadPartHeaders.offset]: String(part.offset),
              [materialUploadPartHeaders.byteSize]: String(part.byteSize),
              [materialUploadPartHeaders.sha256]: part.sha256,
            },
            body: data,
          }),
          upload
        );
        const committed = upload.parts.find((item) => item.index === part.index);
        if (
          !committed ||
          !sameMaterialUploadPartIdentity(committed, { ...part, uploadId: upload.uploadId })
        )
          fail('PROTOCOL', 'The server did not acknowledge this exact committed part.');
        progress('UPLOADING');
      }
      if (upload.status === 'UPLOADING') {
        validateMaterialUploadCompletion(upload.uploadId, upload.file.byteSize, upload.parts);
        let completion = state.completions.find((item) => item.uploadId === upload.uploadId);
        if (completion && completion.request.expectedRevision !== upload.revision)
          fail(
            'STATE',
            'The upload revision changed after the saved completion request. Reconcile the checkpoint.'
          );
        if (!completion) {
          completion = {
            uploadId: upload.uploadId,
            request: {
              schemaVersion: 1,
              requestId: crypto.randomUUID(),
              expectedRevision: upload.revision,
            },
          };
          state.completions.push(completion);
        }
        save();
        progress('FINALIZING');
        upload = accept(
          await json(`${endpoint}/${upload.uploadId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(completion.request),
          }),
          upload
        );
        if (!['FINALIZING', 'COMPLETE'].includes(upload.status))
          fail('PROTOCOL', 'Completion did not enter finalization or publish an original.');
      }
      while (upload.status === 'FINALIZING') {
        progress('POLLING');
        await wait(pollInterval, signal);
        upload = accept(await json(`${endpoint}/${upload.uploadId}`), upload);
        if (!['FINALIZING', 'COMPLETE'].includes(upload.status))
          fail('STATE', `Material finalization is ${upload.status.toLowerCase()}.`);
      }
      if (upload.status !== 'COMPLETE')
        fail('STATE', 'Material upload did not publish an original receipt.');
      progress('COMPLETE');
    }
    return { ...snapshot(), batch: structuredClone(state.batch) };
  } catch (error) {
    if (signal.aborted)
      throw new MaterialUploadClientError(
        options.signal.aborted ? 'CANCELLED' : 'DEADLINE',
        options.signal.aborted
          ? 'Material upload cancelled. Resume with the saved checkpoint.'
          : 'Material upload deadline exceeded. Resume with the saved checkpoint.',
        snapshot(),
        null,
        { cause: signal.reason }
      );
    if (error instanceof MaterialUploadClientError) throw error;
    throw new MaterialUploadClientError(
      'PROTOCOL',
      'Material upload response or checkpoint could not be verified.',
      snapshot(),
      null,
      { cause: error }
    );
  } finally {
    clearTimeout(timer);
  }
}
