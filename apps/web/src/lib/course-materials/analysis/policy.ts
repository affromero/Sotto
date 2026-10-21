import { z } from 'zod';
import { materialFocusSelectionSchema } from '@sotto/shared';
import {
  resolveCapturedLearningAi,
  captureLearningModerationCredential,
  type CapturedLearningAi,
} from '@/lib/learning-ai';
import { learningCredentialFingerprint } from '@/lib/classes/preparation-selection';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { formatAgentModelId } from '@/lib/agent-models/id';
import { materialRecognitionHash } from '../recognition/protocol';
import { MATERIAL_FOCUS_ANALYSIS_SYSTEM, MATERIAL_FOCUS_CHUNK_JSON_SCHEMA } from './protocol';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const materialAnalysisPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    analyzerVersion: z.literal('sotto-source-focus-1'),
    runtimeRevision: z.string().min(1).max(200),
    selection: materialFocusSelectionSchema,
    cliBinding: z
      .object({ kind: z.literal('LOCAL_ACCOUNT'), fingerprint: sha, revision: z.string().min(1) })
      .strict()
      .nullable(),
    maxOutputTokens: z.literal(16384),
  })
  .strict();
export type MaterialAnalysisPolicy = z.infer<typeof materialAnalysisPolicySchema>;

export function materialAnalysisRuntimeRevision() {
  const source = process.env.COMMIT_SHA;
  return source && /^[a-f0-9]{40,64}$/.test(source)
    ? source
    : `protocol-v1:${materialRecognitionHash({ system: MATERIAL_FOCUS_ANALYSIS_SYSTEM, schema: MATERIAL_FOCUS_CHUNK_JSON_SCHEMA })}`;
}

/** Capture configured text analysis independently of optional image recognition capabilities. */
export async function captureMaterialAnalysisPolicy(execution: SottoProviderExecution) {
  const ai = await resolveCapturedLearningAi(execution.userId, execution);
  if (ai.provider === 'claude-code' || ai.isolatedImage)
    throw new Error(
      'The configured backend does not support durable source analysis. Choose a supported HTTP model or a concrete local Codex model.'
    );
  let cliBinding: MaterialAnalysisPolicy['cliBinding'] = null;
  if (ai.provider === 'codex') {
    const binding = await captureCodexMaterialBinding(execution, { model: ai.model });
    if (formatAgentModelId('codex', binding.selection.model, binding.selection.effort) !== ai.model)
      throw new Error('Choose an explicit Codex model and effort before analyzing materials.');
    cliBinding = {
      kind: 'LOCAL_ACCOUNT',
      fingerprint: binding.fingerprint,
      revision: binding.selection.configurationSha256,
    };
  }
  const moderation = await captureLearningModerationCredential(ai.execution);
  const policy = materialAnalysisPolicySchema.parse({
    schemaVersion: 1,
    analyzerVersion: 'sotto-source-focus-1',
    runtimeRevision: materialAnalysisRuntimeRevision(),
    maxOutputTokens: 16384,
    cliBinding,
    selection: {
      provider: ai.provider,
      model: ai.model,
      ...(ai.endpoint ? { endpoint: ai.endpoint } : {}),
      credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
      moderationCredentialFingerprint: learningCredentialFingerprint(moderation),
    },
  });
  return { ai, policy };
}

export async function restoreMaterialAnalysisAi(
  policy: MaterialAnalysisPolicy,
  execution: SottoProviderExecution
): Promise<CapturedLearningAi> {
  if (policy.runtimeRevision !== materialAnalysisRuntimeRevision())
    throw new Error(
      'The admitted analysis runtime changed. Saved responses remain available for recovery.'
    );
  return resolveCapturedLearningAi(execution.userId, {
    ...execution,
    learningSelection: policy.selection,
  });
}
