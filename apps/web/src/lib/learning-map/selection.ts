import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  createSkillRequirements,
  normalizeLearningSelection,
  resolveLearningSelection,
  learningSelectionSnapshotSchema,
  learningSourceFocusSnapshotSchema,
  materialMergedSourceFocusSchema,
  skillRequirementsSchema,
  type LearningSelectionRequest,
  type LearningSelectionSnapshot,
  type LearningSourceFocusSnapshot,
  type SkillRequirements,
  type PracticeKind,
} from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '../sidedoor/credentials/runtime/provider-execution';
import { resolveSkillRequirementsInTransaction } from '../learning/skill-requirements';
import { cefrRank } from '../cefr-levels';
import { ensureLearningLevelBinding, type LearningCourse } from './binding';
import { readCourseCatalog } from './catalog';
import { languageCatalogAvailability } from './catalogs';
import { LearningMapError, readObjectiveStates } from './read';

export function readFrozenLearningSourceFocus(source: LearningSourceFocusSnapshot) {
  const input = learningSourceFocusSnapshotSchema.parse(source);
  const bytes = Buffer.from(input.detailsBase64, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== input.focusDigest)
    throw new LearningMapError('The frozen source focus byte identity changed.', 409);
  return materialMergedSourceFocusSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  );
}

async function captureSourceFocus(
  database: Prisma.TransactionClient,
  course: LearningCourse,
  request: LearningSelectionRequest
) {
  if (!request.materialFocusId) return null;
  const { readOwnedMaterialSourceFocus } = await import('../course-materials/analysis/read');
  const source = await readOwnedMaterialSourceFocus(database, {
    id: request.materialFocusId,
    userId: course.userId,
    courseId: course.id,
    targetLang: course.targetLang,
    level: request.level,
  });
  const frozen = learningSourceFocusSnapshotSchema.parse({
    id: source.id,
    analysisId: source.analysisId,
    analysisRevision: source.analysisRevision,
    resultDigest: source.resultDigest,
    focusDigest: source.focusDigest,
    detailsBase64: source.detailsBase64,
    sourceContext: source.sourceContext,
    coverage: source.coverage,
    includedCitationCount: source.includedCitationCount,
    contextTruncated: source.contextTruncated,
    sourceScopes: source.sourceScopes,
  });
  readFrozenLearningSourceFocus(frozen);
  return frozen;
}

