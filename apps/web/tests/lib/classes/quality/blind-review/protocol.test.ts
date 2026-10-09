import { describe, expect, it } from 'vitest';
import {
  buildBlindReviewSourceParts,
  blindReviewResponseSchema,
} from '@/lib/classes/quality/blind-review/protocol';
import {
  assessSectionReview,
  sectionReviewInput,
  sectionReviewSchema,
  SectionQualityError,
} from '@/lib/classes/section-quality';
import {
  captureReviewerProtocolEvidence,
  retainReviewerProtocolEvidence,
} from '@/lib/classes/quality/private-protocol-evidence';
import { captureGenerationFailure } from '@/lib/classes/quality/generation-failure';

const material = [
  {
    question: 'Was hat Eva gemacht?',
    options: ['Tee gekocht', 'Gelesen'],
    correctIndex: 0,
    explanation: 'Sie hat Tee gekocht.',
    passageText: 'HOST: Eva hat Tee gekocht.',
  },
];
const approval = {
  passageFindings: [],
  issues: [],
  questions: [{ index: 0, acceptableOptionIndices: [0], issues: [] }],
};

describe('bounded blind-review source anchors', () => {
  it('preserves Unicode and speaker boundaries in exact bounded excerpts of the full passage', () => {
    const passage = 'a'.repeat(239) + '😀 Gru\u0308ße！中文\nEXPERT: ' + 'b'.repeat(260);
    const parts = buildBlindReviewSourceParts(passage);
    expect(parts.join('')).toBe(passage);
    expect(parts.every((part) => part.length <= 240 && part.isWellFormed())).toBe(true);
    const questions = [{ ...material[0], passageText: passage }];
    const input = JSON.parse(sectionReviewInput(questions));
    expect(input.passage).toBe(passage);
    expect(input.sourceParts.map((part: { text: string }) => part.text)).toEqual(parts);
    const finding = {
      sourcePartIndex: 1,
      issue: 'unnatural',
      reason: 'The complete exchange is not idiomatic.',
    };
    const result = assessSectionReview(
      JSON.stringify({ ...approval, passageFindings: [finding] }),
      questions,
      false
    );
    expect(result.feedback?.passageFeedback).toEqual([{ quote: parts[1], reason: finding.reason }]);
    expect(result.issues).toContain('unnatural_passage');
  });

  it('permits an empty grammar passage and rejects passage findings without a source anchor', () => {
    const empty = [{ ...material[0], passageText: ' '.repeat(480) }];
    expect(JSON.parse(sectionReviewInput(empty)).sourceParts).toEqual([]);
    expect(assessSectionReview(JSON.stringify(approval), empty, false).issues).toEqual([]);
    expect(() =>
      assessSectionReview(
        JSON.stringify({
          ...approval,
          passageFindings: [{ sourcePartIndex: 0, issue: 'incorrect', reason: 'Missing content.' }],
        }),
        empty,
        false
      )
    ).toThrow(SectionQualityError);
  });

  it('keeps independent section and question defects even when passage findings are empty', () => {
    const result = assessSectionReview(
      JSON.stringify({
        ...approval,
        issues: ['level'],
        questions: [{ index: 0, acceptableOptionIndices: [], issues: ['unsupported'] }],
      }),
      material,
      false
    );
    expect(result.issues).toEqual(['level', 'unsupported', 'ambiguous']);
    expect(result.feedback?.passageAcceptable).toBe(true);
  });

  it('cannot encode an independent passage approval or model-written source quote', () => {
    const schema = blindReviewResponseSchema(buildBlindReviewSourceParts(material[0].passageText));
    expect(schema.safeParse({ ...approval, passageAcceptable: true }).success).toBe(false);
    expect(
      schema.safeParse({
        ...approval,
        passageFindings: [
          { sourcePartIndex: 0, issue: 'incorrect', reason: 'Defect.', quote: 'Invented.' },
        ],
      }).success
    ).toBe(false);
    const output = sectionReviewSchema(material).schema;
    expect(JSON.stringify(output)).not.toContain('passageAcceptable');
    expect(JSON.stringify(output)).not.toContain('passageFeedback');
  });

  it('retains authenticated malformed blind output privately without granting semantic repair authority', () => {
    const response = JSON.stringify({
      ...approval,
      passageFindings: [
        { sourcePartIndex: 9, issue: 'incorrect', reason: 'Private malformed response.' },
      ],
    });
    let error: unknown;
    try {
      assessSectionReview(response, material, true, 'listening');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SectionQualityError);
    expect((error as SectionQualityError).blindReviewFailure).toBeUndefined();
    const evidence = captureReviewerProtocolEvidence(error, {
      kind: 'listening',
      role: 'blind_section',
      offset: 0,
      candidate: JSON.parse(sectionReviewInput(material)),
      response,
    });
    expect(evidence).toBeDefined();
    retainReviewerProtocolEvidence(error, [evidence!]);
    const failure = captureGenerationFailure(error);
    expect(failure.protocolEvidence?.[0]).toMatchObject({
      role: 'blind_section',
      reason: 'schema',
    });
    expect(JSON.parse(failure.protocolEvidence![0].payload.json!).response).toBe(response);
    expect(failure.teachingFailure).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('Private');
    expect(
      captureReviewerProtocolEvidence(new SectionQualityError(), {
        kind: 'listening',
        role: 'blind_section',
        offset: 0,
        candidate: {},
        response,
      })
    ).toBeUndefined();
  });
});
