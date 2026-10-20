import { z } from 'zod';
import {
  learningLevelSchema,
  materialFocusAnalysisCoverageSchema,
  materialFocusAnalysisRetryRequestSchema,
  materialFocusAnalysisRetryResponseSchema,
  placementConfirmRequestSchema,
} from '@sotto/shared';
import {
  createMaterialUploadClientState,
  uploadMaterialFiles,
  type MaterialUploadClientState,
} from './uploads';
import {
  materialPlacementContentHash,
  readSavedMaterialPlacement,
  restoreMaterialPlacement,
  saveMaterialPlacement,
  forgetMaterialPlacement,
  type SavedMaterialPlacementCheckpoint,
} from './placement-checkpoint';

const inferenceSchema = z.object({
  level: learningLevelSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export const materialAnalysisProjectionSchema = z.object({
  analysisId: z.uuid(),
  analysisRevision: z.number().int().positive(),
  status: z.string(),
  retryOfAnalysisId: z.uuid().nullable().optional(),
  counts: materialFocusAnalysisRetryResponseSchema.shape.counts.nullable().optional(),
  identityDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  resultDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  failureReason: z.string().nullable().optional(),
  stale: z.boolean().optional(),
  coverage: materialFocusAnalysisCoverageSchema.nullable().optional(),
  summary: z
    .object({ focusCount: z.number().int().nonnegative(), inference: inferenceSchema.nullable() })
    .nullable()
    .optional(),
  sources: z
    .array(
      z.object({
        sourceId: z.string(),
        name: z.string(),
        materialId: z.string().nullable().optional(),
      })
    )
    .optional(),
});
export type MaterialAnalysisProjection = z.infer<typeof materialAnalysisProjectionSchema>;
export interface MaterialPlacementCheckpoint {
  profileId: string;
  native: string;
  target: string;
  content: string;
  requestId: string;
  files: Array<{ clientId: string; name: string; size: number; type: string }>;
  upload: MaterialUploadClientState | null;
  analysisId: string | null;
}
export interface MaterialPlacementReference {
  analysisId: string;
  analysisRevision: number;
  resultDigest: string;
  acceptPartial: boolean;
}
export const materialPlacementChoiceSchema = z
  .object({
    native: z.string().regex(/^[a-z]{2}$/),
    target: z.string().regex(/^[a-z]{2}$/),
    requestId: z.uuid(),
    level: learningLevelSchema,
    reference: z
      .object({
        analysisId: z.uuid(),
        analysisRevision: z.number().int().positive(),
        resultDigest: z.string().regex(/^[a-f0-9]{64}$/),
        acceptPartial: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type MaterialPlacementChoice = z.infer<typeof materialPlacementChoiceSchema>;

export function onboardingPlacementAnalysis(
  choice: MaterialPlacementChoice | undefined,
  course: unknown
) {
  const selected = z
    .object({ native: z.string(), target: z.string(), level: learningLevelSchema })
    .safeParse(course);
  if (
    !choice ||
    !selected.success ||
    choice.native !== selected.data.native ||
    choice.target !== selected.data.target ||
    choice.level !== selected.data.level
  )
    return undefined;
  return placementConfirmRequestSchema.parse({
    schemaVersion: 1,
    requestId: choice.requestId,
    native: choice.native,
    target: choice.target,
    ...choice.reference,
  });
}

export class MaterialAnalysisProcessingError extends Error {
  constructor(readonly analysis: MaterialAnalysisProjection) {
    super(
      analysis.failureReason ??
        'The analysis stopped. Review its processing status before continuing.'
    );
    this.name = 'MaterialAnalysisProcessingError';
  }
}

async function json(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : 'The material request failed.');
  }
  return body;
}
async function wait(signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1_000);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Only an explicit learner action creates a new attempt. Preserve requestId across network retries. */
export async function retryMaterialAnalysisRequest(input: {
  analysis: MaterialAnalysisProjection;
  requestId: string;
  signal: AbortSignal;
}) {
  if (input.analysis.identityDigest === undefined)
    throw new Error('Reload the analysis receipt before retrying.');
  const body = materialFocusAnalysisRetryRequestSchema.parse({
    schemaVersion: 1,
    requestId: input.requestId,
    analysisRevision: input.analysis.analysisRevision,
    identityDigest: input.analysis.identityDigest,
    resultDigest: input.analysis.resultDigest,
  });
  return materialFocusAnalysisRetryResponseSchema.parse(
    await json(
      await fetch(`/api/v1/material-analyses/${input.analysis.analysisId}/retry`, {
        method: 'POST',
        signal: input.signal,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  );
}

/** A checkpoint belongs to one profile and exact selected files. Retrying preserves its admission IDs. */
export async function analyzePlacementMaterials(input: {
  native: string;
  target: string;
  content: string;
  files: readonly File[];
  signal: AbortSignal;
  checkpoint?: MaterialPlacementCheckpoint | null;
  onCheckpoint: (value: MaterialPlacementCheckpoint) => void;
  onProgress?: (value: string) => void;
  onProjection?: (value: MaterialAnalysisProjection) => void;
}): Promise<MaterialAnalysisProjection> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(7_200_000)]);
  const profile = z.object({ id: z.string().min(1) }).parse(
    await json(
      await fetch('/api/v1/users/me', {
        signal,
        cache: 'no-store',
        ...(input.checkpoint
          ? { headers: { 'x-sotto-expected-profile-id': input.checkpoint.profileId } }
          : {}),
      })
    )
  );
  const contentSha256 = await materialPlacementContentHash(input.content);
  signal.throwIfAborted();
  let state =
    input.checkpoint ??
    restoreMaterialPlacement({
      profileId: profile.id,
      native: input.native,
      target: input.target,
      content: input.content,
      contentSha256,
      files: input.files,
    });
  if (state && state.profileId !== profile.id)
    throw new Error('The active profile changed. Select your materials again.');
  if (
    state &&
    (state.native !== input.native ||
      state.target !== input.target ||
      state.content !== input.content ||
      state.files.length !== input.files.length ||
      state.files.some(
        (file, index) =>
          file.name !== input.files[index].name ||
          file.size !== input.files[index].size ||
          file.type !== input.files[index].type
      ))
  )
    throw new Error('The source selection changed. Start a new analysis for these materials.');
  state ??= {
    profileId: profile.id,
    native: input.native,
    target: input.target,
    content: input.content,
    requestId: crypto.randomUUID(),
    files: input.files.map((file) => ({
      clientId: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type,
    })),
    upload: null,
    analysisId: null,
  };
  const saved = state;
  const checkpoint = () => {
    signal.throwIfAborted();
    saveMaterialPlacement(saved, contentSha256);
    input.onCheckpoint(structuredClone(saved));
  };
  checkpoint();
  let materialIds: string[] = [];
  if (input.files.length) {
    const files = input.files.map((file, index) => ({
      clientId: saved.files[index].clientId,
      file,
    }));
    saved.upload ??= createMaterialUploadClientState(files, { expectedProfileId: saved.profileId });
    if (
      saved.upload.expectedProfileId !== undefined &&
      saved.upload.expectedProfileId !== saved.profileId
    )
      throw new Error('The upload checkpoint belongs to another captured profile.');
    saved.upload.expectedProfileId = saved.profileId;
    checkpoint();
    const uploaded = await uploadMaterialFiles({
      files,
      state: saved.upload,
      signal,
      deadlineAt: Date.now() + 7_200_000,
      onState: (value) => {
        saved.upload = value;
        checkpoint();
      },
      onProgress: (value) =>
        input.onProgress?.(
          `${value.phase.toLowerCase()}: ${Math.round(value.batchUploadedBytes / 1_048_576)} MiB uploaded`
        ),
    });
    saved.upload = uploaded;
    checkpoint();
    materialIds = uploaded.batch.uploads.map((upload) => {
      if (!upload.materialId)
        throw new Error('A retained material is missing its original receipt.');
      return upload.materialId;
    });
  }
  if (!saved.analysisId) {
    const current = z.object({ id: z.string().min(1) }).parse(
      await json(
        await fetch('/api/v1/users/me', {
          signal,
          cache: 'no-store',
          headers: { 'x-sotto-expected-profile-id': saved.profileId },
        })
      )
    );
    if (current.id !== saved.profileId)
      throw new Error('The active profile changed before analysis. Select your materials again.');
    const admitted = materialAnalysisProjectionSchema.parse(
      await json(
        await fetch('/api/v1/placement/from-notes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sotto-expected-profile-id': saved.profileId,
          },
          signal,
          body: JSON.stringify({
            schemaVersion: 1,
            requestId: saved.requestId,
            native: saved.native,
            target: saved.target,
            content: saved.content,
            materialIds,
          }),
        })
      )
    );
    saved.analysisId = admitted.analysisId;
    checkpoint();
  }
  return pollMaterialAnalysis({
    analysisId: saved.analysisId,
    profileId: saved.profileId,
    native: input.native,
    target: input.target,
    signal,
    onProjection: input.onProjection,
    onProgress: input.onProgress,
  });
}

export async function openSavedMaterialAnalysis(input: {
  native: string;
  target: string;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  onProjection?: (value: MaterialAnalysisProjection) => void;
  onSaved: (checkpoint: SavedMaterialPlacementCheckpoint) => void;
}) {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(7_200_000)]);
  const profile = z
    .object({ id: z.string().min(1) })
    .parse(await json(await fetch('/api/v1/users/me', { signal, cache: 'no-store' })));
  signal.throwIfAborted();
  const saved = readSavedMaterialPlacement(profile.id, input.native, input.target);
  if (!saved?.analysisId)
    throw new Error(
      saved
        ? 'Select the same original files and paste the original text to resume the saved admission.'
        : 'No saved source analysis is available for this learner and language pair.'
    );
  input.onSaved(saved);
  return pollMaterialAnalysis({
    ...input,
    analysisId: saved.analysisId,
    profileId: profile.id,
    signal,
  });
}