export function focusedPracticeKinds(
  selection: LearningSelectionSnapshot,
  coverage: SkillRequirements
) {
  const skills = selection.objectives.length
    ? new Set(selection.objectives.flatMap((objective) => objective.skills))
    : new Set(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']);
  return (['FULL', 'GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const).filter(
    (kind) => kind === 'FULL' || (skills.has(kind) && coverage.skills[kind].state === 'REQUIRED')
  );
}

export function focusedPracticeRequirements(
  current: SkillRequirements,
  coverage: SkillRequirements
) {
  if (
    current.level !== coverage.level ||
    current.nativeLang !== coverage.nativeLang ||
    current.targetLang !== coverage.targetLang
  )
    throw new LearningMapError('Focused practice coverage changed language or difficulty.', 409);
  for (const skill of ['LISTENING', 'SPEAKING'] as const) {
    if (
      (current.scope === 'FULL' || current.scope === skill) &&
      coverage.skills[skill].state === 'REQUIRED' &&
      current.skills[skill].state !== 'REQUIRED'
    )
      throw new LearningMapError(
        'Restore the configured speech provider required by this level before starting this format.',
        409
      );
  }
  return createSkillRequirements({
    scope: current.scope,
    nativeLang: current.nativeLang,
    targetLang: current.targetLang,
    level: current.level,
    ttsProvider: current.ttsProvider,
    sttProvider: current.sttProvider,
  });
}

/** Resolve once at admission. Saved snapshots, never refreshed recommendations, own queued work. */
export async function capturePracticeLearningSelection(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  course: LearningCourse,
  input: LearningSelectionRequest,
  kind: PracticeKind,
  frozen?: LearningSelectionSnapshot,
  pin = false,
  frozenRequirements?: SkillRequirements
) {
  const actor = await execution.authorize(database);
  if (actor.userId !== course.userId || execution.userId !== actor.userId)
    throw new LearningMapError('The focused practice recipient changed.', 409);
  const request = normalizeLearningSelection(input);
  if (cefrRank(request.level) > cefrRank(course.currentLevel))
    throw new LearningMapError('Reach this level to practise its objectives.', 409);
  const sourceFocus = await captureSourceFocus(database, course, request);
  const availability = languageCatalogAvailability(course.targetLang);
  const existing = await database.learningLevelBinding.findUnique({
    where: {
      courseId_level: { courseId: course.id, level: request.level },
    },
    include: { revision: true },
  });
  const coverage = existing
    ? skillRequirementsSchema.parse(existing.coverage)
    : await resolveSkillRequirementsInTransaction(database, execution, {
        scope: 'CLASS',
        nativeLang: course.nativeLang,
        targetLang: course.targetLang,
        level: request.level,
      });
  let selection: LearningSelectionSnapshot;
  if (availability.status === 'UNAVAILABLE') {
    if (request.nodeIds.length || request.catalogVersion !== null || !sourceFocus)
      throw new LearningMapError(
        'This language has no published learning catalog. Select an owned source focus without catalog objectives.',
        422
      );
    selection = learningSelectionSnapshotSchema.parse({
      schemaVersion: 1,
      catalogVersion: null,
      catalogHash: null,
      targetLang: course.targetLang,
      level: request.level,
      nodeIds: [],
      objectives: [],
      materialFocusId: sourceFocus.id,
      sourceFocus,
    });
  } else {
    const { catalog, catalogHash } = await readCourseCatalog(database, {
      ...course,
      currentLevel: request.level,
    });
    if (request.catalogVersion !== null && request.catalogVersion !== catalog.version)
      throw new LearningMapError('The learning catalog changed. Reload your selection.', 409);
    const states = await readObjectiveStates(database, course.id, request.level);
    const priorities =
      frozen?.objectives.map((objective) => objective.id) ??
      [...states]
        .sort(
          (left, right) => left.mastery - right.mastery || left.assessedTasks - right.assessedTasks
        )
        .map((state) => state.objectiveId);
    const objectives = (() => {
      try {
        return request.nodeIds.length ? resolveLearningSelection(catalog, request, priorities) : [];
      } catch (error) {
        throw new LearningMapError(
          error instanceof Error ? error.message : 'Invalid learning selection.',
          422
        );
      }
    })();
    if (pin && objectives.length)
      await ensureLearningLevelBinding(database, course, request.level, coverage);
    selection = learningSelectionSnapshotSchema.parse({
      schemaVersion: 1,
      catalogVersion: catalog.version,
      catalogHash,
      targetLang: course.targetLang,
      level: request.level,
      nodeIds: request.nodeIds,
      materialFocusId: request.materialFocusId ?? null,
      sourceFocus,
      objectives: objectives.map((objective) => ({
        id: objective.id,
        criterionVersion: objective.criterionVersion,
        policyVersion: objective.policyVersion,
        title: objective.title,
        branch: objective.branch,
        level: objective.level,
        assessment: objective.assessment,
        examples: objective.examples,
        skills: objective.skills,
        skillCriteria: objective.skillCriteria,
        grammarKeys: objective.grammarKeys,
        vocabulary: objective.vocabulary,
      })),
    });
  }
  if (frozen && !isDeepStrictEqual(selection, learningSelectionSnapshotSchema.parse(frozen)))
    throw new LearningMapError('The frozen learning selection or owned source changed.', 409);
  const attemptCoverage =
    frozenRequirements ??
    (await resolveSkillRequirementsInTransaction(database, execution, {
      scope: kind === 'FULL' ? 'CLASS' : kind,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
      level: request.level,
    }));
  if (
    attemptCoverage.nativeLang !== course.nativeLang ||
    attemptCoverage.targetLang !== course.targetLang ||
    attemptCoverage.level !== request.level
  )
    throw new LearningMapError(
      'Practice provider coverage changed its language or difficulty.',
      409
    );
  if (frozenRequirements && attemptCoverage.scope !== kind)
    throw new LearningMapError('Frozen practice provider coverage changed its format.', 409);
  const availableKinds = focusedPracticeKinds(selection, attemptCoverage);
  if (!availableKinds.some((available) => available === kind))
    throw new LearningMapError(
      'Choose a format supported by the selected objectives and pinned skill coverage.',
      422
    );
  return { selection, coverage, availableKinds };
}
