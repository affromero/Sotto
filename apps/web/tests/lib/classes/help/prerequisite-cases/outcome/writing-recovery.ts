import { expect, vi, type Mock } from 'vitest';
import { createHash } from 'node:crypto';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import type { admitAssessmentWriting } from '@/lib/learning/classes/writing/assessment-writing-admission';
import type { captureAssessmentWritingTask } from '@/lib/learning/classes/writing/assessment-writing-read';
import type { captureAssessmentForEvaluation } from '@/lib/learning/classes/material/assessment-read';

interface WritingRecoveryContext {
  provider: { generate: Mock };
  writingAdmission: Awaited<ReturnType<typeof admitAssessmentWriting>>;
  writingCapture: Awaited<ReturnType<typeof captureAssessmentWritingTask>>;
  boundary: { execution: SottoProviderExecution | null };
  execution: SottoProviderExecution;
  instance: SharedTestInstance;
  fence: ReturnType<typeof assessmentWorkSchema.parse>['fence'];
  heldOutWriting: Awaited<ReturnType<typeof captureAssessmentWritingTask>>['prompt'];
  readWritingHttp: (token: string, promptId?: string) => Promise<Response>;
  identity: SharedTestIdentity;
  writingSection: Extract<
    Awaited<ReturnType<typeof captureAssessmentForEvaluation>>['material']['sections'][number],
    { skill: 'WRITING' }
  >;
  captured: Awaited<ReturnType<typeof captureAssessmentForEvaluation>>;
  writingTask: (
    promptId: string,
    learnerId?: string
  ) => ReturnType<typeof captureAssessmentWritingTask>;
  admitAssessmentWriting: typeof admitAssessmentWriting;
  classId: string;
  selection: Parameters<typeof admitAssessmentWriting>[1]['selection'];
}

