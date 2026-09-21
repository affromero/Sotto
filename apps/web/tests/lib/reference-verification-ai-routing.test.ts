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
  it('rejects reference evaluation without a captured AI selection', async () => {
    await expect(
      aiEvaluateWithDomainContext(
        [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
        'Source evaluation topic',
        null as never
      )
    ).rejects.toThrow();
  });

  it('returns no grounded references when captured AI selection is missing', async () => {
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
        'Source grounding topic',
        null as never
      )
    ).resolves.toEqual(new Map());
  });
});
