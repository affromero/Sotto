import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { expect, it } from 'vitest';
import { POST as practice } from '@/app/api/v1/courses/[courseId]/practice/route';
import { POST as preview } from '@/app/api/v1/courses/[courseId]/learning-map/selection/route';
import { GET as map } from '@/app/api/v1/courses/[courseId]/learning-map/route';
import { GET as resume, DELETE as discardPractice } from '@/app/api/v1/practice/[sessionId]/route';
import {
  learningSelectionSnapshotSchema,
  learningSelectionPreviewSchema,
  skillRequirementsSchema,
} from '@sotto/shared';
import { readFrozenLearningSourceFocus } from '@/lib/learning-map/selection';
import { captureObjectiveAssessmentScope } from '@/lib/learning-map/evidence/scope';
import { practicePreparationSchema } from '@/lib/practice/preparation-state';
import { practicePreparationGrant, validatePracticePreparation } from '@/lib/practice/preparation';
import { learningPreparationProviderRequest } from '@/lib/learning/preparation/preparation-provider';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { captureStorageBackend } from '@/lib/r2';
import { processMaterialAnalysis } from '@/lib/course-materials/analysis/processing';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../../helpers/setup/shared-instance';
import type { Job } from 'bullmq';
import type { CourseMaterial, MaterialExtractionRun } from '@/generated/prisma/client';
interface Fixture {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  courseId: string;
  admitted: (value?: unknown) => Promise<{ analysisId: string }>;
  input: (value?: string) => Record<string, unknown>;
  delivered: (id: string) => Promise<Job<unknown>>;
  request: (path: string, body?: unknown, token?: string) => NextRequest;
  requests: readonly unknown[];
  materialFixture: (
    texts?: string[]
  ) => Promise<{ material: CourseMaterial; run: MaterialExtractionRun }>;
  exactText: string;
  sha: (value: Buffer) => string;
}
export function registerFocusedMaterialPracticeCases(fixture: () => Fixture) {
  it('admits owned private source practice without a published language map and creates no mastery', async () => {
    const { instance, identity, courseId, admitted, input, delivered, request, requests } =
      fixture();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'nl' } },
      create: { nativeLang: 'en', targetLang: 'nl', title: 'Private Dutch source fixture' },
      update: {},
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { curriculumId: curriculum.id, targetLang: 'nl' },
    });
    const receipt = await admitted({ ...input('Ik kom morgen.'), target: 'nl' });
    await processMaterialAnalysis(await delivered(receipt.analysisId));
    const focus = await instance.database.materialSourceFocus.findFirstOrThrow({
      where: { analysisId: receipt.analysisId },
    });
    const params = { params: Promise.resolve({ courseId }) };
    const unavailable = await map(request(`courses/${courseId}/learning-map`), params);
    expect(unavailable.status).toBe(422);
    expect(await unavailable.json()).toMatchObject({ status: 'UNAVAILABLE', targetLang: 'nl' });
    const learningSelection = {
      catalogVersion: null,
      nodeIds: [],
      level: 'A1',
      materialFocusId: focus.id,
    };
    const beforeCalls = requests.length;
    const selected = await preview(
      request(`courses/${courseId}/learning-map/selection`, learningSelection),
      params
    );
    expect(selected.status).toBe(200);
    const resolved = learningSelectionPreviewSchema.parse(await selected.json());
    expect(resolved.selection).toMatchObject({
      targetLang: 'nl',
      level: 'A1',
      catalogVersion: null,
      catalogHash: null,
      nodeIds: [],
      objectives: [],
      materialFocusId: focus.id,
    });
    expect(resolved.availableKinds).toContain('GRAMMAR');
    const requestId = randomUUID();
    const body = { requestId, kind: 'GRAMMAR', learningSelection };
    expect((await practice(request(`courses/${courseId}/practice`, body), params)).status).toBe(
      202
    );
    expect((await practice(request(`courses/${courseId}/practice`, body), params)).status).toBe(
      202
    );
    const saved = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(saved.practiceLevel).toBe('A1');
    const frozen = learningSelectionSnapshotSchema.parse(saved.learningSelection);
    expect(frozen.catalogHash).toBeNull();
    expect(frozen.objectives).toEqual([]);
    expect(frozen.sourceFocus?.focusDigest).toBe(focus.detailsSha256);
    expect(await instance.database.learningObservation.count({ where: { courseId } })).toBe(0);
    expect(await instance.database.learningLevelBinding.count({ where: { courseId } })).toBe(0);
    expect(
      await instance.database.course.findUniqueOrThrow({
        where: { id: courseId },
        select: { currentLevel: true, startLevel: true },
      })
    ).toEqual({ currentLevel: 'A2', startLevel: 'A2' });
    const foreign = await identity.household('Foreign private source reader');
    expect(
      (
        await preview(
          request(`courses/${courseId}/learning-map/selection`, learningSelection, foreign.token),
          params
        )
      ).status
    ).toBe(404);
    expect(
      (
        await preview(
          request(`courses/${courseId}/learning-map/selection`, {
            ...learningSelection,
            level: 'B1',
          }),
          params
        )
      ).status
    ).toBe(409);
    expect(
      (
        await preview(
          request(`courses/${courseId}/learning-map/selection`, {
            ...learningSelection,
            nodeIds: ['nl.g.guessed'],
          }),
          params
        )
      ).status
    ).toBe(400);
    expect(requests).toHaveLength(beforeCalls);
  });
  it('freezes an unmatched source focus byte receipt for repeatable practice without unrelated objective credit', async () => {
    const { instance, identity, courseId, admitted, delivered, request, requests } = fixture();
    const receipt = await admitted();
    await processMaterialAnalysis(await delivered(receipt.analysisId));
    const focus = await instance.database.materialSourceFocus.findFirstOrThrow({
      where: { analysisId: receipt.analysisId },
    });
    const requestId = randomUUID();
    const learningSelection = {
      catalogVersion: null,
      nodeIds: [],
      level: 'A2',
      materialFocusId: focus.id,
    };
    const body = { kind: 'GRAMMAR', requestId, learningSelection };
    const response = await practice(request(`courses/${courseId}/practice`, body), {
      params: Promise.resolve({ courseId }),
    });
    expect(response.status).toBe(202);
    const session = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(session.practiceLevel).toBe('A2');
    const frozen = learningSelectionSnapshotSchema.parse(session.learningSelection);
    expect(frozen.objectives).toEqual([]);
    expect(frozen.nodeIds).toEqual([]);
    expect(frozen.sourceFocus?.detailsBase64).toBe(
      Buffer.from(focus.detailsBytes).toString('base64')
    );
    expect(frozen.sourceFocus?.focusDigest).toBe(focus.detailsSha256);
    const details = readFrozenLearningSourceFocus(frozen.sourceFocus!);
    expect(
      details.citations.some(
        (citation) => citation.quote.includes('\u0000') && citation.quote.includes('😀')
      )
    ).toBe(true);
    expect(frozen.sourceFocus?.sourceContext).toContain('\\u0000');
    expect(frozen.sourceFocus?.sourceContext).not.toContain('\u0000');
    expect(session.generationSpec).toMatchObject({ note: expect.stringContaining('\\u0000') });
    const authority = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    expect(
      await sottoTransaction(instance.database, (database) =>
        captureObjectiveAssessmentScope(database, {
          courseId,
          userId: identity.ownerId,
          execution: authority,
          level: 'A2',
          requirements: skillRequirementsSchema.parse(session.skillRequirements),
          selection: frozen,
        })
      )
    ).toBeNull();
    const operation = session.generationState as { id: string };
    const record = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(operation.id)
    );
    expect(record?.job.scopes).toEqual(expect.arrayContaining(frozen.sourceFocus!.sourceScopes));
    const replay = await practice(request(`courses/${courseId}/practice`, body), {
      params: Promise.resolve({ courseId }),
    });
    expect(replay.status).toBe(202);
    const next = await practice(
      request(`courses/${courseId}/practice`, { ...body, requestId: randomUUID() }),
      { params: Promise.resolve({ courseId }) }
    );
    expect(next.status).toBe(202);
    expect(await instance.database.learningObservation.count({ where: { courseId } })).toBe(0);
    expect(requests).toHaveLength(1);
    expect(() =>
      readFrozenLearningSourceFocus({ ...frozen.sourceFocus!, focusDigest: 'f'.repeat(64) })
    ).toThrow('byte identity');
    const foreign = await identity.household('Foreign focused reader');
    expect(
      (
        await practice(
          request(
            `courses/${courseId}/practice`,
            { ...body, requestId: randomUUID() },
            foreign.token
          ),
          { params: Promise.resolve({ courseId }) }
        )
      ).status
    ).toBe(404);
    await instance.database.materialAnalysis.update({
      where: { id: receipt.analysisId },
      data: { status: 'FAILED' },
    });
    const stale = await practice(
      request(`courses/${courseId}/practice`, { ...body, requestId: randomUUID() }),
      { params: Promise.resolve({ courseId }) }
    );
    expect(stale.status).toBe(404);
    expect(requests).toHaveLength(1);
  });
  it('retires original source snapshots on material deletion while preserving generated exercises, learner answers and earned receipts', async () => {
    const {
      instance,
      identity,
      courseId,
      admitted,
      input,
      delivered,
      request,
      requests,
      materialFixture,
      exactText,
      sha,
    } = fixture();
    const { material } = await materialFixture([exactText]);
    const receipt = await admitted({ ...input(''), materialIds: [material.id] });
    await processMaterialAnalysis(await delivered(receipt.analysisId));
    const focus = await instance.database.materialSourceFocus.findFirstOrThrow({
      where: { analysisId: receipt.analysisId },
    });
    const learningSelection = {
      catalogVersion: null,
      nodeIds: [],
      level: 'A2',
      materialFocusId: focus.id,
    };
    async function focused() {
      const id = randomUUID();
      const response = await practice(
        request(`courses/${courseId}/practice`, {
          kind: 'GRAMMAR',
          requestId: id,
          learningSelection,
        }),
        { params: Promise.resolve({ courseId }) }
      );
      expect(response.status).toBe(202);
      return id;
    }
    const pending = await focused();
    const active = await focused();
    const pendingRow = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: pending },
    });
    const pendingOperation = practicePreparationSchema.parse(pendingRow.generationState);
    await instance.database.practiceSession.update({
      where: { id: pending },
      data: { generationState: { ...pendingOperation, status: 'RUNNING' } },
    });
    const providerRequest = learningPreparationProviderRequest(
      {
        selection: pendingOperation.selection,
        admit: async (database, attempt) => {
          const current = await validatePracticePreparation(database, pending, pendingOperation.id);
          return practicePreparationGrant(database, current.operation).admit(
            current.operation.grant,
            attempt
          );
        },
        settle: (database, attempt, outcome) =>
          practicePreparationGrant(database, pendingOperation).settle(
            pendingOperation.grant,
            attempt,
            outcome
          ),
      },
      new AbortController().signal,
      () => {}
    );
    await expect(
      providerRequest(
        new Request('http://127.0.0.1/owned-source-fixture', {
          method: 'POST',
          body: JSON.stringify({ source: exactText }),
        }),
        async () => {
          throw new Error('Synthetic connection loss after dispatch.');
        }
      )
    ).rejects.toThrow(/unresolved/);
    const unknownBefore = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, pendingOperation).read(pendingOperation.grant)
    );
    expect(unknownBefore.attempts).toHaveLength(1);
    expect(unknownBefore.attempts[0]!.outcome).toBe('unknown');
    const before = await instance.database.practiceSession.findUniqueOrThrow({
      where: { id: active },
    });
    const operation = practicePreparationSchema.parse(before.generationState);
    const items = [
      {
        id: 'q0',
        prompt: 'Choose the form in this independently generated example.',
        options: ['form one', 'form two', 'form three', 'form four'],
        correctIndex: 0,
        explanation: 'The subject requires form one.',
        vocabLemma: null,
        focusTargetId: null,
      },
    ];
    await instance.database.practiceSession.update({
      where: { id: active },
      data: {
        status: 'ACTIVE',
        items,
        learnerAnswers: { q0: 0 },
        generationState: { ...operation, status: 'COMPLETED' },
      },
    });
    const objective = getLanguageCatalog('de').nodes.find(
      (node) => node.kind === 'OBJECTIVE' && node.level === 'A2' && node.branch === 'GRAMMAR'
    );
    if (objective?.kind !== 'OBJECTIVE')
      throw new Error('Missing exact independent assessment fixture.');
    const revision = await instance.database.learningMapRevision.findFirstOrThrow({
      where: { targetLang: 'de' },
    });
    const earned = await instance.database.learningObservation.create({
      data: {
        courseId,
        objectiveId: objective.id,
        criterionVersion: objective.criterionVersion,
        policyVersion: objective.policyVersion,
        level: 'A2',
        skill: 'GRAMMAR',
        revisionId: revision.id,
        deduplicationKey: sha(Buffer.from(randomUUID())),
        sourceType: 'PRACTICE_QUESTION',
        sessionId: 'existing-independent-assessment',
        taskId: sha(Buffer.from('existing independent task')),
        responseIdentity: sha(Buffer.from('existing independently assessed response')),
        quality: 0.9,
        evidence: {
          assessment: objective.skillCriteria.GRAMMAR!,
          rationale: 'An independently reviewed earlier response remains earned.',
        },
      },
    });
    const eraseSource = () =>
      sottoTransaction(
        instance.database,
        async (database) => {
          await admitLearningStorageDeletion({
            database,
            scope: { kind: 'material', id: material.id },
            subjects: [
              { subjectId: `material:${material.id}`, generation: material.createdAt.getTime() },
            ],
            currentBackend: await captureStorageBackend(),
          });
          await database.courseMaterial.delete({ where: { id: material.id } });
        },
        { timeoutMs: 60000 }
      );
    await instance.database.practiceSession.update({
      where: { id: pending },
      data: { generationState: { invalidRecoveryPointer: true } },
    });
    await expect(eraseSource()).rejects.toThrow('saved practice preparation receipt is invalid');
    expect(
      await instance.database.courseMaterial.findUnique({ where: { id: material.id } })
    ).not.toBeNull();
    expect(
      (await instance.database.practiceSession.findUniqueOrThrow({ where: { id: pending } }))
        .generationSpec
    ).not.toBeNull();
    const preserved = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, pendingOperation).read(pendingOperation.grant)
    );
    expect(preserved.status).toBe('active');
    expect(preserved.attempts).toEqual(unknownBefore.attempts);
    await instance.database.practiceSession.update({
      where: { id: pending },
      data: { generationState: { ...pendingOperation, status: 'RUNNING' } },
    });
    await eraseSource();
    for (const id of [pending, active]) {
      const row = await instance.database.practiceSession.findUniqueOrThrow({ where: { id } });
      expect(row.learningSelection).toBeNull();
      expect(row.generationSpec).toBeNull();
      expect(row.generationState).toMatchObject({
        sourceRetired: true,
        status: 'FAILED',
        failure: 'source_unreadable',
      });
      expect(
        await instance.database.practiceRequestReceipt.findUnique({ where: { id } })
      ).toMatchObject({ courseId });
    }
    expect(
      await instance.database.learningObservation.findUnique({ where: { id: earned.id } })
    ).toEqual(earned);
    const unknownAfter = await sottoTransaction(instance.database, (database) =>
      practicePreparationGrant(database, pendingOperation).read(pendingOperation.grant)
    );
    expect(unknownAfter.status).toBe('revoked');
    expect(unknownAfter.attempts).toEqual(unknownBefore.attempts);
    const activeResponse = await resume(request(`practice/${active}`), {
      params: Promise.resolve({ sessionId: active }),
    });
    expect(activeResponse.status).toBe(200);
    const ready = await activeResponse.json();
    expect(ready).toMatchObject({
      status: 'ready',
      learningSelection: null,
      learnerAnswers: { q0: 0 },
      items: [{ id: 'q0', prompt: items[0]!.prompt }],
    });
    expect(JSON.stringify(ready)).not.toMatch(/detailsBase64|sourceContext|Passiv Präsens/);
    const pendingResponse = await resume(request(`practice/${pending}`), {
      params: Promise.resolve({ sessionId: pending }),
    });
    expect(pendingResponse.status).toBe(200);
    expect(await pendingResponse.json()).toMatchObject({
      status: 'preparing',
      preparationStatus: 'FAILED',
      canRecover: false,
      message: expect.stringContaining('original source was removed'),
    });
    const replay = await practice(
      request(`courses/${courseId}/practice`, {
        kind: 'GRAMMAR',
        requestId: pending,
        learningSelection,
      }),
      { params: Promise.resolve({ courseId }) }
    );
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({
      error: expect.stringContaining('original source was removed'),
    });
    expect(
      await instance.database.materialAnalysis.findUnique({ where: { id: receipt.analysisId } })
    ).toBeNull();
    const discarded = await discardPractice(
      new NextRequest(`http://localhost:3000/api/v1/practice/${active}`, {
        method: 'DELETE',
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      }),
      { params: Promise.resolve({ sessionId: active }) }
    );
    expect(discarded.status).toBe(200);
    expect(await discarded.json()).toMatchObject({ deleted: true });
    expect(
      await instance.database.practiceRequestReceipt.findUnique({ where: { id: active } })
    ).toMatchObject({ courseId });
    expect(requests).toHaveLength(1);
  });
}