async function pollMaterialAnalysis(input: {
  analysisId: string;
  profileId: string;
  native: string;
  target: string;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
  onProjection?: (value: MaterialAnalysisProjection) => void;
}) {
  const { signal } = input;
  while (true) {
    signal.throwIfAborted();
    input.onProgress?.('Reading the saved analysis status');
    const result = materialAnalysisProjectionSchema
      .extend({ native: z.string(), target: z.string() })
      .parse(
        await json(
          await fetch(`/api/v1/material-analyses/${input.analysisId}`, {
            signal,
            cache: 'no-store',
            headers: { 'x-sotto-expected-profile-id': input.profileId },
          })
        )
      );
    signal.throwIfAborted();
    if (
      result.analysisId !== input.analysisId ||
      result.native !== input.native ||
      result.target !== input.target
    )
      throw new Error(
        'The saved source analysis does not match this learner language pair and receipt.'
      );
    input.onProjection?.(result);
    input.onProgress?.(
      result.status === 'WAITING_SOURCE'
        ? 'Processing every source page'
        : 'Finding source classes and focuses'
    );
    if (result.stale)
      throw new Error('A source changed. Analyze its current revision before continuing.');
    if (['COMPLETE', 'PARTIAL', 'INSUFFICIENT_SOURCE'].includes(result.status)) return result;
    if (['FAILED', 'RECOVERY_REQUIRED', 'CANCELLED', 'SUPERSEDED'].includes(result.status))
      throw new MaterialAnalysisProcessingError(result);
    await wait(signal);
  }
}

export async function forgetSavedMaterialAnalysis(
  native: string,
  target: string,
  signal: AbortSignal
) {
  const profile = z
    .object({ id: z.string().min(1) })
    .parse(await json(await fetch('/api/v1/users/me', { signal, cache: 'no-store' })));
  signal.throwIfAborted();
  forgetMaterialPlacement(profile.id, native, target);
}

export function materialPlacementReference(
  result: MaterialAnalysisProjection,
  acceptPartial: boolean
): MaterialPlacementReference {
  if (!result.resultDigest || !['COMPLETE', 'PARTIAL'].includes(result.status))
    throw new Error('The source analysis has no usable completed receipt.');
  if (result.status === 'PARTIAL' && !acceptPartial)
    throw new Error('Review and accept the unresolved source coverage before continuing.');
  if (result.status === 'PARTIAL' && !result.coverage)
    throw new Error('Refresh the source coverage report before accepting a partial estimate.');
  return {
    analysisId: result.analysisId,
    analysisRevision: result.analysisRevision,
    resultDigest: result.resultDigest,
    acceptPartial,
  };
}
