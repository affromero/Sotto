// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aiEvaluateWithDomainContext } from '@/lib/reference-verification/ai-layer';
import { groundFailedReferences } from '@/lib/reference-verification/grounding';
import type { ReferenceInput, VerificationCheck } from '@/lib/reference-validator';

const reference: ReferenceInput = {
  id: 'ref-1',
  number: 1,
  title: 'A real source title',
  authors: ['A. Researcher'],
  year: 2025,
  url: 'https://example.com/source',
  doi: null,
  type: 'article',
};

const claimContext = {
  sentences: ['A cited claim appears here.'],
  speakerTurns: ['HOST'],
};

const failedCheck: VerificationCheck = {
  layer: 'url',
  passed: false,
  confidence: 0,
  detail: 'URL failed',
};

describe('reference verification AI routing', () => {
  it('requires an explicit AI provider and model for reference evaluation', async () => {
    await expect(
      aiEvaluateWithDomainContext(
        [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
        'Source evaluation topic'
      )
    ).rejects.toThrow('AI provider and model are required for reference verification.');
  });

  it('requires an explicit AI provider and model for reference grounding', async () => {
    await expect(
      groundFailedReferences(
        [
          {
            ref: reference,
            domain: 'GENERAL',
            claimContext,
            allChecks: [failedCheck],
          },
        ],
        'Source grounding topic'
      )
    ).rejects.toThrow('AI provider and model are required for reference grounding.');
  });
});
