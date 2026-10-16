import { captureTeachingFailure } from '@/lib/classes/quality/teaching-failure';
import { parseTeachingCriticResponse } from '@/lib/classes/quality/teaching-review-protocol';
import { captureReviewerProtocolEvidence } from '@/lib/classes/quality/private-protocol-evidence';
import type { GenerationFailure } from '@/lib/classes/quality/generation-failure';

/** Synthetic lesson evidence also contains the word teaching inside immutable payload strings. */
export function lessonFailureFixture() {
  const candidate = [{ kind: 'teaching', explanation: 'Synthetic teaching rule.' }];
  const teachingFailure = captureTeachingFailure('teaching', candidate, {
    items: [
      { index: 0, acceptable: false, issues: ['incorrect'], feedback: ['Wrong teaching rule.'] },
    ],
  });
  let rejected: unknown;
  try {
    parseTeachingCriticResponse('invalid teaching JSON', candidate);
  } catch (error) {
    rejected = error;
  }
  const protocol = captureReviewerProtocolEvidence(rejected, {
    kind: 'teaching',
    role: 'critic',
    offset: 0,
    candidate,
    response: 'invalid teaching JSON',
  });
  if (!protocol) throw new Error('Expected authentic synthetic protocol evidence');
  const detail: Omit<GenerationFailure, 'stages'> = {
    category: 'teaching_rejected',
    teachingFailure,
    attemptFailures: [{ attempt: 1, type: 'teaching', failure: teachingFailure }],
    protocolEvidence: [protocol],
  };
  const failure: GenerationFailure = { ...detail, stages: [{ stage: 'grammar', ...detail }] };
  return { failure, protocol };
}
