import { describe, expect, it } from 'vitest';
import {
  classRegenerationRequestSchema,
  classRegenerationAcceptedSchema,
} from '../../src/learning-evidence';
import { classSectionSchema } from '../../src/contracts/schemas';

describe('class regeneration contract', () => {
  it('retains an optional stored section mastery threshold for clients', () => {
    const section = {
      id: 'section-1',
      skill: 'GRAMMAR',
      status: 'READY',
      episode: null,
      questions: [],
      prompts: [],
      writingPrompts: [],
    };
    expect(classSectionSchema.safeParse(section).success).toBe(true);
    expect(classSectionSchema.parse({ ...section, passThreshold: 0.85 })).toMatchObject({
      passThreshold: 0.85,
    });
  });
  it('accepts revision-bound section retries and preserves existing regeneration requests', () => {
    expect(
      classRegenerationRequestSchema.parse({
        scope: 'section',
        sectionId: 'grammar-1',
        expectedAttempt: 2,
        expectedRevision: 7,
      })
    ).toMatchObject({ sectionId: 'grammar-1', expectedRevision: 7 });
    expect(
      classRegenerationRequestSchema.parse({ expectedAttempt: 1, unrelated: 'ignored' })
    ).toEqual({ expectedAttempt: 1 });
    expect(
      classRegenerationRequestSchema.safeParse({ scope: 'class', expectedAttempt: 1 }).success
    ).toBe(true);
    expect(
      classRegenerationAcceptedSchema.safeParse({
        started: true,
        scope: 'section',
        status: 'GENERATING',
        operationId: '00000000-0000-4000-8000-000000000001',
        courseId: 'course-1',
      }).success
    ).toBe(true);
  });
  it.each([
    { scope: 'section', sectionId: 'grammar-1', expectedAttempt: 1 },
    { scope: 'section', expectedRevision: 0, expectedAttempt: 1 },
    { scope: 'sections', sectionId: 'grammar-1', expectedRevision: 0, expectedAttempt: 1 },
    {
      scope: 'section',
      sectionId: 'grammar-1',
      expectedRevision: 0,
      expectedAttempt: 1,
      pristineSnapshot: 'a'.repeat(64),
    },
  ])('rejects an incomplete or incompatible section retry contract: %j', (request) => {
    expect(classRegenerationRequestSchema.safeParse(request).success).toBe(false);
  });
});
