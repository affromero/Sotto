import { expect, vi, type Mock } from 'vitest';
import { checkFailedAssessmentSubmission } from './submission/failed';
import { checkSpeakingAssessmentSubmission } from './submission/speaking';
import { checkPassedAssessmentDeletion } from './submission/passed-deletion';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { NextRequest } from 'next/server';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  recoverAssessmentOutcome,
  verifyHistoricalAssessmentGeneration,
} from '@/lib/learning/classes/lifecycle/assessment-outcome';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { authorizedLearnerExecution } from '../../../../../helpers/runtime/provider-execution';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { captureAssessmentForEvaluation } from '@/lib/learning/classes/material/assessment-read';

interface OutcomeSubmissionContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  classId: string;
  cls: { courseId: string; attempt: number; createdAt: Date };
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  operation: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  mode: 'submission' | 'submission_fail' | 'submission_speaking_fail';
  selectedMode: string;
  root: string;
  provider: { generate: Mock };
  boundary: { execution: SottoProviderExecution | null };
  captured: Awaited<ReturnType<typeof captureAssessmentForEvaluation>>;
  formativeQuestions: Array<{ id: string; skill: string }>;
  assessmentRoute: typeof import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/route');
  other: { id: string; token: string };
  assessmentArchiveId: typeof import('@/lib/learning/classes/history/assessment-archive').assessmentArchiveId;
}

