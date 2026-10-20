import { createHash } from 'node:crypto';
import { learningSelectionSnapshotSchema, materialMergedSourceFocusSchema } from '@sotto/shared';
import {
  privateSpeakingAssessmentSchema,
  privateSpeakingFingerprint,
} from '@/lib/learning-map/evidence/private-speaking/protocol';

export function privateSpeakingFixture(userId = 'user-1', courseId = 'course-1') {
  const quote = 'Describe a change in your plans using werden.\u0000😀';
  const sha = createHash('sha256').update(quote).digest('hex');
  const extent = {
    chunkIndex: 0,
    chunkSha256: sha,
    codePointStart: 0,
    codePointEnd: [...quote].length,
    utf8ByteStart: 0,
    utf8ByteEnd: Buffer.byteLength(quote),
  };
  const identity = {
    sourceKind: 'PASTE',
    sourceId: 'paste-1',
    sourceSha256: sha,
    materialId: null,
    runId: null,
    streamId: 'source-1',
    pageNumber: 1,
    origin: 'SOURCE_TEXT',
    pageTextSha256: sha,
  };
  const citation = { ...identity, ...extent, unitId: 'a'.repeat(64), quote };
  const details = materialMergedSourceFocusSchema.parse({
    id: 'b'.repeat(64),
    order: 0,
    title: 'Private werden function',
    sourceHeadings: [],
    kind: 'GRAMMAR',
    fragments: [
      {
        id: 'c'.repeat(64),
        unitId: 'a'.repeat(64),
        source: { ...identity, ...extent, sourceRevision: 1, processingRevision: null },
        uncertain: false,
        candidate: {
          localId: 'werden-plans',
          kind: 'GRAMMAR',
          title: 'Private werden function',
          description: 'Express a future change in your plans.',
          communicativeIntent: 'Explain what will change.',
          heading: null,
          grammarKeys: ['private.werden-change'],
          objectiveIds: [],
          groupIds: [],
          citations: [citation],
          continuation: null,
        },
        mapping: {
          status: 'UNRESOLVED',
          candidates: [],
          groupIds: [],
          unresolvedGrammarKeys: ['private.werden-change'],
          privateExtension: true,
        },
      },
    ],
    citations: [citation],
    objectiveCandidates: [],
    groupIds: [],
    unresolvedGrammarKeys: ['private.werden-change'],
    privateExtension: true,
    uncertainSource: false,
    exposureOnly: true,
  });
  const bytes = Buffer.from(JSON.stringify(details));
  const selection = learningSelectionSnapshotSchema.parse({
    schemaVersion: 1,
    catalogVersion: null,
    catalogHash: null,
    targetLang: 'de',
    level: 'A2',
    nodeIds: [],
    objectives: [],
    materialFocusId: 'd'.repeat(64),
    sourceFocus: {
      id: 'd'.repeat(64),
      analysisId: 'd1438bc6-a9a6-4c4a-bf12-e7b11c79110b',
      analysisRevision: 3,
      resultDigest: 'e'.repeat(64),
      focusDigest: createHash('sha256').update(bytes).digest('hex'),
      detailsBase64: bytes.toString('base64'),
      sourceContext: quote.replaceAll('\u0000', '\\u0000'),
      includedCitationCount: 1,
      contextTruncated: false,
      sourceScopes: [
        { subjectId: `profile:${userId}`, generation: 1 },
        { subjectId: `course:${courseId}`, generation: 1 },
        { subjectId: 'analysis:owned', generation: 1 },
      ],
      coverage: {
        expectedChunks: 1,
        analyzedChunks: 1,
        expectedCodePoints: [...quote].length,
        analyzedCodePoints: [...quote].length,
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
  const scope = { userId, courseId, targetLang: 'de', level: 'A2' as const };
  const source = {
    focusId: selection.sourceFocus!.id,
    analysisId: selection.sourceFocus!.analysisId,
    analysisRevision: 3,
    resultDigest: selection.sourceFocus!.resultDigest,
    focusDigest: selection.sourceFocus!.focusDigest,
  };
  const task = {
    kind: 'COMMUNICATIVE_SPEAKING' as const,
    task: 'Tell a colleague how your plans for next month will change. Use werden to explain the change.',
    guidance: 'Speak in German. Give one concrete change and explain why it matters.',
    suppliedSupport: [],
  };
  const rubric =
    'Independently describe the future change with werden, explain the intended new plan and give a relevant reason.';
  const assessment = privateSpeakingAssessmentSchema.parse({
    schemaVersion: 1,
    kind: 'PRIVATE_SOURCE_SPEAKING',
    scope,
    source,
    task,
    rubric,
    taskFingerprint: privateSpeakingFingerprint({ scope, source, task, rubric }),
    review: {
      protocol: 'PRIVATE_SOURCE_ELICITATION_V1',
      provider: 'configured',
      model: 'configured-model',
      inputSha256: '1'.repeat(64),
      responseSha256: '2'.repeat(64),
      elicitationQuote: 'Use werden to explain the change.',
      rationale:
        'The task elicits the specific private grammar function through a concrete change in plans.',
    },
  });
  return { selection, assessment };
}