export async function checkAssessmentWritingRecovery({
  provider,
  writingAdmission,
  writingCapture,
  boundary,
  execution,
  instance,
  fence,
  heldOutWriting,
  readWritingHttp,
  identity,
  writingSection,
  captured,
  writingTask,
  admitAssessmentWriting,
  classId,
  selection,
}: WritingRecoveryContext) {
  let gradingDispatches = 0;
  const { runAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-run');
  const promptLoader = await import('@/lib/prompt-loader');
  const originalRender = promptLoader.loadAndRender;
  const changedPrompt = vi
    .spyOn(promptLoader, 'loadAndRender')
    .mockImplementation(
      (path, vars) => `${originalRender(path, vars)}\nChanged grading instruction.`
    );
  const callsBeforeChange = provider.generate.mock.calls.length;
  try {
    await expect(
      runAssessmentWriting({
        admission: writingAdmission,
        text: 'Пожалуйста, вода.',
        execution,
      })
    ).rejects.toThrow();
    expect(provider.generate.mock.calls.length).toBe(callsBeforeChange);
  } finally {
    changedPrompt.mockRestore();
  }
  let startedGrading!: () => void;
  let releaseGrading!: () => void;
  const gradingStarted = new Promise<void>((resolve) => {
    startedGrading = resolve;
  });
  const gradingRelease = new Promise<void>((resolve) => {
    releaseGrading = resolve;
  });
  provider.generate.mockImplementationOnce(
    async (system: string, messages: Array<{ content: string }>) => {
      expect(system).toContain(writingCapture.prompt.privateRubric);
      expect(JSON.parse(messages[0]!.content)).toEqual({
        task: writingCapture.prompt.task,
        response: 'Пожалуйста, вода.',
      });
      const providerRequest = boundary.execution?.providerRequest;
      if (!providerRequest) throw new Error('Writing provider journal missing');
      const result = await providerRequest(
        new Request('https://provider.example/writing', {
          method: 'POST',
          body: 'fixture',
        }),
        async () => {
          gradingDispatches += 1;
          startedGrading();
          await gradingRelease;
          return Response.json({
            overallScore: 0.75,
            corrections: [],
            feedback: 'Buen trabajo.',
          });
        }
      );
      return { content: await result.text(), model: 'fixture' };
    }
  );
  const { reconcileWritingResponse } = await import('@/lib/learning/writing/writing-execution');
  let staleReady!: () => void;
  let releaseStale!: () => void;
  const staleStarted = new Promise<void>((resolve) => {
    staleReady = resolve;
  });
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const staleReconciliation = instance.database
    .$transaction(
      async (tx) => {
        await tx.writingResponse.findUniqueOrThrow({
          where: { id: writingAdmission!.responseId },
        });
        staleReady();
        await staleGate;
        await reconcileWritingResponse(
          tx,
          writingAdmission!.responseId,
          writingAdmission!.operation
        );
      },
      { isolationLevel: 'Serializable', timeout: 30000 }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await staleStarted;
  const grading = runAssessmentWriting({
    admission: writingAdmission,
    text: 'Пожалуйста, вода.',
    execution,
  });
  await Promise.race([
    gradingStarted,
    grading.then(() => {
      throw new Error('Writing completed before provider barrier');
    }),
  ]).catch((error: unknown) => {
    releaseStale();
    releaseGrading();
    throw error;
  });
  let duplicate: Promise<unknown> | undefined;
  try {
    releaseStale();
    expect(isSerializationConflict(await staleReconciliation)).toBe(true);
    const { captureAssessmentWritingEvidence } =
      await import('@/lib/learning/classes/writing/assessment-writing-evidence');
    await expect(
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentWritingEvidence(tx, {
          classId,
          assessmentId: fence.assessmentId,
          promptId: heldOutWriting.id,
          execution,
        })
      )
    ).rejects.toThrow();
    duplicate = runAssessmentWriting({
      admission: writingAdmission,
      text: 'Пожалуйста, вода.',
      execution,
    }).then(
      () => null,
      (error: unknown) => error
    );
  } finally {
    releaseGrading();
  }
  await grading;
  expect(await duplicate).toBeInstanceOf(Error);
  expect(gradingDispatches).toBe(1);
  expect(
    await instance.database.writingResponse.findUniqueOrThrow({
      where: { id: writingAdmission.responseId },
    })
  ).toMatchObject({
    overallScore: 0.75,
    gradingState: { status: 'COMPLETED' },
  });
  const { readAssessmentWritingRecovery } =
    await import('@/lib/learning/classes/writing/assessment-writing-recovery');
  expect(
    await sottoTransaction(instance.database, (tx) =>
      readAssessmentWritingRecovery(tx, {
        classId,
        assessmentId: fence.assessmentId,
        promptId: heldOutWriting.id,
        execution,
      })
    )
  ).toMatchObject({ status: 'COMPLETED' });
  const writingStatus = await readWritingHttp(identity.ownerToken);
  expect(writingStatus.headers.get('cache-control')).toBe('private, no-store');
  expect(await writingStatus.json()).toEqual({
    status: 'COMPLETED',
    text: 'Пожалуйста, вода.',
  });
  const { captureAssessmentWritingEvidence } =
    await import('@/lib/learning/classes/writing/assessment-writing-evidence');
  const evidenceInput = {
    classId,
    assessmentId: fence.assessmentId,
    promptId: heldOutWriting.id,
    execution,
  };
  const evidence = await sottoTransaction(instance.database, (tx) =>
    captureAssessmentWritingEvidence(tx, evidenceInput)
  );
  expect(
    await Promise.all([
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentWritingEvidence(tx, evidenceInput)
      ),
      sottoTransaction(instance.database, (tx) =>
        captureAssessmentWritingEvidence(tx, evidenceInput)
      ),
    ])
  ).toEqual([evidence, evidence]);
  expect(evidence.evidence).toMatchObject({
    assessmentId: fence.assessmentId,
    itemId: heldOutWriting.id,
    sectionId: writingSection.id,
    operationId: writingAdmission.operation.id,
    score: 0.75,
    status: 'SCORED',
  });
  const changedAfterGrading = vi
    .spyOn(promptLoader, 'loadAndRender')
    .mockImplementation((path, vars) => `${originalRender(path, vars)}\nChanged after grading.`);
  try {
    expect(
      await sottoTransaction(instance.database, (tx) =>
        captureAssessmentWritingEvidence(tx, evidenceInput)
      )
    ).toEqual(evidence);
  } finally {
    changedAfterGrading.mockRestore();
  }
  const { evaluateAssessmentMaterial } =
    await import('@/lib/learning/classes/material/assessment-material');
  const completeChoices = captured.material.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      'correctIndex' in item ? [{ itemId: item.id, selectedIndex: item.correctIndex }] : []
    )
  );
  expect(
    evaluateAssessmentMaterial(captured.material, captured.scope, completeChoices, [
      evidence.evidence,
    ])
  ).toMatchObject({ complete: false, mastered: false });
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.writingResponse.update({
        where: { id: writingAdmission!.responseId },
        data: { overallScore: 1 },
      });
      expect(await readAssessmentWritingRecovery(tx, evidenceInput)).toMatchObject({
        status: 'UNRESOLVED',
      });
      await expect(captureAssessmentWritingEvidence(tx, evidenceInput)).rejects.toThrow();
      throw new Error('Roll back forged writing score');
    })
  ).rejects.toThrow('Roll back forged writing score');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const prefix = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
      await tx.sidedoorState.delete({
        where: { id: `sd-js:1:${prefix}:${writingAdmission!.operation.id}:0` },
      });
      expect(await readAssessmentWritingRecovery(tx, evidenceInput)).toMatchObject({
        status: 'UNRESOLVED',
        text: 'Пожалуйста, вода.',
      });
      await expect(captureAssessmentWritingEvidence(tx, evidenceInput)).rejects.toThrow();
      throw new Error('Roll back missing writing receipt');
    })
  ).rejects.toThrow('Roll back missing writing receipt');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const prefix = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
      const id = `sd-js:1:${prefix}:${writingAdmission!.operation.id}:meta`;
      const metadata = await tx.sidedoorState.findUniqueOrThrow({ where: { id } });
      if (!metadata.state || typeof metadata.state !== 'object' || Array.isArray(metadata.state))
        throw new Error('Writing receipt metadata missing');
      await tx.sidedoorState.update({
        where: { id },
        data: { state: { ...metadata.state, sealed: false } },
      });
      expect(await readAssessmentWritingRecovery(tx, evidenceInput)).toMatchObject({
        status: 'UNRESOLVED',
        text: 'Пожалуйста, вода.',
      });
      await expect(captureAssessmentWritingEvidence(tx, evidenceInput)).rejects.toThrow();
      throw new Error('Roll back unsealed writing receipt');
    })
  ).rejects.toThrow('Roll back unsealed writing receipt');
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      const prefix = createHash('sha256').update(SIDEDOOR_STATE_ID).digest('hex');
      const id = `sd-js:1:${prefix}:${writingAdmission!.operation.id}:0`;
      const page = await tx.sidedoorState.findUniqueOrThrow({ where: { id } });
      if (
        !page.state ||
        typeof page.state !== 'object' ||
        Array.isArray(page.state) ||
        !Array.isArray(page.state.items)
      )
        throw new Error('Writing receipt page missing');
      await tx.sidedoorState.update({
        where: { id },
        data: {
          state: {
            ...page.state,
            items: [{ ...evidence.receipt, requestDigest: 'a'.repeat(64) }],
          },
        },
      });
      await expect(captureAssessmentWritingEvidence(tx, evidenceInput)).rejects.toThrow();
      throw new Error('Roll back altered writing request digest');
    })
  ).rejects.toThrow('Roll back altered writing request digest');
  await expect(
    runAssessmentWriting({
      admission: writingAdmission,
      text: 'Пожалуйста, вода.',
      execution,
    })
  ).rejects.toThrow();
  expect(gradingDispatches).toBe(1);
  const nextPrompt = writingSection.items[1];
  if (!nextPrompt) throw new Error('Second held-out writing prompt missing');
  const nextCapture = await writingTask(nextPrompt.id);
  const nextAdmission = await sottoTransaction(instance.database, (tx) =>
    admitAssessmentWriting(tx, {
      classId,
      assessmentId: fence.assessmentId,
      promptId: nextPrompt.id,
      text: 'Мой ответ.',
      execution,
      selection,
      expected: nextCapture,
    })
  );
  let failedDispatches = 0;
  provider.generate.mockImplementationOnce(async () => {
    const providerRequest = boundary.execution?.providerRequest;
    if (!providerRequest) throw new Error('Writing provider journal missing');
    const result = await providerRequest(
      new Request('https://provider.example/writing', {
        method: 'POST',
        body: 'invalid fixture',
      }),
      async () => {
        failedDispatches += 1;
        return new Response('not a grade');
      }
    );
    return { content: await result.text(), model: 'fixture' };
  });
  const failedRuns = await Promise.allSettled([
    runAssessmentWriting({ admission: nextAdmission, text: 'Мой ответ.', execution }),
    runAssessmentWriting({ admission: nextAdmission, text: 'Мой ответ.', execution }),
  ]);
  expect(failedRuns.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(failedDispatches).toBe(1);
  expect(
    await instance.database.sidedoorState.findUnique({
      where: {
        id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${nextAdmission.operation.id}`,
      },
    })
  ).not.toBeNull();
  const lastPrompt = writingSection.items[2];
  if (!lastPrompt) throw new Error('Third held-out writing prompt missing');
  const lastCapture = await writingTask(lastPrompt.id);
  const lastAdmission = await sottoTransaction(instance.database, (tx) =>
    admitAssessmentWriting(tx, {
      classId,
      assessmentId: fence.assessmentId,
      promptId: lastPrompt.id,
      text: 'Ответ.',
      execution,
      selection,
      expected: lastCapture,
      queued: true,
    })
  );
  let lastStarted!: () => void;
  let releaseLast!: () => void;
  const lastReady = new Promise<void>((resolve) => {
    lastStarted = resolve;
  });
  const lastGate = new Promise<void>((resolve) => {
    releaseLast = resolve;
  });
  provider.generate.mockImplementationOnce(async () => {
    const providerRequest = boundary.execution?.providerRequest;
    if (!providerRequest) throw new Error('Writing provider journal missing');
    const result = await providerRequest(
      new Request('https://provider.example/writing', {
        method: 'POST',
        body: 'stale fixture',
      }),
      async () => {
        lastStarted();
        await lastGate;
        return Response.json({ overallScore: 1, corrections: [], feedback: 'Bien.' });
      }
    );
    return { content: await result.text(), model: 'fixture' };
  });
  await expect(
    runAssessmentWriting({ admission: lastAdmission, text: 'Ответ.', execution })
  ).rejects.toThrow();
  const { runQueuedAssessmentWriting } =
    await import('@/lib/learning/classes/writing/assessment-writing-run');
  const queuedJob = {
    id: lastAdmission.operation.id,
    name: 'learning-writing.v3',
    data: {
      operationId: lastAdmission.operation.id,
      fingerprint: lastAdmission.operation.fingerprint,
    },
  } as import('bullmq').Job<unknown>;
  const staleGrade = runQueuedAssessmentWriting(queuedJob);
  await Promise.race([
    lastReady,
    staleGrade.then(() => {
      throw new Error('Writing completed before source change');
    }),
  ]).catch((error: unknown) => {
    releaseLast();
    throw error;
  });
  try {
    await instance.database.classSection.updateMany({
      where: { classId, skill: 'GRAMMAR' },
      data: { seed: 'changed after assessment review' },
    });
  } finally {
    releaseLast();
  }
  await expect(staleGrade).rejects.toThrow();
  expect(
    await instance.database.writingResponse.findUniqueOrThrow({
      where: { id: lastAdmission.responseId },
    })
  ).toMatchObject({
    overallScore: null,
    gradingState: { status: 'UNRESOLVED' },
  });
}
