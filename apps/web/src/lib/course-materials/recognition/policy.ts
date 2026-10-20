import { z } from 'zod';
import { MaterialRecognitionRequestError } from './errors';
import { resolveCapturedLearningAi, type CapturedLearningAi } from '@/lib/learning-ai';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import { formatAgentModelId } from '@/lib/agent-models/id';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { findMaterialRecognitionCapability } from './capabilities';
import {
  materialRecognitionCapabilitySchema,
  materialRecognitionSelection,
  materialRecognitionSelectionSchema,
  materialRecognitionHash,
  MATERIAL_TRANSCRIPTION_JSON_SCHEMA,
  MATERIAL_RECOGNITION_SYSTEM,
} from './protocol';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const materialEmbeddedOnlyPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    method: z.literal('EXPLICIT_CONFIGURATION_REQUIRED'),
  })
  .strict();
export const materialRecognitionPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    method: z.literal('CONFIGURED_REVIEWED_VISION'),
    capability: materialRecognitionCapabilitySchema,
    selection: materialRecognitionSelectionSchema,
    cliBinding: z
      .object({
        kind: z.literal('LOCAL_ACCOUNT'),
        fingerprint: sha,
        revision: z.string().min(1).max(200),
      })
      .strict()
      .nullable(),
    runtimeRevision: z.string().min(1).max(200),
    renderScale: z.number().int().min(1).max(4),
  })
  .strict();
export type MaterialRecognitionPolicy = z.infer<typeof materialRecognitionPolicySchema>;

function materialRecognitionRuntimeRevision() {
  const source = process.env.COMMIT_SHA;
  return source && /^[a-f0-9]{40,64}$/.test(source)
    ? source
    : `protocol-v1:${materialRecognitionHash({ system: MATERIAL_RECOGNITION_SYSTEM, schema: MATERIAL_TRANSCRIPTION_JSON_SCHEMA })}`;
}

/** Configuration reads capture a choice. Only the explicit recognition request authorizes page calls. */
export async function captureMaterialRecognitionPolicy(execution: SottoProviderExecution) {
  const ai = await resolveCapturedLearningAi(execution.userId, execution);
  if (ai.provider === 'claude-code' || ai.isolatedImage)
    throw new MaterialRecognitionRequestError(
      400,
      'The configured AI backend does not support this page recognition workflow.'
    );
  let cliBinding: MaterialRecognitionPolicy['cliBinding'] = null;
  if (ai.provider === 'codex') {
    const captured = await captureCodexMaterialBinding(execution, { model: ai.model });
    if (
      formatAgentModelId('codex', captured.selection.model, captured.selection.effort) !== ai.model
    )
      throw new MaterialRecognitionRequestError(
        400,
        'Choose an explicit Codex model and effort before recognizing handwriting.'
      );
    cliBinding = {
      kind: 'LOCAL_ACCOUNT',
      fingerprint: captured.fingerprint,
      revision: captured.selection.configurationSha256,
    };
  }
  const reviewed = await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await execution.authorize(database);
      return findMaterialRecognitionCapability(database, {
        provider: ai.provider,
        model: ai.model,
        endpoint: ai.endpoint ?? null,
      });
    },
    { signal: execution.signal }
  );
  if (!reviewed)
    throw new MaterialRecognitionRequestError(
      400,
      'The configured model needs an operator review of image and handwriting support.'
    );
  const capability = materialRecognitionCapabilitySchema.parse(reviewed.capability);
  const renderScale = Math.ceil(capability.minimumDpi / 72);
  if (renderScale > 4)
    throw new MaterialRecognitionRequestError(
      400,
      'The reviewed recognition resolution exceeds this renderer’s supported limit.'
    );
  const policy = materialRecognitionPolicySchema.parse({
    schemaVersion: 1,
    method: 'CONFIGURED_REVIEWED_VISION',
    capability,
    selection: materialRecognitionSelection(ai, capability),
    cliBinding,
    runtimeRevision: materialRecognitionRuntimeRevision(),
    renderScale,
  });
  return { ai, policy };
}

export async function restoreMaterialRecognitionAi(
  policy: MaterialRecognitionPolicy,
  execution: SottoProviderExecution
): Promise<CapturedLearningAi> {
  if (policy.runtimeRevision !== materialRecognitionRuntimeRevision())
    throw new Error(
      'The admitted recognition runtime changed. Saved responses remain available for recovery.'
    );
  const ai = await resolveCapturedLearningAi(execution.userId, {
    ...execution,
    learningSelection: {
      provider: policy.selection.provider,
      model: policy.selection.model,
      ...(policy.selection.endpoint ? { endpoint: policy.selection.endpoint } : {}),
      credentialFingerprint: policy.selection.credentialFingerprint,
    },
  });
  if (
    materialRecognitionHash(materialRecognitionSelection(ai, policy.capability)) !==
    materialRecognitionHash(policy.selection)
  )
    throw new Error('The admitted model or credential changed.');
  return ai;
}