export async function checkAssessmentOutcomeSubmission({
  instance,
  identity,
  classId,
  cls,
  fence,
  operation,
  execution,
  mode,
  selectedMode,
  root,
  provider,
  boundary,
  captured,
  formativeQuestions,
  assessmentRoute,
  other,
  assessmentArchiveId,
}: OutcomeSubmissionContext) {
  let relocatedSourcePath: string | null = null;
  let migratedCopyId: string | null = null;

  await expect(
    sottoTransaction(instance.database, (tx) => verifyHistoricalAssessmentGeneration(tx, operation))
  ).rejects.toThrow();
  const { submitAssessment } =
    await import('@/lib/learning/classes/lifecycle/assessment-submission');
  const { captureAssessmentWritingTask } =
    await import('@/lib/learning/classes/writing/assessment-writing-read');
  const { admitAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-admission');
  const { runAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-run');
  const choices = captured.material.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      'correctIndex' in item
        ? [
            {
              itemId: item.id,
              selectedIndex:
                mode !== 'submission' && section.skill === 'GRAMMAR'
                  ? (item.correctIndex + 1) % 4
                  : item.correctIndex,
            },
          ]
        : []
    )
  );
  const priorQuestion = await instance.database.lessonQuestion.findFirstOrThrow({
    where: { section: { classId, skill: 'GRAMMAR' } },
  });
  await instance.database.classSubmission.create({
    data: {
      classId,
      userId: identity.ownerId,
      overallScore: 0.3,
      passed: false,
      history: [],
      answers: {
        create: [
          {
            sectionId: priorQuestion.sectionId,
            questionId: priorQuestion.id,
            selectedIndex: 0,
            isCorrect: false,
          },
        ],
      },
    },
  });
  await instance.database.course.update({
    where: { id: cls.courseId },
    data: { activeClassId: classId },
  });
  const submission = { classId, assessmentId: fence.assessmentId, choices, execution };
  await expect(submitAssessment(submission)).rejects.toThrow();
  expect(
    await instance.database.classAssessmentSubmission.count({
      where: { assessmentId: fence.assessmentId },
    })
  ).toBe(0);
  expect(
    await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
  ).toMatchObject({ status: 'IN_PROGRESS' });
  const writing = captured.material.sections.find((section) => section.skill === 'WRITING');
  if (!writing || writing.skill !== 'WRITING') throw new Error('Writing assessment missing');
  let writingDispatches = 0;
  provider.generate.mockImplementation(async () => {
    const request = boundary.execution?.providerRequest;
    if (!request) throw new Error('Writing provider journal missing');
    const response = await request(
      new Request('https://provider.example/writing', {
        method: 'POST',
        body: 'submission fixture',
      }),
      async () => {
        writingDispatches += 1;
        return Response.json({ overallScore: 0.8, corrections: [], feedback: 'Bien.' });
      }
    );
    return { content: await response.text(), model: 'fixture' };
  });
  for (const prompt of writing.items) {
    const expected = await sottoTransaction(instance.database, (tx) =>
      captureAssessmentWritingTask(tx, { ...submission, promptId: prompt.id })
    );
    const text = `Ответ ${prompt.id}`;
    const admission = await sottoTransaction(instance.database, (tx) =>
      admitAssessmentWriting(tx, {
        ...submission,
        promptId: prompt.id,
        expected,
        text,
        selection: {
          provider: 'fixture',
          model: 'fixture',
          credentialFingerprint: null,
          moderationCredentialFingerprint: null,
        },
      })
    );
    await runAssessmentWriting({ admission, text, execution });
  }
  if (mode === 'submission_speaking_fail') {
    if (
      await checkSpeakingAssessmentSubmission({
        root,
        classId,
        identity,
        captured,
        fence,
        selectedMode,
        instance,
        cls,
        submitAssessment,
        submission,
      })
    )
      return;
  }
  await expect(submitAssessment({ ...submission, choices: choices.slice(1) })).rejects.toThrow();
  const scored = await instance.database.writingResponse.findFirstOrThrow({
    where: { promptId: writing.items[0]!.id, assessmentSectionId: writing.id },
  });
  await instance.database.writingResponse.update({
    where: { id: scored.id },
    data: { overallScore: 1 },
  });
  try {
    await expect(submitAssessment(submission)).rejects.toThrow();
    expect(
      await instance.database.classAssessmentSubmission.count({
        where: { assessmentId: fence.assessmentId },
      })
    ).toBe(0);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
    ).toMatchObject({ status: 'IN_PROGRESS' });
    expect(await instance.database.learnerReviewEvent.count({ where: { classId } })).toBe(0);
  } finally {
    await instance.database.writingResponse.update({
      where: { id: scored.id },
      data: { overallScore: scored.overallScore },
    });
  }
  const retainedPage = await instance.database.sidedoorState.findFirstOrThrow({
    where: { id: { startsWith: 'sd-js:1:', endsWith: `:${operation.id}:1` } },
  });
  const retainedState = retainedPage.state;
  if (!retainedState || typeof retainedState !== 'object' || Array.isArray(retainedState))
    throw new Error('Assessment history page missing');
  const retainedItems = retainedState.items;
  if (
    !Array.isArray(retainedItems) ||
    !retainedItems[0] ||
    typeof retainedItems[0] !== 'object' ||
    Array.isArray(retainedItems[0])
  )
    throw new Error('Assessment history chunk missing');
  const retainedChunk = retainedItems[0];
  if (typeof retainedChunk.data !== 'string') throw new Error('Assessment history data missing');
  await instance.database.sidedoorState.update({
    where: { id: retainedPage.id },
    data: {
      state: {
        ...retainedState,
        items: [{ ...retainedChunk, data: `A${retainedChunk.data.slice(1)}` }],
      },
    },
  });
  try {
    await expect(submitAssessment(submission)).rejects.toThrow();
    expect(
      await instance.database.classAssessmentSubmission.count({
        where: { assessmentId: fence.assessmentId },
      })
    ).toBe(0);
  } finally {
    await instance.database.sidedoorState.update({
      where: { id: retainedPage.id },
      data: { state: retainedState },
    });
  }
  await instance.database.classSubmission.update({
    where: { classId },
    data: { history: { unexpected: 'preserve this data' } },
  });
  await expect(submitAssessment(submission)).rejects.toThrow();
  expect(
    await instance.database.classSubmission.findUniqueOrThrow({ where: { classId } })
  ).toMatchObject({ history: { unexpected: 'preserve this data' } });
  expect(
    await instance.database.classAssessmentSubmission.count({
      where: { assessmentId: fence.assessmentId },
    })
  ).toBe(0);
  await instance.database.classSubmission.update({
    where: { classId },
    data: { history: [] },
  });
  const [first, replay] = await Promise.all([
    submitAssessment(submission),
    submitAssessment(submission),
  ]);
  expect(replay).toEqual(first);
  const practiceReview = await instance.database.learnerReviewEvent.findMany({
    where: { classId },
    orderBy: { sequence: 'asc' },
  });
  expect(practiceReview).toHaveLength(2);
  expect(practiceReview.every((event) => event.quality === 1)).toBe(true);
  for (const event of practiceReview) {
    const skill = event.vocabId ? 'READING' : 'GRAMMAR';
    expect(new Set(event.questionIds)).toEqual(
      new Set(
        formativeQuestions
          .filter((question) => question.skill === skill)
          .map((question) => question.id)
      )
    );
  }
  expect(
    await instance.database.learnerVocab.findUniqueOrThrow({
      where: { courseId_lemma: { courseId: cls.courseId, lemma: 'чай' } },
    })
  ).toMatchObject({ reps: 1 });
  expect(
    await instance.database.learnerGrammar.findUniqueOrThrow({
      where: { courseId_topicKey: { courseId: cls.courseId, topicKey: 'requests' } },
    })
  ).toMatchObject({ reps: 1 });
  const savedPractice = await instance.database.classSubmission.findUniqueOrThrow({
    where: { classId },
    include: { answers: true },
  });
  expect(savedPractice.answers).toHaveLength(formativeQuestions.length);
  expect(savedPractice.answers.every((answer) => answer.isCorrect)).toBe(true);
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL!).origin;
  const submitHttp = (token: string, submittedChoices: typeof choices, requestOrigin = origin) =>
    assessmentRoute.POST(
      new NextRequest(`${origin}/api/v1/classes/${classId}/assessment/${fence.assessmentId}`, {
        method: 'POST',
        headers: {
          cookie: `sotto_session=${token}`,
          origin: requestOrigin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ choices: submittedChoices }),
      }),
      { params: Promise.resolve({ classId, assessmentId: fence.assessmentId }) }
    );
  const httpReplay = await submitHttp(identity.ownerToken, [...choices].reverse());
  expect(httpReplay.status).toBe(200);
  expect(await httpReplay.json()).toEqual(first);
  expect((await submitHttp(other.token, choices)).status).toBe(409);
  expect((await submitHttp(identity.ownerToken, choices, 'https://untrusted.example')).status).toBe(
    403
  );
  const changedChoices = choices.map((choice, index) =>
    index === 0 ? { ...choice, selectedIndex: (choice.selectedIndex + 1) % 4 } : choice
  );
  expect((await submitHttp(identity.ownerToken, changedChoices)).status).toBe(409);
  expect(
    await instance.database.learnerReviewEvent.findMany({
      where: { classId },
      orderBy: { sequence: 'asc' },
    })
  ).toEqual(practiceReview);
  const writingStatusRoute =
    await import('@/app/api/v1/classes/[classId]/assessment/[assessmentId]/writing/[promptId]/route');
  const savedWriting = writing.items[0]!;
  const savedStatus = await writingStatusRoute.GET(
    new NextRequest(
      `${origin}/api/v1/classes/${classId}/assessment/${fence.assessmentId}/writing/${savedWriting.id}`,
      { headers: { cookie: `sotto_session=${identity.ownerToken}` } }
    ),
    {
      params: Promise.resolve({
        classId,
        assessmentId: fence.assessmentId,
        promptId: savedWriting.id,
      }),
    }
  );
  expect(savedStatus.status).toBe(200);
  expect(await savedStatus.json()).toEqual({
    status: 'COMPLETED',
    text: `Ответ ${savedWriting.id}`,
  });
  expect(await submitAssessment({ ...submission, choices: [...choices].reverse() })).toEqual(first);
  for (const changed of [
    { passed: !first.passed },
    { overallScore: first.overallScore === 1 ? 0 : 1 },
  ]) {
    await instance.database.classSubmission.update({ where: { classId }, data: changed });
    try {
      await expect(submitAssessment(submission)).rejects.toThrow();
    } finally {
      await instance.database.classSubmission.update({
        where: { classId },
        data: { passed: first.passed, overallScore: first.overallScore },
      });
    }
  }
  const cancelledSubmission = new AbortController();
  cancelledSubmission.abort();
  await expect(
    submitAssessment({
      ...submission,
      execution: { ...execution, signal: cancelledSubmission.signal },
    })
  ).rejects.toThrow();
  expect(first).toMatchObject({
    passed: mode === 'submission',
    totalSections: mode === 'submission_speaking_fail' ? 4 : 3,
    passedSections: mode === 'submission' ? 3 : mode === 'submission_speaking_fail' ? 3 : 2,
  });
  expect(writingDispatches).toBe(writing.items.length);
  expect(
    await instance.database.classAssessment.findUniqueOrThrow({
      where: { id: fence.assessmentId },
    })
  ).toMatchObject({ status: 'COMMITTED' });
  expect(
    await sottoTransaction(instance.database, (tx) =>
      verifyHistoricalAssessmentGeneration(tx, operation)
    )
  ).toBe(true);
  const { readVerifiedHistoricalAssessmentGeneration } =
    await import('@/lib/learning/classes/lifecycle/assessment-outcome');
  const history = await sottoTransaction(instance.database, (tx) =>
    readVerifiedHistoricalAssessmentGeneration(tx, operation)
  );
  expect(history).toMatchObject({
    priorAssessments: [],
    reviewSource: {
      lesson: { course: { nativeLang: 'es', targetLang: 'ru' } },
      prerequisite: null,
    },
  });
  const { readPriorAssessmentProjection } =
    await import('@/lib/learning/classes/history/assessment-prior-projection');
  const { exposedAssessmentTasks } =
    await import('@/lib/learning/classes/material/assessment-material');
  const predecessor = {
    operationId: operation.id,
    fingerprint: operation.fingerprint,
    assessmentId: fence.assessmentId,
    classId,
    courseId: cls.courseId,
    userId: identity.ownerId,
    classAttempt: fence.classAttempt,
    assessmentAttempt: fence.assessmentAttempt,
  };
  const projection = await sottoTransaction(instance.database, (tx) =>
    readPriorAssessmentProjection(tx, predecessor, 32 * 1024 * 1024)
  );
  expect(projection.tasks).toEqual(exposedAssessmentTasks(history.material));
  await expect(
    sottoTransaction(instance.database, (tx) =>
      readPriorAssessmentProjection(
        tx,
        { ...predecessor, userId: 'different-owner' },
        32 * 1024 * 1024
      )
    )
  ).rejects.toThrow();
  if (!history.reviewSource) throw new Error('Missing retained review source');
  const assessment = await instance.database.classAssessment.findUniqueOrThrow({
    where: { id: fence.assessmentId },
  });
  const { verifyHistoricalAssessmentReviewInput } =
    await import('@/lib/learning/classes/review/assessment-review-history');
  const verdict = {
    taught: true,
    independent: true,
    correct: true,
    unambiguous: true,
    appropriate: true,
    rubricsSound: true,
    answersConcealed: true,
    issues: [],
  };
  await expect(
    verifyHistoricalAssessmentReviewInput(
      fence,
      history,
      assessment.reviewReceipt,
      JSON.stringify(verdict)
    )
  ).resolves.toBeUndefined();
  await expect(
    verifyHistoricalAssessmentReviewInput(
      fence,
      history,
      assessment.reviewReceipt,
      JSON.stringify({ ...verdict, taught: false })
    )
  ).rejects.toThrow('Assessment did not pass independent review');
  await expect(
    verifyHistoricalAssessmentReviewInput(
      fence,
      {
        ...history,
        reviewSource: {
          ...history.reviewSource,
          lesson: {
            ...history.reviewSource.lesson,
            lesson: { ...history.reviewSource.lesson.lesson, title: 'Changed lesson' },
          },
        },
      },
      assessment.reviewReceipt
    )
  ).rejects.toThrow();
  const reviewCall = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
    where: { assessmentId: fence.assessmentId, stage: 'REVIEW', role: 'MODEL' },
  });
  await expect(
    instance.database.classAssessmentProviderCall.update({
      where: { id: reviewCall.id },
      data: { responseBytes: Buffer.from('changed review') },
    })
  ).rejects.toThrow('Sealed assessment material cannot change');
  await expect(
    sottoTransaction(instance.database, (tx) =>
      readVerifiedHistoricalAssessmentGeneration(tx, operation)
    )
  ).resolves.toMatchObject({ reviewSource: history.reviewSource });
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const page = await tx.sidedoorState.findFirstOrThrow({
        where: { id: { startsWith: 'sd-js:1:', endsWith: `:${operation.id}:1` } },
      });
      const state = page.state;
      if (!state || typeof state !== 'object' || Array.isArray(state))
        throw new Error('Assessment history page missing');
      const items = state.items;
      if (
        !Array.isArray(items) ||
        !items[0] ||
        typeof items[0] !== 'object' ||
        Array.isArray(items[0])
      )
        throw new Error('Assessment history chunk missing');
      const chunk = items[0];
      if (typeof chunk.data !== 'string') throw new Error('Assessment history data missing');
      await tx.sidedoorState.update({
        where: { id: page.id },
        data: {
          state: { ...state, items: [{ ...chunk, data: `A${chunk.data.slice(1)}` }] },
        },
      });
      await expect(verifyHistoricalAssessmentGeneration(tx, operation)).rejects.toThrow();
      throw new Error('Roll back altered assessment history');
    })
  ).rejects.toThrow('Roll back altered assessment history');
  const { captureFailedAssessmentReceipt } =
    await import('@/lib/learning/classes/history/assessment-failed-receipt');
  const failedReceipt = () =>
    sottoTransaction(instance.database, (tx) =>
      captureFailedAssessmentReceipt(tx, {
        classId,
        assessmentId: fence.assessmentId,
        execution,
      })
    );
  if (mode === 'submission_fail' || mode === 'submission_speaking_fail') {
    ({ relocatedSourcePath, migratedCopyId } = await checkFailedAssessmentSubmission({
      failedReceipt,
      fence,
      first,
      mode,
      instance,
      cls,
      identity,
      selectedMode,
      root,
      classId,
      execution,
      submitAssessment,
      submission,
      changedChoices,
      other,
      history,
      assessmentArchiveId,
      operation,
      priorQuestion,
      captureFailedAssessmentReceipt,
      scored,
    }));
  } else await expect(failedReceipt()).rejects.toThrow();
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.sidedoorState.delete({ where: { id: assessmentArchiveId(operation.id) } });
      await expect(verifyHistoricalAssessmentGeneration(tx, operation)).rejects.toThrow();
      throw new Error('Roll back missing historical proof');
    })
  ).rejects.toThrow('Roll back missing historical proof');
  const { assessmentFenceBackend, assessmentFenceStore } =
    await import('@/lib/learning/classes/lifecycle/assessment-fence');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await assessmentFenceStore(assessmentFenceBackend(tx, classId)).transact((state) => {
        state.current = null;
      });
      expect(await verifyHistoricalAssessmentGeneration(tx, operation)).toBe(true);
      await expect(recoverAssessmentOutcome(tx, operation)).rejects.toThrow();
      throw new Error('Roll back detached assessment fence');
    })
  ).rejects.toThrow('Roll back detached assessment fence');
  expect(
    await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } })
  ).toMatchObject({
    status: mode === 'submission' ? 'PASSED' : 'FAILED',
    writingDrafts: { private: 'PRIVATE_DRAFT' },
  });
  expect(
    await instance.database.course.findUniqueOrThrow({ where: { id: cls.courseId } })
  ).toMatchObject({ activeClassId: mode === 'submission' ? null : classId });
  expect(
    await instance.database.classAssessmentAnswer.count({
      where: { assessmentId: fence.assessmentId },
    })
  ).toBe(choices.length);
  expect(
    await instance.database.classAssessmentProductiveEvidence.count({
      where: { assessmentId: fence.assessmentId, writingResponseId: { not: null } },
    })
  ).toBe(writing.items.length);
  expect(
    await instance.database.classAssessmentProductiveEvidence.count({
      where: { assessmentId: fence.assessmentId, speakingRecordingId: { not: null } },
    })
  ).toBe(mode === 'submission_speaking_fail' ? 4 : 0);
  expect(
    await instance.database.classSubmission.findUniqueOrThrow({ where: { classId } })
  ).toMatchObject({
    history: [
      expect.objectContaining({
        answers: [expect.objectContaining({ questionId: priorQuestion.id, selectedIndex: 0 })],
      }),
    ],
  });
  await expect(
    submitAssessment({
      ...submission,
      choices: choices.map((choice, index) =>
        index === 0 ? { ...choice, selectedIndex: (choice.selectedIndex + 1) % 4 } : choice
      ),
    })
  ).rejects.toThrow();
  await expect(
    submitAssessment({ ...submission, execution: authorizedLearnerExecution(other.id) })
  ).rejects.toThrow();
  if (mode === 'submission') {
    await checkPassedAssessmentDeletion({
      root,
      instance,
      cls,
      identity,
      classId,
      operation,
      writing,
      other,
    });
  }
  if (mode === 'submission_speaking_fail') {
    const recordings = await instance.database.speakingRecording.findMany({
      where: { assessmentSection: { assessmentId: fence.assessmentId } },
      select: { id: true, audioUrl: true, assessmentAudioUrl: true },
    });
    const paths = recordings.map(({ audioUrl: original, assessmentAudioUrl }) => {
      const audioUrl = assessmentAudioUrl ?? original;
      if (!audioUrl.startsWith(`${LOCAL_STORAGE_URL_PREFIX}/`))
        throw new Error('Expected local speaking recording');
      return join(root, decodeURIComponent(audioUrl.slice(LOCAL_STORAGE_URL_PREFIX.length + 1)));
    });
    expect(paths).toHaveLength(selectedMode.startsWith('submission_speaking_retry') ? 5 : 4);
    for (const path of paths) expect((await readFile(path)).length).toBeGreaterThan(0);
    const { admitLearningStorageDeletion } =
      await import('@/lib/sidedoor/access/deletion/learning-deletion');
    const { runSottoStorageCleanup } =
      await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
    const { openSottoStorageConnection } =
      await import('@/lib/sidedoor/storage/core/storage-connection');
    const backend = await capturedLocalBackend(
      await LocalStorageCleanup.capture(root),
      root,
      LOCAL_STORAGE_URL_PREFIX,
      () => {}
    );
    const course = await instance.database.course.findUniqueOrThrow({
      where: { id: cls.courseId },
    });
    const profile = await instance.database.user.findUniqueOrThrow({
      where: { id: identity.ownerId },
    });
    const deletingProfile =
      selectedMode === 'submission_speaking_profile' ||
      selectedMode === 'submission_speaking_retry_profile';
    if (
      selectedMode === 'submission_speaking_class' ||
      selectedMode === 'submission_speaking_retry_class'
    ) {
      const unrelated = await instance.database.course.create({
        data: {
          id: classId,
          userId: other.id,
          curriculumId: course.curriculumId,
          nativeLang: course.nativeLang,
          targetLang: course.targetLang,
        },
      });
      const material = await instance.database.courseMaterial.create({
        data: {
          userId: other.id,
          courseId: unrelated.id,
          name: 'Unrelated document',
          mimeType: 'text/plain',
          byteSize: 4,
          extractedText: 'test',
        },
      });
      await expect(
        sottoTransaction(instance.database, (tx) =>
          admitLearningStorageDeletion({
            database: tx,
            scope: { kind: 'class', id: classId, episodeIds: [] },
            subjects: [{ subjectId: `class:${classId}`, generation: cls.createdAt.getTime() }],
            currentBackend: backend,
          })
        )
      ).rejects.toThrow(/speaking audio that requires complete media cleanup/);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: classId } })
      ).not.toBeNull();
      await instance.database.speakingRecording.deleteMany({
        where: { prompt: { section: { classId } } },
      });
      const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
      const cleanup = vi
        .spyOn(runtime, 'runSottoStorageCleanup')
        .mockRejectedValueOnce(new Error('Simulated cleanup interruption'))
        .mockImplementation((database, jobId, options) =>
          runSottoStorageCleanup(database, jobId, {
            ...options,
            openConnection: () =>
              openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
          })
        );
      try {
        const { deleteClassForUser } = await import('@/lib/class-service');
        expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
        expect(
          await instance.database.courseClass.findUnique({ where: { id: classId } })
        ).toBeNull();
        for (const path of paths) expect((await readFile(path)).length).toBeGreaterThan(0);
        expect(
          await deleteClassForUser(classId, other.id, authorizedLearnerExecution(other.id))
        ).toBe(false);
        expect(await deleteClassForUser(classId, identity.ownerId, execution)).toBe(true);
        expect(
          await instance.database.course.findUnique({ where: { id: course.id } })
        ).not.toBeNull();
        expect(
          await instance.database.courseMaterial.findUnique({
            where: { id: material.id },
          })
        ).not.toBeNull();
      } finally {
        cleanup.mockRestore();
      }
    } else if (selectedMode === 'submission_speaking_reset') {
      const avatarKey = `avatars/${profile.id}/${randomUUID()}.png`;
      const avatar = await backend.writeBuffer(avatarKey, Buffer.from('avatar'), 'image/png');
      await sottoTransaction(instance.database, async (tx) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
          registered
        );
        await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
          consumers: [{ consumer: `profile:${profile.id}:avatar`, previousReference: null }],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: avatar,
            localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
            target: {
              backendId: registered.id,
              binding: registered.binding,
              key: avatarKey,
            },
            scopes: [
              {
                subjectId: `profile:${profile.id}`,
                generation: profile.createdAt.getTime(),
              },
            ],
          }),
        });
        await tx.user.update({ where: { id: profile.id }, data: { image: avatar } });
      });
      const runtime = await import('@/lib/sidedoor/storage/migration/storage-cleanup-runtime');
      const cleanup = vi
        .spyOn(runtime, 'runSottoStorageCleanup')
        .mockImplementation((database, jobId, options) =>
          runSottoStorageCleanup(database, jobId, {
            ...options,
            openConnection: () =>
              openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
          })
        );
      try {
        const { factoryReset } = await import('@/lib/admin/factory-reset');
        const result = await factoryReset();
        expect(result.cleanupPendingJobs).toBe(0);
        expect(
          await instance.database.user.findUnique({ where: { id: profile.id } })
        ).toMatchObject({ image: avatar });
        expect(await readFile(join(root, avatarKey), 'utf8')).toBe('avatar');
      } finally {
        cleanup.mockRestore();
      }
    } else {
      const jobs = await sottoTransaction(instance.database, async (tx) => {
        const admitted = await admitLearningStorageDeletion({
          database: tx,
          scope: deletingProfile
            ? { kind: 'profile', id: profile.id }
            : { kind: 'course', id: course.id, episodeIds: [] },
          subjects: [
            deletingProfile
              ? {
                  subjectId: `profile:${profile.id}`,
                  generation: profile.createdAt.getTime(),
                }
              : {
                  subjectId: `course:${course.id}`,
                  generation: course.createdAt.getTime(),
                },
          ],
          currentBackend: backend,
        });
        if (deletingProfile) await tx.user.delete({ where: { id: profile.id } });
        else await tx.course.delete({ where: { id: course.id } });
        return admitted;
      });
      if (
        selectedMode === 'submission_speaking_interrupted' ||
        selectedMode === 'submission_speaking_cancelled' ||
        selectedMode === 'submission_speaking_lock_loss'
      ) {
        const cancellation = new AbortController();
        let backendPid: number | undefined;
        let reportLoss!: () => void;
        const lockLost = new Promise<void>((resolve) => {
          reportLoss = resolve;
        });
        const storage = await import('@/lib/r2');
        const captureCleanup = storage.captureStorageCleanup;
        const interrupted = vi
          .spyOn(storage, 'captureStorageCleanup')
          .mockImplementation(async (descriptor) => {
            const cleanup = await captureCleanup(descriptor);
            return new Proxy(cleanup, {
              get(target, property, receiver) {
                if (property === 'delete')
                  return async (...args: Parameters<typeof target.delete>) => {
                    await target.delete(...args);
                    if (selectedMode === 'submission_speaking_cancelled') cancellation.abort();
                    if (selectedMode === 'submission_speaking_lock_loss') {
                      if (backendPid === undefined) throw new Error('Missing backend PID');
                      const { Client } = await import('pg');
                      const controller = new Client({
                        connectionString: process.env.SIDEDOOR_TEST_DATABASE_URL,
                      });
                      try {
                        await controller.connect();
                        await controller.query('SELECT pg_terminate_backend($1)', [backendPid]);
                        await lockLost;
                      } finally {
                        await controller.end();
                      }
                    }
                    throw new Error('Simulated interruption after file deletion');
                  };
                const value: unknown = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          });
        try {
          await expect(
            runSottoStorageCleanup(instance.database, jobs[0]!.id, {
              signal: cancellation.signal,
              openConnection: async () => {
                const connection = await openSottoStorageConnection(
                  process.env.SIDEDOOR_TEST_DATABASE_URL,
                  instance.schema
                );
                if (selectedMode !== 'submission_speaking_lock_loss') return connection;
                const rows = await connection.query('SELECT pg_backend_pid() AS pid', []);
                if (typeof rows[0]?.pid !== 'number') throw new Error('Missing backend PID');
                backendPid = rows[0].pid;
                return {
                  ...connection,
                  onLoss: (listener) =>
                    connection.onLoss((error) => {
                      listener(error);
                      reportLoss();
                    }),
                };
              },
            })
          ).rejects.toThrow('Simulated interruption after file deletion');
        } finally {
          interrupted.mockRestore();
        }
        const remaining = await Promise.all(
          paths.map((path) =>
            stat(path).then(
              () => true,
              () => false
            )
          )
        );
        expect(remaining.filter(Boolean)).toHaveLength(3);
        if (
          selectedMode === 'submission_speaking_cancelled' ||
          selectedMode === 'submission_speaking_lock_loss'
        ) {
          await expect(
            runSottoStorageCleanup(instance.database, jobs[0]!.id, {
              openConnection: () =>
                openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
            })
          ).rejects.toThrow('Backend has an unresolved cleanup execution');
          return;
        }
      }
      for (const job of jobs)
        await runSottoStorageCleanup(instance.database, job.id, {
          openConnection: () =>
            openSottoStorageConnection(process.env.SIDEDOOR_TEST_DATABASE_URL, instance.schema),
        });
    }
    for (const path of paths)
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    if (relocatedSourcePath)
      await expect(readFile(relocatedSourcePath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    if (migratedCopyId) {
      const copyId = migratedCopyId;
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(copyId))
      ).toMatchObject({ status: 'erased', handler: 'storage-migration-copy' });
    }
  }
  return;
}
