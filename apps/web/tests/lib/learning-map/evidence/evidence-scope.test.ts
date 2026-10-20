// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSkillRequirements, learningSelectionSnapshotSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { captureObjectiveAssessmentScope } from '@/lib/learning-map/evidence/scope';

function sourceOnlySelection() {
  const sha = 'a'.repeat(64);
  const citation = {
    unitId: sha,
    sourceKind: 'PASTE',
    sourceId: 'private-source',
    sourceSha256: sha,
    materialId: null,
    runId: null,
    streamId: 'stream',
    pageNumber: 1,
    origin: 'SOURCE_TEXT',
    chunkIndex: 0,
    chunkSha256: sha,
    pageTextSha256: sha,
    codePointStart: 0,
    codePointEnd: 1,
    utf8ByteStart: 0,
    utf8ByteEnd: 1,
    quote: 'A',
  };
  const candidate = {
    localId: 'private-focus',
    kind: 'OTHER',
    title: 'Private source lesson',
    description: 'An unresolved source topic.',
    communicativeIntent: null,
    heading: null,
    grammarKeys: ['unresolved'],
    objectiveIds: [],
    groupIds: [],
    citations: [citation],
    continuation: null,
  };
  const descriptor = {
    sourceKind: 'PASTE',
    sourceId: 'private-source',
    sourceRevision: 1,
    sourceSha256: sha,
    materialId: null,
    runId: null,
    processingRevision: null,
    streamId: 'stream',
    pageNumber: 1,
    origin: 'SOURCE_TEXT',
    pageTextSha256: sha,
    chunkIndex: 0,
    chunkSha256: sha,
    codePointStart: 0,
    codePointEnd: 1,
    utf8ByteStart: 0,
    utf8ByteEnd: 1,
  };
  const details = {
    id: sha,
    order: 0,
    title: 'Private source lesson',
    sourceHeadings: [],
    kind: 'OTHER',
    fragments: [
      {
        id: sha,
        unitId: sha,
        source: descriptor,
        uncertain: false,
        candidate,
        mapping: {
          status: 'UNRESOLVED',
          candidates: [],
          groupIds: [],
          unresolvedGrammarKeys: ['unresolved'],
          privateExtension: true,
        },
      },
    ],
    citations: [citation],
    objectiveCandidates: [],
    groupIds: [],
    unresolvedGrammarKeys: ['unresolved'],
    privateExtension: true,
    uncertainSource: false,
    exposureOnly: true,
  };
  const bytes = Buffer.from(JSON.stringify(details));
  return learningSelectionSnapshotSchema.parse({
    schemaVersion: 1,
    catalogVersion: null,
    catalogHash: null,
    targetLang: 'xx',
    level: 'A2',
    nodeIds: [],
    objectives: [],
    materialFocusId: 'focus-1',
    sourceFocus: {
      id: 'focus-1',
      analysisId: 'analysis-1',
      analysisRevision: 1,
      resultDigest: sha,
      focusDigest: createHash('sha256').update(bytes).digest('hex'),
      detailsBase64: bytes.toString('base64'),
      sourceContext: 'A',
      includedCitationCount: 1,
      contextTruncated: false,
      sourceScopes: [
        { subjectId: 'profile:user-1', generation: 0 },
        { subjectId: 'course:course-1', generation: 0 },
        { subjectId: 'material:private-source', generation: 0 },
      ],
      coverage: {
        expectedChunks: 1,
        analyzedChunks: 1,
        expectedCodePoints: 1,
        analyzedCodePoints: 1,
        pendingUnitIds: [],
        failedUnitIds: [],
        emptyStreams: [],
        unresolvedPages: [],
        readableTextComplete: true,
        originalContentComplete: true,
        sufficientSource: true,
        status: 'COMPLETE',
      },
    },
  });
}

describe('private source practice assessment scope', () => {
  it('keeps an owned unresolved source focus practiceable without inventing canonical evidence', async () => {
    const database = {
      course: {
        findFirst: async () => ({
          id: 'course-1',
          userId: 'user-1',
          nativeLang: 'en',
          targetLang: 'xx',
        }),
      },
    } as unknown as Prisma.TransactionClient;
    const execution = {
      userId: 'user-1',
      signal: new AbortController().signal,
      authorize: async () => ({ userId: 'user-1' }),
    } satisfies SottoProviderExecution;
    const requirements = createSkillRequirements({
      scope: 'FULL',
      nativeLang: 'en',
      targetLang: 'xx',
      level: 'A2',
      ttsProvider: null,
      sttProvider: null,
    });
    expect(
      await captureObjectiveAssessmentScope(database, {
        courseId: 'course-1',
        userId: 'user-1',
        execution,
        level: 'A2',
        requirements,
        selection: sourceOnlySelection(),
      })
    ).toBeNull();
  });
  it('still validates owner and frozen difficulty before allowing source-only practice', async () => {
    const database = {
      course: { findFirst: async () => null },
    } as unknown as Prisma.TransactionClient;
    const execution = {
      userId: 'user-1',
      signal: new AbortController().signal,
      authorize: async () => ({ userId: 'user-1' }),
    } satisfies SottoProviderExecution;
    const requirements = createSkillRequirements({
      scope: 'FULL',
      nativeLang: 'en',
      targetLang: 'xx',
      level: 'A2',
      ttsProvider: null,
      sttProvider: null,
    });
    await expect(
      captureObjectiveAssessmentScope(database, {
        courseId: 'course-1',
        userId: 'user-1',
        execution,
        level: 'A2',
        requirements,
        selection: sourceOnlySelection(),
      })
    ).rejects.toThrow(/owned course/);
  });
});
