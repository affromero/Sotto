import { captureMaterialAnalysisPolicy } from '@/lib/course-materials/analysis/policy';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';

/** Capture the selected provider and, for local Codex, its account and configuration. */
export async function captureAssessmentProviderPolicy(execution: SottoProviderExecution) {
  const { policy } = await captureMaterialAnalysisPolicy(execution);
  return {
    selection: {
      ...policy.selection,
      moderationCredentialFingerprint: policy.selection.moderationCredentialFingerprint ?? null,
    },
    cliBinding: policy.cliBinding,
  };
}
