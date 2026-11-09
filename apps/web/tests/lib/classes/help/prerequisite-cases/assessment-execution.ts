import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  sottoJobExecutions,
  withSottoJobExecution,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { captureAssessmentGenerationSource } from '@/lib/learning/classes/material/assessment-source';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import { assessmentWorkSchema } from '@/lib/learning/classes/lifecycle/assessment-fence';
import {
  requireAssessmentExecutionAdmission,
  requirePendingAssessmentWork,
  startAssessmentWork,
} from '@/lib/learning/classes/generation/assessment-work';
import { stageAssessmentSection } from '@/lib/learning/classes/generation/assessment-draft';
import {
  captureAssessmentSettlementAuthority,
  markAssessmentUnresolved,
} from '@/lib/learning/classes/lifecycle/assessment-unresolved';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { assessmentProviderRequest } from '@/lib/learning/classes/provider/assessment-provider-request';
import {
  admitAssessmentProviderCall,
  prepareAssessmentProviderCall,
  readAssessmentProviderCall,
  settleAssessmentProviderCall,
} from '@/lib/learning/classes/provider/assessment-provider-journal';

export function registerAssessmentExecutionCase(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
    questionId: string;
  }
) {
  it('captures a reviewed base lesson for its owning learner after acknowledgment', async () => {
    const { instance, identity, classId, questionId } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const materialHash = await sottoTransaction(instance.database, (tx) =>
      initialA1MaterialHash(tx, classId, identity.ownerId)
    );
    const receiptId = randomUUID();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          version: 1,
          receiptId,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
          materialHash,
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    const source = await sottoTransaction(instance.database, (tx) =>
      captureAssessmentGenerationSource(tx, authorizedLearnerExecution(identity.ownerId), {
        classId,
        classAttempt: cls.attempt,
      })
    );
    expect(source).toMatchObject({
      teachingReceipt: { kind: 'BASE', receiptId },
      prerequisite: null,
    });
    expect(source.requirements.level).toBe('A1');
    expect(source.thresholds).toEqual({ GRAMMAR: 0.7, READING: 0.7, WRITING: 0.7 });
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_GUIDED_ANSWER');
    const admission = {
      id: randomUUID(),
      revision: randomUUID(),
      assessmentId: randomUUID(),
      classId,
      classAttempt: cls.attempt,
      assessmentAttempt: 1,
      expiresAt: Date.now() + 60_000,
      selection: {
        provider: 'fixture',
        model: 'fixture',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      execution: authorizedLearnerExecution(identity.ownerId),
    };
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        await admitAssessmentWork(tx, admission);
        throw new Error('rollback admission');
      })
    ).rejects.toThrow('rollback admission');
    expect(
      await instance.database.classAssessment.findUnique({ where: { id: admission.assessmentId } })
    ).toBeNull();
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(admission.id))
    ).toBeNull();
    const record = await sottoTransaction(instance.database, (tx) =>
      admitAssessmentWork(tx, admission)
    );
    const { fence } = assessmentWorkSchema.parse(record.job.payload);
    expect(fence).toMatchObject({
      assessmentId: admission.assessmentId,
      teachingReceipt: source.teachingReceipt,
    });
    const assessment = await instance.database.classAssessment.findUniqueOrThrow({
      where: { id: admission.assessmentId },
      include: { sections: true },
    });
    expect(assessment.sections.map((section) => section.skill).sort()).toEqual([
      'GRAMMAR',
      'READING',
      'WRITING',
    ]);
    await sottoTransaction(instance.database, (tx) =>
      learningPreparationGrant(tx, fence, 'assessment').validate(fence.grant)
    );
    const replay = await sottoTransaction(instance.database, (tx) =>
      admitAssessmentWork(tx, {
        ...admission,
        id: randomUUID(),
        revision: randomUUID(),
        assessmentId: randomUUID(),
      })
    );
    expect(replay.job.id).toBe(record.job.id);
    const operationIdentity = { id: record.job.id, fingerprint: record.fingerprint };
    const raceAdmission = async (mutate: () => Promise<unknown>) => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const blockedExecution = {
        ...admission.execution,
        authorize: async (tx: Prisma.TransactionClient) => {
          await tx.user.findUniqueOrThrow({
            where: { id: identity.ownerId },
            select: { id: true },
          });
          started();
          await gate;
          return { userId: identity.ownerId };
        },
      };
      const stale = instance.database
        .$transaction(
          (tx) => requireAssessmentExecutionAdmission(tx, operationIdentity, blockedExecution),
          { isolationLevel: 'Serializable', timeout: 15000 }
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      await ready;
      try {
        await mutate();
      } finally {
        release();
      }
      expect(isSerializationConflict(await stale)).toBe(true);
    };
    await expect(
      instance.database.$transaction((tx) =>
        requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
      )
    ).rejects.toThrow('Assessment execution admission requires a Serializable transaction');
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
        )
      ).current.status
    ).toBe('QUEUED');
    await raceAdmission(() =>
      sottoTransaction(instance.database, (tx) =>
        startAssessmentWork(tx, operationIdentity, admission.execution)
      )
    );
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
        )
      ).current.status
    ).toBe('RUNNING');
    const running = await sottoTransaction(instance.database, (tx) =>
      requirePendingAssessmentWork(tx, operationIdentity, admission.execution, 'RUNNING')
    );
    expect(running.current.status).toBe('RUNNING');
    const providerContext = {
      identity: operationIdentity,
      execution: admission.execution,
      stage: 'AUTHOR_GRAMMAR' as const,
      ordinal: 0,
      role: 'MODEL' as const,
      inputDigest: 'a'.repeat(64),
    };
    const attempt = { id: randomUUID(), fingerprint: 'b'.repeat(64) };
    await sottoTransaction(instance.database, (tx) =>
      prepareAssessmentProviderCall(tx, providerContext)
    );
    await raceAdmission(async () => {
      expect(
        await sottoTransaction(instance.database, (tx) =>
          admitAssessmentProviderCall(tx, providerContext, attempt)
        )
      ).toMatchObject({ dispatch: true });
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
      )
    ).rejects.toThrow();
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { explanation: 'Changed while request was in flight' },
    });
    const body = Buffer.from('{"result":"private"}');
    const receipt = {
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as [string, string][],
      bodyBase64: body.toString('base64'),
      bodySha256: createHash('sha256').update(body).digest('hex'),
    };
    await expect(
      sottoTransaction(instance.database, (tx) =>
        settleAssessmentProviderCall(tx, providerContext, attempt, 'succeeded', {
          ...receipt,
          bodySha256: 'f'.repeat(64),
        })
      )
    ).rejects.toThrow('response receipt content changed');
    expect(
      await instance.database.classAssessmentProviderCall.findUniqueOrThrow({
        where: {
          assessmentId_stage_ordinal: {
            assessmentId: admission.assessmentId,
            stage: 'AUTHOR_GRAMMAR',
            ordinal: 0,
          },
        },
      })
    ).toMatchObject({ status: 'DISPATCHING', responseBytes: null });
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentProviderCall(tx, providerContext, attempt, 'succeeded', receipt)
    );
    await expect(
      sottoTransaction(instance.database, (tx) => readAssessmentProviderCall(tx, providerContext))
    ).rejects.toThrow();
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { explanation: 'PRIVATE_ASSESSMENT_EXPLANATION' },
    });
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentProviderCall(tx, providerContext, attempt, 'succeeded', receipt)
    );
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
        )
      ).current.status
    ).toBe('RUNNING');
    expect(
      await sottoTransaction(instance.database, (tx) =>
        readAssessmentProviderCall(tx, providerContext)
      )
    ).toEqual({ status: 'SUCCEEDED', receipt, attemptFingerprint: attempt.fingerprint });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitAssessmentProviderCall(tx, providerContext, {
          id: randomUUID(),
          fingerprint: attempt.fingerprint,
        })
      )
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        prepareAssessmentProviderCall(tx, { ...providerContext, inputDigest: 'c'.repeat(64) })
      )
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        prepareAssessmentProviderCall(tx, { ...providerContext, ordinal: 2 })
      )
    ).rejects.toThrow(/already active/);
    const secondCall = { ...providerContext, ordinal: 1 };
    const secondAttempt = { id: randomUUID(), fingerprint: 'f'.repeat(64) };
    await sottoTransaction(instance.database, (tx) =>
      prepareAssessmentProviderCall(tx, secondCall)
    );
    await sottoTransaction(instance.database, (tx) =>
      admitAssessmentProviderCall(tx, secondCall, secondAttempt)
    );
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentProviderCall(tx, secondCall, secondAttempt, 'failed', {
        ...receipt,
        status: 429,
        statusText: 'Too Many Requests',
      })
    );
    expect(
      await sottoTransaction(instance.database, (tx) => readAssessmentProviderCall(tx, secondCall))
    ).toMatchObject({ status: 'FAILED', attemptFingerprint: secondAttempt.fingerprint });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        prepareAssessmentProviderCall(tx, {
          ...providerContext,
          ordinal: 2,
          inputDigest: 'c'.repeat(64),
        })
      )
    ).rejects.toThrow(/already active/);
    let dispatched = 0;
    let unresolved = false;
    const providerInput = {
      identity: operationIdentity,
      execution: admission.execution,
      stage: 'AUTHOR_WRITING' as const,
      inputDigest: '1'.repeat(64),
      selection: admission.selection,
      signal: new AbortController().signal,
      unresolved: () => {
        unresolved = true;
      },
    };
    const send = async (step: string) => {
      dispatched += 1;
      return new Response(JSON.stringify({ step }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const makeRequest = (step: string) =>
      new Request('https://provider.example.test/model', {
        method: 'POST',
        body: JSON.stringify({ step }),
      });
    const originalProviderRequest = assessmentProviderRequest(providerInput);
    expect(
      await (
        await originalProviderRequest(makeRequest('moderation'), () => send('moderation'))
      ).json()
    ).toEqual({ step: 'moderation' });
    expect(
      await (await originalProviderRequest(makeRequest('model'), () => send('model'))).json()
    ).toEqual({ step: 'model' });
    const resumedProviderRequest = assessmentProviderRequest(providerInput);
    expect(
      await (
        await resumedProviderRequest(makeRequest('moderation'), () => send('unexpected'))
      ).json()
    ).toEqual({ step: 'moderation' });
    expect(
      await (await resumedProviderRequest(makeRequest('model'), () => send('unexpected'))).json()
    ).toEqual({ step: 'model' });
    expect(dispatched).toBe(2);
    expect(unresolved).toBe(false);
    const offlineProviderRequest = assessmentProviderRequest({
      ...providerInput,
      replayOnly: true,
    });
    expect(
      await (
        await offlineProviderRequest(makeRequest('moderation'), () => send('unexpected'))
      ).json()
    ).toEqual({ step: 'moderation' });
    expect(
      await (await offlineProviderRequest(makeRequest('model'), () => send('unexpected'))).json()
    ).toEqual({ step: 'model' });
    await expect(
      offlineProviderRequest(makeRequest('missing'), () => send('unexpected'))
    ).rejects.toThrow();
    expect(
      await instance.database.classAssessmentProviderCall.count({
        where: { assessmentId: admission.assessmentId, stage: 'AUTHOR_WRITING' },
      })
    ).toBe(2);
    expect(dispatched).toBe(2);
    await expect(
      assessmentProviderRequest(providerInput)(makeRequest('changed'), () => send('unexpected'))
    ).rejects.toThrow(/already active/);
    expect(dispatched).toBe(2);
    expect(unresolved).toBe(true);
    const uncertain = { ...providerContext, stage: 'AUTHOR_READING' as const };
    const uncertainAttempt = { id: randomUUID(), fingerprint: 'd'.repeat(64) };
    await sottoTransaction(instance.database, (tx) => prepareAssessmentProviderCall(tx, uncertain));
    await sottoTransaction(instance.database, (tx) =>
      admitAssessmentProviderCall(tx, uncertain, uncertainAttempt)
    );
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentProviderCall(tx, uncertain, uncertainAttempt, 'unknown')
    );
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requireAssessmentExecutionAdmission(tx, operationIdentity, admission.execution)
      )
    ).rejects.toThrow();
    const replayUnknown = assessmentProviderRequest({
      ...providerInput,
      stage: 'AUTHOR_READING',
      inputDigest: uncertain.inputDigest,
      replayOnly: true,
    });
    await expect(replayUnknown(makeRequest('unknown'), () => send('unexpected'))).rejects.toThrow();
    const ready = { ...providerContext, stage: 'REVIEW' as const };
    await sottoTransaction(instance.database, (tx) => prepareAssessmentProviderCall(tx, ready));
    const replayReady = assessmentProviderRequest({
      ...providerInput,
      stage: 'REVIEW',
      inputDigest: ready.inputDigest,
      replayOnly: true,
    });
    await expect(replayReady(makeRequest('ready'), () => send('unexpected'))).rejects.toThrow();
    expect(dispatched).toBe(2);
    expect(
      await sottoTransaction(instance.database, (tx) => readAssessmentProviderCall(tx, uncertain))
    ).toMatchObject({ status: 'UNKNOWN', receipt: null });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        prepareAssessmentProviderCall(tx, { ...uncertain, ordinal: 1 })
      )
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitAssessmentProviderCall(tx, uncertain, {
          id: randomUUID(),
          fingerprint: uncertainAttempt.fingerprint,
        })
      )
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        startAssessmentWork(tx, operationIdentity, admission.execution)
      )
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        requirePendingAssessmentWork(
          tx,
          { ...operationIdentity, fingerprint: '0'.repeat(64) },
          admission.execution,
          'RUNNING'
        )
      )
    ).rejects.toThrow(/already active/);
    const grammarRequirement = source.requirements.skills.GRAMMAR;
    if (grammarRequirement.state !== 'REQUIRED') throw new Error('Grammar fixture required');
    const grammarDraft = {
      skill: 'GRAMMAR',
      items: Array.from({ length: grammarRequirement.expectedCount }, (_, index) => ({
        question: `New greeting ${index}`,
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: 'Reason',
      })),
    };
    const staged = await sottoTransaction(instance.database, (tx) =>
      stageAssessmentSection(tx, operationIdentity, admission.execution, grammarDraft)
    );
    expect(
      await sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operationIdentity, admission.execution, grammarDraft)
      )
    ).toEqual(staged);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operationIdentity, admission.execution, {
          ...grammarDraft,
          items: grammarDraft.items.map((item) => ({ ...item, explanation: 'Changed' })),
        })
      )
    ).rejects.toThrow(/already active/);
    const storedQuestion = await instance.database.classAssessmentQuestion.findFirstOrThrow({
      where: { sectionId: staged.sectionId },
    });
    await instance.database.classAssessmentQuestion.update({
      where: { id: storedQuestion.id },
      data: { explanation: 'Tampered' },
    });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operationIdentity, admission.execution, grammarDraft)
      )
    ).rejects.toThrow(/already active/);
    const readingRequirement = source.requirements.skills.READING;
    const writingRequirement = source.requirements.skills.WRITING;
    if (readingRequirement.state !== 'REQUIRED' || writingRequirement.state !== 'REQUIRED')
      throw new Error('Reading and writing fixtures required');
    const drafts = [
      {
        skill: 'READING',
        passage: 'Новый текст',
        items: Array.from({ length: readingRequirement.expectedCount }, (_, index) => ({
          question: `Reading ${index}`,
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Reason',
        })),
      },
      {
        skill: 'WRITING',
        items: Array.from({ length: writingRequirement.expectedCount }, (_, index) => ({
          task: `Write ${index}`,
          rubric: 'Criteria',
          guidance: 'Guidance',
        })),
      },
    ];
    for (const draft of drafts) {
      const result = await sottoTransaction(instance.database, (tx) =>
        stageAssessmentSection(tx, operationIdentity, admission.execution, draft)
      );
      expect(
        await sottoTransaction(instance.database, (tx) =>
          stageAssessmentSection(tx, operationIdentity, admission.execution, draft)
        )
      ).toEqual(result);
    }
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        adaptiveSeed: {
          ...(cls.adaptiveSeed as object),
          prerequisiteAddendum: {
            version: 1,
            sourceHash: 'a'.repeat(64),
            content: {
              title: 'Anterior',
              explanation: 'Una explicación.',
              examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Ejemplo.' }],
              directions: {
                guided: 'Pide algo.',
                tasks: [
                  { sectionId: 'section', taskId: 'task', kind: 'question', instruction: 'Elige.' },
                ],
              },
            },
          },
        },
      },
    });
    expect(
      await sottoTransaction(instance.database, (tx) =>
        captureAssessmentGenerationSource(tx, authorizedLearnerExecution(identity.ownerId), {
          classId,
          classAttempt: cls.attempt,
        })
      )
    ).toEqual(source);
    const reviewContext = { ...providerContext, stage: 'REVIEW' as const };
    const reviewAttempt = { id: randomUUID(), fingerprint: 'e'.repeat(64) };
    await sottoTransaction(instance.database, (tx) =>
      prepareAssessmentProviderCall(tx, reviewContext)
    );
    await sottoTransaction(instance.database, (tx) =>
      admitAssessmentProviderCall(tx, reviewContext, reviewAttempt)
    );
    const scope = fence.ownership.scopes.find((item) => item.subjectId === `class:${classId}`);
    if (!scope) throw new Error('Assessment class scope missing');
    let oldAuthority: object | undefined;
    let authority: object | undefined;
    const cancelled = new AbortController();
    const secondCancelled = new AbortController();
    await withSottoJobExecution({
      database: instance.database,
      parentId: operationIdentity.id,
      fingerprint: operationIdentity.fingerprint,
      signal: cancelled.signal,
      capabilityScope: scope,
      validate: async () => true,
      isCleanupFailure: () => false,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability missing');
        oldAuthority = await captureAssessmentSettlementAuthority({
          identity: operationIdentity,
          capability,
        });
        cancelled.abort();
        await instance.database.lessonQuestion.update({
          where: { id: questionId },
          data: { explanation: 'Changed after dispatch' },
        });
        expect(
          await markAssessmentUnresolved({ database: instance.database, authority: oldAuthority })
        ).toEqual({ status: 'UNRESOLVED' });
      },
    });
    if (!oldAuthority) throw new Error('Settlement authority missing');
    await withSottoJobExecution({
      database: instance.database,
      parentId: operationIdentity.id,
      fingerprint: operationIdentity.fingerprint,
      signal: secondCancelled.signal,
      capabilityScope: scope,
      validate: async () => true,
      isCleanupFailure: () => false,
      run: async ({ capability }) => {
        if (!capability || !oldAuthority) throw new Error('Execution capability missing');
        authority = await captureAssessmentSettlementAuthority({
          identity: operationIdentity,
          capability,
        });
        expect(() =>
          markAssessmentUnresolved({ database: instance.database, authority: authority! })
        ).toThrow();
        await expect(
          markAssessmentUnresolved({ database: instance.database, authority: oldAuthority })
        ).rejects.toThrow();
        secondCancelled.abort();
      },
    });
    if (!authority) throw new Error('Settlement authority missing');
    await expect(
      markAssessmentUnresolved({ database: instance.database, authority: oldAuthority })
    ).rejects.toThrow();
    expect(() =>
      markAssessmentUnresolved({ database: instance.database, authority: { ...authority } })
    ).toThrow();
    expect(await markAssessmentUnresolved({ database: instance.database, authority })).toEqual({
      status: 'UNRESOLVED',
    });
    expect(await markAssessmentUnresolved({ database: instance.database, authority })).toEqual({
      status: 'UNRESOLVED',
    });
    let normalAuthority: object | undefined;
    const laterShutdown = new AbortController();
    await withSottoJobExecution({
      database: instance.database,
      parentId: operationIdentity.id,
      fingerprint: operationIdentity.fingerprint,
      signal: laterShutdown.signal,
      capabilityScope: scope,
      validate: async () => true,
      isCleanupFailure: () => false,
      run: async ({ capability }) => {
        if (!capability) throw new Error('Execution capability missing');
        normalAuthority = await captureAssessmentSettlementAuthority({
          identity: operationIdentity,
          capability,
        });
      },
    });
    if (!normalAuthority) throw new Error('Settlement authority missing');
    laterShutdown.abort();
    await expect(
      markAssessmentUnresolved({ database: instance.database, authority: normalAuthority })
    ).rejects.toThrow();
    const cleanupRoot = await mkdtemp(join(tmpdir(), 'sotto-assessment-cleanup-'));
    const savedDirectory = process.env.SIDEDOOR_EXECUTION_DIR;
    vi.stubEnv('SIDEDOOR_EXECUTION_DIR', join(cleanupRoot, 'executions'));
    try {
      let cleanupAuthority: object | undefined;
      await expect(
        withSottoJobExecution({
          database: instance.database,
          parentId: operationIdentity.id,
          fingerprint: operationIdentity.fingerprint,
          signal: new AbortController().signal,
          capabilityScope: scope,
          validate: async () => true,
          isCleanupFailure: () => false,
          run: async ({ capability, directory }) => {
            if (!capability) throw new Error('Execution capability missing');
            cleanupAuthority = await captureAssessmentSettlementAuthority({
              identity: operationIdentity,
              capability,
            });
            // This isolated executor performs no external work. Replace its workspace
            // to make the shared runner record a cleanup identity mismatch.
            await rm(directory, { recursive: true });
            await writeFile(directory, 'replacement');
          },
        })
      ).rejects.toThrow();
      if (!cleanupAuthority) throw new Error('Settlement authority missing');
      expect(
        await markAssessmentUnresolved({ database: instance.database, authority: cleanupAuthority })
      ).toEqual({ status: 'UNRESOLVED' });
      expect(
        await sottoTransaction(instance.database, (tx) =>
          sottoJobExecutions(tx).blockingStatus(operationIdentity.id, operationIdentity.fingerprint)
        )
      ).toBe('cleanup-unconfirmed');
    } finally {
      if (savedDirectory === undefined) delete process.env.SIDEDOOR_EXECUTION_DIR;
      else process.env.SIDEDOOR_EXECUTION_DIR = savedDirectory;
      await rm(cleanupRoot, { recursive: true, force: true });
    }
    expect(
      await instance.database.classAssessment.findUniqueOrThrow({
        where: { id: fence.assessmentId },
      })
    ).toMatchObject({ status: 'UNRESOLVED', sealedAt: null });
    expect(
      (
        await sottoTransaction(instance.database, (tx) =>
          sottoJobOutbox(tx).read(operationIdentity.id)
        )
      )?.complete
    ).toBe(false);
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentProviderCall(tx, reviewContext, reviewAttempt, 'unknown')
    );
    const grant = await sottoTransaction(instance.database, (tx) =>
      learningPreparationGrant(tx, fence, 'assessment').read(fence.grant)
    );
    expect(grant.attempts.find((entry) => entry.id === reviewAttempt.id)?.outcome).toBe('unknown');
    await expect(
      sottoTransaction(instance.database, (tx) => prepareAssessmentProviderCall(tx, reviewContext))
    ).rejects.toThrow();
  });
}
