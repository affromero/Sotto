import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AssessmentSchemaContext } from './schema-context';

export function registerSchemaFreezeCases(getContext: () => AssessmentSchemaContext) {
  it('binds owner and class, limits live attempts, and requires review metadata for ready state', async () => {
    const { instance, assessment } = getContext();
    const foreign = await instance.database.user.create({
      data: { email: 'assessment-foreign@test.local' },
    });
    await expect(
      instance.database.classAssessment.create({
        data: { ...assessment(1, 1), userId: foreign.id },
      })
    ).rejects.toThrow();
    const first = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    await expect(
      instance.database.classAssessment.create({ data: assessment(1, 2) })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: { status: 'READY' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: {
          status: 'READY',
          teachingKind: null,
          teachingReceiptId: null,
          generationOperationId: 'generation-1',
          reviewOperationId: 'review-1',
          reviewedMaterialDigest: 'a'.repeat(64),
          reviewReceipt: {},
          sealedAt: new Date(),
        },
      })
    ).rejects.toThrow();
    await instance.database.classAssessment.update({
      where: { id: first.id },
      data: {
        status: 'READY',
        generationOperationId: 'generation-1',
        reviewOperationId: 'review-1',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: { status: 'COMMITTED' },
      })
    ).rejects.toThrow();
  });

  it('does not reset or replace a dispatched speaking-reference attempt', async () => {
    const { instance, ownerId, assessment } = getContext();
    const operationId = randomUUID();
    const saved = await instance.database.classAssessment.create({
      data: { ...assessment(1, 1), generationOperationId: operationId },
    });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: section.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Привет',
        translation: 'Hola',
      },
    });
    const provenance = {
      operationId,
      fingerprint: 'a'.repeat(64),
      provider: 'local',
      model: 'fixture',
      voiceId: 'voice',
      speechFingerprint: 'b'.repeat(64),
      inputDigest: 'c'.repeat(64),
      dispatches: 1,
    };
    const marker = {
      kind: 'ASSESSMENT_SPEAKING_TTS_ACTIVE',
      version: 1,
      assessmentId: saved.id,
      promptId: prompt.id,
      userId: ownerId,
      operationId,
      fingerprint: provenance.fingerprint,
      provider: provenance.provider,
      model: provenance.model,
      voiceId: provenance.voiceId,
      speechFingerprint: provenance.speechFingerprint,
      inputDigest: provenance.inputDigest,
    };
    await instance.database.speakingPrompt.update({
      where: { id: prompt.id },
      data: { assessmentReferenceIdentity: marker },
    });
    await expect(
      instance.database
        .$executeRaw`UPDATE "SpeakingPrompt" SET "assessmentReferenceIdentity" = NULL WHERE id = ${prompt.id}`
    ).rejects.toThrow('cannot be reset or replaced');
    const reference = {
      version: 1,
      assessmentId: saved.id,
      promptId: prompt.id,
      userId: ownerId,
      contentSha256: 'd'.repeat(64),
      contentBytes: 10,
      reference: { reference: '/audio' },
      provenance,
    };
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: {
          referenceTtsUrl: '/audio',
          assessmentReferenceIdentity: {
            ...reference,
            provenance: { ...provenance, voiceId: 'other' },
          },
        },
      })
    ).rejects.toThrow('cannot be reset or replaced');
    await instance.database.speakingPrompt.update({
      where: { id: prompt.id },
      data: { referenceTtsUrl: '/audio', assessmentReferenceIdentity: reference },
    });
    await expect(
      instance.database
        .$executeRaw`UPDATE "SpeakingPrompt" SET "assessmentReferenceIdentity" = NULL, "referenceTtsUrl" = NULL WHERE id = ${prompt.id}`
    ).rejects.toThrow('cannot be reset or replaced');
    expect(
      (
        await instance.database.assessmentSpeakingReference.findUniqueOrThrow({
          where: { promptId: prompt.id },
        })
      ).currentUrl
    ).toBe('/audio');
  });

  it('freezes reviewed material and allows deletion only with its class', async () => {
    const { instance, classId, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const question = await instance.database.classAssessmentQuestion.create({
      data: {
        assessmentId: saved.id,
        sectionId: section.id,
        order: 1,
        question: 'Choose',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'Answer',
      },
    });
    const speech = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const listening = await instance.database.classAssessmentSection.create({
      data: {
        assessmentId: saved.id,
        skill: 'LISTENING',
        passThreshold: 0.7,
        audioIdentity: { contentSha256: 'a'.repeat(64) },
      },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: speech.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        assessmentReferenceIdentity: { contentSha256: 'b'.repeat(64) },
        order: 1,
        targetPhrase: 'Да',
        translation: 'Sí',
      },
    });
    await expect(
      instance.database.speakingPrompt.create({
        data: {
          assessmentSectionId: speech.id,
          assessmentRubric: 'Criteria',
          order: 2,
          targetPhrase: 'Да',
          translation: 'Sí',
        },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.create({
        data: { assessmentTaskMode: 'READ_ALOUD', order: 1, targetPhrase: 'Да', translation: 'Sí' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.create({
        data: {
          assessmentSectionId: speech.id,
          assessmentRubric: 'Criteria',
          assessmentTaskMode: 'COMMUNICATIVE',
          referenceTtsUrl: '/answer',
          order: 3,
          targetPhrase: 'Pide agua',
          translation: 'Request water',
        },
      })
    ).rejects.toThrow();
    await instance.database.classAssessment.update({
      where: { id: saved.id },
      data: {
        status: 'READY',
        generationOperationId: 'seal-generation',
        reviewOperationId: 'seal-review',
        reviewedMaterialDigest: 'a'.repeat(64),
        reviewReceipt: {},
        sealedAt: new Date(),
      },
    });
    await expect(
      instance.database.classAssessmentQuestion.update({
        where: { id: question.id },
        data: { correctIndex: 1 },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentQuestion.delete({ where: { id: question.id } })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { targetPhrase: 'Нет' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { assessmentTaskMode: 'COMMUNICATIVE' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { assessmentReferenceIdentity: { contentSha256: 'c'.repeat(64) } },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSection.update({
        where: { id: listening.id },
        data: { audioIdentity: { contentSha256: 'd'.repeat(64) } },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.delete({ where: { id: prompt.id } })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSection.delete({ where: { id: section.id } })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: saved.id },
        data: { reviewedMaterialDigest: 'b'.repeat(64) },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: saved.id },
        data: { teachingReceiptId: 'another-receipt' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.update({
        where: { id: saved.id },
        data: { status: 'GENERATING' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessment.delete({ where: { id: saved.id } })
    ).rejects.toThrow();
    await instance.database.courseClass.delete({ where: { id: classId } });
    expect(await instance.database.classAssessment.count()).toBe(0);
  });

  it('rejects a material edit that waits behind assessment sealing', async () => {
    const { instance, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const question = await instance.database.classAssessmentQuestion.create({
      data: {
        assessmentId: saved.id,
        sectionId: section.id,
        order: 1,
        question: 'Choose',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'Reason',
      },
    });
    let release!: () => void;
    let sealed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      sealed = resolve;
    });
    const sealing = instance.database.$transaction(
      async (tx) => {
        await tx.classAssessment.update({
          where: { id: saved.id },
          data: {
            status: 'READY',
            generationOperationId: 'seal-race-generation',
            reviewOperationId: 'seal-race-review',
            reviewedMaterialDigest: 'a'.repeat(64),
            reviewReceipt: {},
            sealedAt: new Date(),
          },
        });
        sealed();
        await gate;
      },
      { timeout: 15000 }
    );
    await ready;
    const edit = instance.database.classAssessmentQuestion.update({
      where: { id: question.id },
      data: { explanation: 'Changed' },
    });
    try {
      expect(
        await Promise.race([
          edit.then(() => 'edited'),
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    await sealing;
    await expect(edit).rejects.toThrow('Sealed assessment material cannot change');
    expect(
      (
        await instance.database.classAssessmentQuestion.findUniqueOrThrow({
          where: { id: question.id },
        })
      ).explanation
    ).toBe('Reason');
  }, 20000);

  it('rejects a concurrent material edit that waits behind publication', async () => {
    const { instance, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const question = await instance.database.classAssessmentQuestion.create({
      data: {
        assessmentId: saved.id,
        sectionId: section.id,
        order: 1,
        question: 'Choose',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'Answer',
      },
    });
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const publication = instance.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${saved.id} FOR UPDATE`;
      locked();
      await gate;
      await tx.classAssessment.update({
        where: { id: saved.id },
        data: {
          status: 'READY',
          generationOperationId: 'race-generation',
          reviewOperationId: 'race-review',
          reviewedMaterialDigest: 'a'.repeat(64),
          reviewReceipt: {},
          sealedAt: new Date(),
        },
      });
    });
    await acquired;
    const edit = instance.database.classAssessmentQuestion
      .update({ where: { id: question.id }, data: { correctIndex: 1 } })
      .then(
        () => 'saved',
        () => 'rejected'
      );
    try {
      expect(
        await Promise.race([
          edit,
          new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
        ])
      ).toBe('waiting');
    } finally {
      release();
    }
    await publication;
    expect(await edit).toBe('rejected');
    expect(
      (
        await instance.database.classAssessmentQuestion.findUniqueOrThrow({
          where: { id: question.id },
        })
      ).correctIndex
    ).toBe(0);
  });

  it('rolls back a pending deletion if publication seals first', async () => {
    const { instance, assessment } = getContext();
    const saved = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const section = await instance.database.classAssessmentSection.create({
      data: { assessmentId: saved.id, skill: 'GRAMMAR', passThreshold: 0.7 },
    });
    const question = await instance.database.classAssessmentQuestion.create({
      data: {
        assessmentId: saved.id,
        sectionId: section.id,
        order: 1,
        question: 'Choose',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanation: 'Answer',
      },
    });
    let release!: () => void;
    let staged!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleted = new Promise<void>((resolve) => {
      staged = resolve;
    });
    const transaction = instance.database
      .$transaction(async (tx) => {
        await tx.classAssessmentQuestion.delete({ where: { id: question.id } });
        staged();
        await gate;
      })
      .then(
        () => 'deleted',
        () => 'rejected'
      );
    await deleted;
    try {
      await instance.database.classAssessment.update({
        where: { id: saved.id },
        data: {
          status: 'READY',
          generationOperationId: 'delete-race-generation',
          reviewOperationId: 'delete-race-review',
          reviewedMaterialDigest: 'a'.repeat(64),
          reviewReceipt: {},
          sealedAt: new Date(),
        },
      });
    } finally {
      release();
    }
    expect(await transaction).toBe('rejected');
    expect(
      await instance.database.classAssessmentQuestion.findUnique({ where: { id: question.id } })
    ).not.toBeNull();
  });

  it('rejects productive responses for another assessment section', async () => {
    const { instance, ownerId, courseId, classId, assessment } = getContext();
    const first = await instance.database.classAssessment.create({ data: assessment(1, 1) });
    const second = await instance.database.classAssessment.create({ data: assessment(2, 1) });
    const left = await instance.database.classAssessmentSection.create({
      data: { assessmentId: first.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const right = await instance.database.classAssessmentSection.create({
      data: { assessmentId: second.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const prompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: left.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Привет',
        translation: 'Hola',
      },
    });
    await expect(
      instance.database.speakingRecording.create({
        data: {
          assessmentSectionId: right.id,
          promptId: prompt.id,
          userId: ownerId,
          audioUrl: '/saved',
        },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.speakingPrompt.create({
        data: { assessmentSectionId: left.id, order: 2, targetPhrase: 'Да', translation: 'Sí' },
      })
    ).rejects.toThrow();
    const foreign = await instance.database.user.create({
      data: { email: 'assessment-evidence-foreign@test.local' },
    });
    for (const data of [
      { promptId: prompt.id, userId: ownerId, audioUrl: '/saved' },
      { promptId: prompt.id, assessmentSectionId: left.id, userId: foreign.id, audioUrl: '/saved' },
    ])
      await expect(instance.database.speakingRecording.create({ data })).rejects.toThrow();
    await expect(
      instance.database.writingPrompt.create({
        data: {
          assessmentSectionId: left.id,
          assessmentRubric: 'Criteria',
          order: 1,
          task: 'Write',
        },
      })
    ).rejects.toThrow();
    const writingSection = await instance.database.classAssessmentSection.create({
      data: { assessmentId: first.id, skill: 'WRITING', passThreshold: 0.7 },
    });
    const writingPrompt = await instance.database.writingPrompt.create({
      data: {
        assessmentSectionId: writingSection.id,
        assessmentRubric: 'Criteria',
        order: 1,
        task: 'Write',
      },
    });
    for (const data of [
      { promptId: writingPrompt.id, userId: ownerId, text: 'Draft' },
      {
        promptId: writingPrompt.id,
        assessmentSectionId: writingSection.id,
        userId: foreign.id,
        text: 'Draft',
      },
    ])
      await expect(instance.database.writingResponse.create({ data })).rejects.toThrow();
    const recording = await instance.database.speakingRecording.create({
      data: {
        promptId: prompt.id,
        assessmentSectionId: left.id,
        userId: ownerId,
        audioUrl: '/saved',
      },
    });
    const response = await instance.database.writingResponse.create({
      data: {
        promptId: writingPrompt.id,
        assessmentSectionId: writingSection.id,
        userId: ownerId,
        text: 'Draft',
      },
    });
    await expect(
      instance.database.speakingRecording.update({
        where: { id: recording.id },
        data: { audioUrl: '/different-audio' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.writingResponse.update({
        where: { id: response.id },
        data: { text: 'Нет' },
      })
    ).rejects.toThrow();
    const anotherSpeaking = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: left.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        order: 3,
        targetPhrase: 'Да',
        translation: 'Sí',
      },
    });
    const anotherWriting = await instance.database.writingPrompt.create({
      data: {
        assessmentSectionId: writingSection.id,
        assessmentRubric: 'Criteria',
        order: 2,
        task: 'Write again',
      },
    });
    const unboundSpeaking = await instance.database.speakingPrompt.create({
      data: { order: 1, targetPhrase: 'Да', translation: 'Sí' },
    });
    const unboundWriting = await instance.database.writingPrompt.create({
      data: { order: 1, task: 'Write' },
    });
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: unboundSpeaking.id },
        data: { assessmentSectionId: left.id, assessmentRubric: 'Criteria' },
      })
    ).rejects.toThrow('Assessment prompts cannot change parent category');
    await expect(
      instance.database.writingPrompt.update({
        where: { id: unboundWriting.id },
        data: { assessmentSectionId: writingSection.id, assessmentRubric: 'Criteria' },
      })
    ).rejects.toThrow('Assessment prompts cannot change parent category');
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: anotherSpeaking.id },
        data: { assessmentSectionId: null },
      })
    ).rejects.toThrow('Assessment prompts cannot change parent category');
    const legacySpeaking = await instance.database.speakingPrompt.create({
      data: { order: 1, targetPhrase: 'Нет', translation: 'No' },
    });
    const legacyWriting = await instance.database.writingPrompt.create({
      data: { order: 1, task: 'Legacy' },
    });
    const legacyRecording = await instance.database.speakingRecording.create({
      data: { promptId: legacySpeaking.id, userId: ownerId, audioUrl: '/legacy' },
    });
    const legacyResponse = await instance.database.writingResponse.create({
      data: { promptId: legacyWriting.id, userId: ownerId, text: 'Legacy' },
    });
    for (const data of [
      { promptId: anotherSpeaking.id },
      { attempt: 2 },
      { promptId: legacySpeaking.id, assessmentSectionId: null },
    ])
      await expect(
        instance.database.speakingRecording.update({ where: { id: recording.id }, data })
      ).rejects.toThrow();
    for (const data of [
      { promptId: anotherWriting.id },
      { attempt: 2 },
      { promptId: legacyWriting.id, assessmentSectionId: null },
    ])
      await expect(
        instance.database.writingResponse.update({ where: { id: response.id }, data })
      ).rejects.toThrow();
    await expect(
      instance.database.speakingRecording.update({
        where: { id: legacyRecording.id },
        data: { promptId: prompt.id, assessmentSectionId: left.id },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.writingResponse.update({
        where: { id: legacyResponse.id },
        data: { promptId: writingPrompt.id, assessmentSectionId: writingSection.id },
      })
    ).rejects.toThrow();
    await instance.database.speakingRecording.update({
      where: { id: recording.id },
      data: { status: 'SCORED', overallScore: 0.8 },
    });
    await instance.database.writingResponse.update({
      where: { id: response.id },
      data: { overallScore: 0.8 },
    });
    await expect(
      instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { assessmentSectionId: null },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentQuestion.create({
        data: {
          assessmentId: first.id,
          sectionId: left.id,
          order: 1,
          question: 'Choose',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanation: 'Answer',
        },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSection.update({
        where: { id: left.id },
        data: { skill: 'READING' },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSection.update({
        where: { id: left.id },
        data: { assessmentId: second.id },
      })
    ).rejects.toThrow();
    await expect(
      instance.database.classAssessmentSection.update({
        where: { id: writingSection.id },
        data: { assessmentId: second.id },
      })
    ).rejects.toThrow();
    const currentCourse = await instance.database.course.findUniqueOrThrow({
      where: { id: courseId },
    });
    const foreignCourse = await instance.database.course.create({
      data: {
        userId: foreign.id,
        curriculumId: currentCourse.curriculumId,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const currentClass = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    const foreignClass = await instance.database.courseClass.create({
      data: { courseId: foreignCourse.id, lessonId: currentClass.lessonId, order: 1 },
    });
    const foreignAssessment = await instance.database.classAssessment.create({
      data: {
        ...assessment(1, 1),
        classId: foreignClass.id,
        courseId: foreignCourse.id,
        userId: foreign.id,
      },
    });
    const foreignSpeaking = await instance.database.classAssessmentSection.create({
      data: { assessmentId: foreignAssessment.id, skill: 'SPEAKING', passThreshold: 0.7 },
    });
    const foreignWriting = await instance.database.classAssessmentSection.create({
      data: { assessmentId: foreignAssessment.id, skill: 'WRITING', passThreshold: 0.7 },
    });
    const foreignSpeakingPrompt = await instance.database.speakingPrompt.create({
      data: {
        assessmentSectionId: foreignSpeaking.id,
        assessmentRubric: 'Criteria',
        assessmentTaskMode: 'READ_ALOUD',
        order: 1,
        targetPhrase: 'Да',
        translation: 'Sí',
      },
    });
    const foreignWritingPrompt = await instance.database.writingPrompt.create({
      data: {
        assessmentSectionId: foreignWriting.id,
        assessmentRubric: 'Criteria',
        order: 1,
        task: 'Write',
      },
    });
    const speakingMove = {
      promptId: foreignSpeakingPrompt.id,
      assessmentSectionId: foreignSpeaking.id,
      userId: foreign.id,
    };
    const writingMove = {
      promptId: foreignWritingPrompt.id,
      assessmentSectionId: foreignWriting.id,
      userId: foreign.id,
    };
    const speakingRace = await Promise.allSettled([
      instance.database.speakingRecording.update({
        where: { id: recording.id },
        data: { feedback: 'Graded' },
      }),
      instance.database.speakingRecording.update({
        where: { id: recording.id },
        data: speakingMove,
      }),
    ]);
    const writingRace = await Promise.allSettled([
      instance.database.writingResponse.update({
        where: { id: response.id },
        data: { feedback: 'Graded' },
      }),
      instance.database.writingResponse.update({ where: { id: response.id }, data: writingMove }),
    ]);
    expect(speakingRace.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
    expect(writingRace.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
    await expect(
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: { classId: foreignClass.id, courseId: foreignCourse.id, userId: foreign.id },
      })
    ).rejects.toThrow();
    const race = await Promise.allSettled([
      instance.database.speakingRecording.create({
        data: {
          promptId: prompt.id,
          assessmentSectionId: left.id,
          userId: ownerId,
          audioUrl: '/concurrent',
          attempt: 2,
        },
      }),
      instance.database.classAssessment.update({
        where: { id: first.id },
        data: { classId: foreignClass.id, courseId: foreignCourse.id, userId: foreign.id },
      }),
    ]);
    expect(race.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
  });
}
