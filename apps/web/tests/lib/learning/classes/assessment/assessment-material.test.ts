import { describe, expect, it } from 'vitest';
import { classAssessmentMaterialSchema, createSkillRequirements } from '@sotto/shared';
import {
  selectAssessmentSpeakingCapture,
  selectAssessmentSpeakingTask,
} from '@/lib/learning/classes/speaking/assessment-speaking-task';
import {
  assessmentSpeakingInput,
  assessmentSpeakingInputDigest,
  assessmentSpeakingInputSchema,
} from '@/lib/learning/classes/speaking/assessment-speaking-identity';
import {
  assessmentMaterialDigest,
  assessmentEvaluationReceipt,
  assertAssessmentTaskIndependence,
  exposedAssessmentTasks,
  evaluateAssessmentMaterial,
  evaluateRetainedAssessmentMaterial,
  publicAssessmentMaterial,
  parseAssessmentMaterial,
  validateAssessmentMaterial,
  type AssessmentScope,
  type PrivateAssessmentMaterial,
} from '@/lib/learning/classes/material/assessment-material';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import {
  READ_ALOUD_ASSESSMENT_POLICY,
  READ_ALOUD_ASSESSMENT_RUBRIC,
} from '@/lib/learning/classes/speaking/assessment-speaking-policy';
import { reviewSections } from '@/lib/learning/classes/review/assessment-review';

function fixture() {
  const requirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'es',
    targetLang: 'ru',
    level: 'A1',
    ttsProvider: 'configured-tts',
    sttProvider: 'configured-stt',
  });
  const mc = (skill: 'GRAMMAR' | 'READING' | 'LISTENING', count: number) => ({
    id: `section-${skill}`,
    skill,
    passThreshold: 0.7,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${skill}-${index}`,
      question: `Task ${skill} ${index}`,
      options: ['one', 'two', 'three', 'four'],
      correctIndex: 1,
      explanation: 'private explanation',
    })),
    passageText: skill === 'READING' ? 'A reading passage' : null,
    audio:
      skill === 'LISTENING'
        ? {
            episodeId: 'owned-audio',
            mediaIdentity: 'immutable-audio',
            privateTranscript: 'private transcript',
          }
        : null,
  });
  const assessment: PrivateAssessmentMaterial = {
    version: 1,
    id: 'assessment',
    classId: 'class',
    courseId: 'course',
    userId: 'learner',
    classAttempt: 2,
    assessmentAttempt: 1,
    formativeRevision: 'revision',
    requirements,
    sections: [
      mc('GRAMMAR', 5),
      mc('READING', 5),
      mc('LISTENING', 4),
      {
        id: 'section-speaking',
        skill: 'SPEAKING',
        passThreshold: 0.7,
        items: Array.from({ length: 4 }, (_, index) => ({
          id: `speaking-${index}`,
          task: `Speak ${index}`,
          mode: 'READ_ALOUD',
          referenceAudioId: `reference-${index}`,
          privateRubric: 'private speaking rubric',
          privateGuidance: 'private speaking guidance',
          privateTranslation: 'private translation',
          privateIpa: null,
          privateLearningObjectives: null,
        })),
      },
      {
        id: 'section-writing',
        skill: 'WRITING',
        passThreshold: 0.7,
        items: Array.from({ length: 3 }, (_, index) => ({
          id: `writing-${index}`,
          task: `Write ${index}`,
          privateRubric: 'private writing rubric',
          privateGuidance: 'private writing guidance',
          privateIdeas: ['private starter'],
          privateLearningObjectives: null,
        })),
      },
    ],
  };
  const scope: AssessmentScope = {
    id: assessment.id,
    classId: assessment.classId,
    courseId: assessment.courseId,
    userId: assessment.userId,
    classAttempt: assessment.classAttempt,
    assessmentAttempt: assessment.assessmentAttempt,
    formativeRevision: assessment.formativeRevision,
    requirements,
    passThresholds: { GRAMMAR: 0.7, READING: 0.7, LISTENING: 0.7, SPEAKING: 0.7, WRITING: 0.7 },
    formativeItemIds: ['formative-question'],
    formativeTasks: [{ skill: 'GRAMMAR', task: 'A formative example' }],
    reviewedMaterialDigest: assessmentMaterialDigest(assessment),
    review: {
      decision: 'ACCEPTED',
      materialDigest: assessmentMaterialDigest(assessment),
      formativeRevision: assessment.formativeRevision,
    },
    ownedListening: {
      episodeId: 'owned-audio',
      mediaIdentity: 'immutable-audio',
      status: 'READY',
      audioUrl: '/audio',
      privateTranscript: 'private transcript',
    },
    ownedSpeakingReferences: Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `speaking-${index}`,
        { id: `reference-${index}`, status: 'READY', storageRef: `/reference-${index}` },
      ])
    ),
  };
  return { assessment, scope };
}

function reviewed(scope: AssessmentScope, material: PrivateAssessmentMaterial): AssessmentScope {
  const digest = assessmentMaterialDigest(material);
  return {
    ...scope,
    reviewedMaterialDigest: digest,
    review: {
      decision: 'ACCEPTED',
      materialDigest: digest,
      formativeRevision: material.formativeRevision,
    },
  };
}

describe('held-out class assessment material', () => {
  it('selects only the requested speaking task and its matching reference', () => {
    const { assessment, scope } = fixture();
    const source = {
      kind: 'SPEAKING' as const,
      promptId: 'speaking-0',
      original: {
        consumer: 'speaking-prompt:speaking-0:reference',
        reference: '/reference',
        assetId: 'a'.repeat(64),
        backendId: 'b'.repeat(64),
        binding: 'c'.repeat(64),
        key: 'owned/reference',
      },
      currentReference: '/reference',
      contentSha256: 'd'.repeat(64),
      contentBytes: 42,
    };
    const captured = { material: assessment, scope, audioSources: [source] };
    const result = selectAssessmentSpeakingCapture(captured, 'speaking-0');
    const retainedScope = {
      id: scope.id,
      classId: scope.classId,
      courseId: scope.courseId,
      userId: scope.userId,
      classAttempt: scope.classAttempt,
      assessmentAttempt: scope.assessmentAttempt,
      reviewedMaterialDigest: scope.reviewedMaterialDigest,
      requirements: scope.requirements,
    };
    expect(
      selectAssessmentSpeakingTask({ material: assessment, scope: retainedScope }, 'speaking-0')
    ).toEqual(result.task);
    expect(result.audioSource).toEqual(source);
    expect(result.task.prompt.id).toBe('speaking-0');
    expect(JSON.stringify(result)).not.toMatch(/private writing rubric|private explanation/);
    expect(() =>
      selectAssessmentSpeakingCapture({ ...captured, audioSources: [] }, 'speaking-0')
    ).toThrow();
    expect(() =>
      selectAssessmentSpeakingCapture({ ...captured, audioSources: [source, source] }, 'speaking-0')
    ).toThrow();
    const speaking = assessment.sections.find((section) => section.skill === 'SPEAKING');
    if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Missing speaking section');
    speaking.items[0]!.mode = 'COMMUNICATIVE';
    speaking.items[0]!.referenceAudioId = null;
    expect(
      selectAssessmentSpeakingCapture({ ...captured, audioSources: [] }, 'speaking-0')
    ).toMatchObject({ audioSource: null });
    expect(() => selectAssessmentSpeakingCapture(captured, 'speaking-0')).toThrow();
  });
  it('binds speaking audio bytes and provider selection to the private reviewed task', () => {
    const { assessment, scope } = fixture();
    const version2 = parseAssessmentMaterial({
      ...assessment,
      version: 2,
      sections: assessment.sections.map((section) =>
        section.skill === 'SPEAKING'
          ? {
              ...section,
              items: section.items.map((item) => ({
                ...item,
                privateCriteria: [
                  { id: 'meaning', description: 'Conveys meaning', modality: 'TRANSCRIPT' },
                ],
              })),
            }
          : section
      ),
    });
    const task = selectAssessmentSpeakingTask(
      { material: version2, scope: reviewed(scope, version2) },
      'speaking-0'
    );
    const options = {
      task,
      operationId: '235523ed-e123-4b25-9c18-79eb00f9b491',
      recordingId: '28a74c48-ec92-481c-8468-164529fd5000',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/webm',
      selection: {
        providerId: 'speech-provider',
        model: 'speech-model',
        baseUrl: null,
        credentialFingerprint: 'credential-revision',
      },
      gradingSelection: {
        provider: 'grading-provider',
        model: 'grading-model',
        credentialFingerprint: 'a'.repeat(64),
        moderationCredentialFingerprint: null,
      },
    };
    const identity = assessmentSpeakingInput(options);
    const original = assessmentSpeakingInputDigest(identity);
    expect(identity).toMatchObject({
      assessmentId: task.assessmentId,
      promptId: task.prompt.id,
      materialDigest: task.materialDigest,
      audio: { bytes: 3, contentType: 'audio/webm' },
    });
    expect(JSON.stringify(identity)).not.toContain('private speaking rubric');
    expect(assessmentSpeakingInputDigest(assessmentSpeakingInput(options))).toBe(original);
    for (const changed of [
      { ...options, audio: new Uint8Array([1, 2, 4]) },
      { ...options, selection: { ...options.selection, model: 'different-model' } },
      { ...options, selection: { ...options.selection, credentialFingerprint: 'rotated' } },
      { ...options, gradingSelection: { ...options.gradingSelection, model: 'different-model' } },
      {
        ...options,
        gradingSelection: { ...options.gradingSelection, endpoint: 'https://other.example' },
      },
      {
        ...options,
        gradingSelection: { ...options.gradingSelection, isolatedImage: 'other-image' },
      },
      {
        ...options,
        gradingSelection: {
          ...options.gradingSelection,
          moderationCredentialFingerprint: 'c'.repeat(64),
        },
      },
      {
        ...options,
        gradingSelection: { ...options.gradingSelection, credentialFingerprint: 'b'.repeat(64) },
      },
      { ...options, task: { ...task, userId: 'other-learner' } },
      { ...options, task: { ...task, assessmentAttempt: task.assessmentAttempt + 1 } },
      { ...options, task: { ...task, prompt: { ...task.prompt, mode: 'COMMUNICATIVE' as const } } },
      { ...options, task: { ...task, prompt: { ...task.prompt, privateRubric: 'Changed' } } },
    ])
      expect(assessmentSpeakingInputDigest(assessmentSpeakingInput(changed))).not.toBe(original);
    expect(() => assessmentSpeakingInput({ ...options, audio: new Uint8Array() })).toThrow();
    expect(() => assessmentSpeakingInputSchema.parse({ ...identity, unexpected: true })).toThrow();
    expect(() =>
      assessmentSpeakingInputSchema.parse({ ...identity, gradingSelection: undefined })
    ).toThrow();
    expect(() =>
      assessmentSpeakingInputSchema.parse({
        ...identity,
        gradingSelection: {
          ...identity.gradingSelection,
          moderationCredentialFingerprint: undefined,
        },
      })
    ).toThrow();
    const legacyTask = selectAssessmentSpeakingTask({ material: assessment, scope }, 'speaking-0');
    expect(() => assessmentSpeakingInput({ ...options, task: legacyTask })).toThrow(/criteria/);
    const readAloud = {
      ...legacyTask,
      prompt: {
        ...legacyTask.prompt,
        mode: 'READ_ALOUD' as const,
        privateRubric: READ_ALOUD_ASSESSMENT_RUBRIC,
      },
    };
    const bound = assessmentSpeakingInput({
      ...options,
      task: readAloud,
      speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY,
    });
    expect(bound.speakingPolicy).toBe(READ_ALOUD_ASSESSMENT_POLICY);
    expect(assessmentSpeakingInputDigest(bound)).not.toBe(original);
    const unbound = { ...bound };
    delete unbound.speakingPolicy;
    expect(assessmentSpeakingInputDigest(bound)).not.toBe(assessmentSpeakingInputDigest(unbound));
    expect(() => assessmentSpeakingInput({ ...options, task: readAloud })).toThrow(/criteria/);
    expect(() =>
      assessmentSpeakingInput({ ...options, task, speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY })
    ).toThrow(/criteria/);
    expect(() =>
      assessmentSpeakingInput({
        ...options,
        task: { ...readAloud, prompt: { ...readAloud.prompt, privateRubric: 'Assess accent.' } },
        speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY,
      })
    ).toThrow();
    expect(() =>
      assessmentSpeakingInput({
        ...options,
        task: { ...task, prompt: { ...task.prompt, privateCriteria: [] } },
      })
    ).toThrow();
  });
  it('keeps legacy assessment hashes stable and reviews explicit speaking evidence modalities', () => {
    const { assessment, scope } = fixture();
    const legacyDigest = objectiveEvidenceHash(assessment);
    expect(assessmentMaterialDigest(assessment)).toBe(legacyDigest);
    const sections = assessment.sections.map((section) =>
      section.skill === 'SPEAKING'
        ? {
            ...section,
            items: section.items.map((item) => ({
              ...item,
              privateCriteria: [
                { id: 'meaning', description: 'Conveys meaning', modality: 'TRANSCRIPT' },
                { id: 'pronunciation', description: 'Articulates sounds', modality: 'ACOUSTIC' },
              ],
            })),
          }
        : section
    );
    const material = parseAssessmentMaterial({ ...assessment, version: 2, sections });
    expect(assessmentMaterialDigest(material)).not.toBe(legacyDigest);
    expect(
      JSON.stringify(publicAssessmentMaterial(material, reviewed(scope, material)))
    ).not.toMatch(/privateCriteria|pronunciation|Articulates sounds/);
    expect(() => evaluateAssessmentMaterial(material, reviewed(scope, material), [], [])).toThrow(
      /criteria require verified evidence/
    );
    expect(() =>
      evaluateRetainedAssessmentMaterial(
        material,
        {
          formativeIds: scope.formativeItemIds,
          formativeTasks: scope.formativeTasks,
          passThresholds: scope.passThresholds,
        },
        [],
        []
      )
    ).toThrow(/Retained assessment material is incomplete/);
    expect(reviewSections(material).find((section) => section.skill === 'SPEAKING')).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          criteria: [
            expect.objectContaining({ modality: 'TRANSCRIPT' }),
            expect.objectContaining({ modality: 'ACOUSTIC' }),
          ],
        }),
      ]),
    });
    const speaking = sections.find((section) => section.skill === 'SPEAKING');
    if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Missing speaking section');
    const duplicate = structuredClone(sections);
    const duplicateSpeaking = duplicate.find((section) => section.skill === 'SPEAKING');
    if (!duplicateSpeaking || duplicateSpeaking.skill !== 'SPEAKING')
      throw new Error('Missing speaking section');
    duplicateSpeaking.items[0]!.privateCriteria[1]!.id = 'meaning';
    expect(() =>
      parseAssessmentMaterial({ ...assessment, version: 2, sections: duplicate })
    ).toThrow();
    expect(() =>
      parseAssessmentMaterial({ ...assessment, version: 2, sections: assessment.sections })
    ).toThrow();
  });
  it.each(['READ_ALOUD', 'COMMUNICATIVE'] as const)(
    'binds the private %s speaking task to its reviewed assessment',
    (mode) => {
      const { assessment, scope } = fixture();
      const section = assessment.sections.find((entry) => entry.skill === 'SPEAKING');
      if (!section || section.skill !== 'SPEAKING') throw new Error('Missing speaking section');
      section.items[0]!.mode = mode;
      const captured = { material: assessment, scope: reviewed(scope, assessment) };
      expect(selectAssessmentSpeakingTask(captured, 'speaking-0')).toMatchObject({
        assessmentId: assessment.id,
        classId: assessment.classId,
        userId: assessment.userId,
        assessmentAttempt: assessment.assessmentAttempt,
        materialDigest: captured.scope.reviewedMaterialDigest,
        sectionId: section.id,
        prompt: { id: 'speaking-0', mode, privateRubric: 'private speaking rubric' },
      });
      expect(() => selectAssessmentSpeakingTask(captured, 'foreign-prompt')).toThrow();
      section.items.push({ ...section.items[0]! });
      expect(() => selectAssessmentSpeakingTask(captured, 'speaking-0')).toThrow();
      section.items.pop();
      assessment.sections.push({ ...section, id: 'duplicate-section' });
      expect(() => selectAssessmentSpeakingTask(captured, 'speaking-0')).toThrow();
    }
  );
  it('projects all required skills without private keys, explanations, rubrics or listening transcript', () => {
    const { assessment, scope } = fixture();
    const result = publicAssessmentMaterial(assessment, scope);
    expect(classAssessmentMaterialSchema.parse(result)).toEqual(result);
    expect(result.sections.map((section) => section.skill)).toEqual([
      'GRAMMAR',
      'READING',
      'LISTENING',
      'SPEAKING',
      'WRITING',
    ]);
    const json = JSON.stringify(result);
    for (const secret of [
      'correctIndex',
      'explanation',
      'privateRubric',
      'privateTranslation',
      'privateTranscript',
      'private explanation',
      'private speaking rubric',
      'private speaking guidance',
      'private writing guidance',
      'private starter',
      'private transcript',
    ])
      expect(json).not.toContain(secret);
    expect(json).not.toContain('owned-audio');
    expect(json).not.toContain('reference-0');
    expect(json).toContain('audioAvailable');
  });

  it('rejects a foreign owner, stale material, repeated items and formative identities', () => {
    const { assessment, scope } = fixture();
    expect(() => validateAssessmentMaterial(assessment, { ...scope, userId: 'other' })).toThrow(
      /owned class/
    );
    expect(() =>
      validateAssessmentMaterial(assessment, { ...scope, formativeRevision: 'changed' })
    ).toThrow(/owned class/);
    expect(() =>
      validateAssessmentMaterial(assessment, {
        ...scope,
        passThresholds: { ...scope.passThresholds, WRITING: 0.9 },
      })
    ).toThrow(/thresholds/);
    const duplicate = structuredClone(assessment);
    duplicate.sections[1].items[0].id = duplicate.sections[0].items[0].id;
    expect(() => validateAssessmentMaterial(duplicate, reviewed(scope, duplicate))).toThrow(
      /unique held-out/
    );
    expect(() =>
      validateAssessmentMaterial(assessment, { ...scope, formativeItemIds: ['GRAMMAR-0'] })
    ).toThrow(/unique held-out/);
  });

  it('rejects changed content, unrelated media and copied formative tasks', () => {
    const { assessment, scope } = fixture();
    const changed = structuredClone(assessment);
    const writing = changed.sections.find((section) => section.skill === 'WRITING')!;
    if (writing.skill !== 'WRITING') throw new Error('writing fixture');
    writing.items[0].task = 'A different task';
    expect(() => publicAssessmentMaterial(changed, scope)).toThrow(/owned class/);
    expect(() => evaluateAssessmentMaterial(changed, scope, [], [])).toThrow(/owned class/);
    expect(() =>
      publicAssessmentMaterial(assessment, {
        ...scope,
        ownedListening: { ...scope.ownedListening!, episodeId: 'foreign' },
      })
    ).toThrow(/owned media/);
    expect(() =>
      publicAssessmentMaterial(assessment, {
        ...scope,
        ownedSpeakingReferences: {
          ...scope.ownedSpeakingReferences,
          'speaking-0': { id: 'foreign', status: 'READY', storageRef: '/foreign' },
        },
      })
    ).toThrow(/owned media/);
    expect(() =>
      publicAssessmentMaterial(assessment, {
        ...scope,
        formativeTasks: [
          {
            skill: 'GRAMMAR',
            task: '  task grammar 0  ',
            options: ['four', 'three', 'two', 'one'],
          },
        ],
      })
    ).toThrow(/differ/);
    expect(() =>
      publicAssessmentMaterial(assessment, {
        ...scope,
        review: { ...scope.review, formativeRevision: 'stale' },
      })
    ).toThrow(/owned class/);
  });

  it('binds private grading context while keeping JSON object key order stable', () => {
    const { assessment } = fixture();
    const first = structuredClone(assessment);
    const second = structuredClone(assessment);
    const writingFirst = first.sections.find((section) => section.skill === 'WRITING')!;
    const writingSecond = second.sections.find((section) => section.skill === 'WRITING')!;
    if (writingFirst.skill !== 'WRITING' || writingSecond.skill !== 'WRITING')
      throw new Error('writing fixture');
    writingFirst.items[0].privateLearningObjectives = { beta: 2, alpha: { y: 1, x: 2 } };
    writingSecond.items[0].privateLearningObjectives = { alpha: { x: 2, y: 1 }, beta: 2 };
    expect(assessmentMaterialDigest(first)).toBe(assessmentMaterialDigest(second));
    const original = assessmentMaterialDigest(first);
    writingSecond.items[0].privateGuidance = 'Different grading guidance';
    expect(assessmentMaterialDigest(second)).not.toBe(original);
    writingSecond.items[0].privateGuidance = writingFirst.items[0].privateGuidance;
    writingSecond.items[0].privateIdeas.push('Different grading idea');
    expect(assessmentMaterialDigest(second)).not.toBe(original);
    writingSecond.items[0].privateIdeas = [...writingFirst.items[0].privateIdeas];
    const speaking = second.sections.find((section) => section.skill === 'SPEAKING')!;
    if (speaking.skill !== 'SPEAKING') throw new Error('speaking fixture');
    speaking.items[0].privateGuidance = 'Different speaking guidance';
    expect(assessmentMaterialDigest(second)).not.toBe(original);
  });

  it('rejects missing exercises, duplicate tasks, and listening transcript in a public passage', () => {
    const { assessment, scope } = fixture();
    const incomplete = structuredClone(assessment);
    incomplete.sections[0].items.pop();
    expect(() => publicAssessmentMaterial(incomplete, reviewed(scope, incomplete))).toThrow(
      /incomplete/
    );
    const repeated = structuredClone(assessment);
    const grammar = repeated.sections.find((section) => section.skill === 'GRAMMAR')!;
    if (grammar.skill !== 'GRAMMAR') throw new Error('grammar fixture');
    grammar.items[1].question = grammar.items[0].question;
    expect(() => publicAssessmentMaterial(repeated, reviewed(scope, repeated))).toThrow(/differ/);
    const exposed = structuredClone(assessment);
    const listening = exposed.sections.find((section) => section.skill === 'LISTENING')!;
    if (listening.skill !== 'LISTENING') throw new Error('listening fixture');
    listening.passageText = 'private transcript';
    expect(() => publicAssessmentMaterial(exposed, reviewed(scope, exposed))).toThrow(
      /unexpected passage/
    );
  });

  it('allows the same direction for different tasks and freezes audio identity separately from readiness', () => {
    const { assessment, scope } = fixture();
    const distinct = structuredClone(assessment);
    const grammar = distinct.sections.find((section) => section.skill === 'GRAMMAR')!;
    if (grammar.skill !== 'GRAMMAR') throw new Error('grammar fixture');
    grammar.items[1].question = grammar.items[0].question;
    grammar.items[1].options = ['five', 'six', 'seven', 'eight'];
    expect(() => publicAssessmentMaterial(distinct, reviewed(scope, distinct))).not.toThrow();
    const pendingAudio = { ...scope.ownedListening!, status: 'PENDING', audioUrl: null };
    expect(() =>
      publicAssessmentMaterial(assessment, { ...scope, ownedListening: pendingAudio })
    ).toThrow(/audio.*preparing/i);
    const renewedAudio = { ...scope.ownedListening!, audioUrl: '/renewed-url' };
    expect(() =>
      publicAssessmentMaterial(assessment, { ...scope, ownedListening: renewedAudio })
    ).not.toThrow();
    expect(() =>
      publicAssessmentMaterial(assessment, {
        ...scope,
        ownedListening: { ...renewedAudio, privateTranscript: 'different transcript' },
      })
    ).toThrow(/owned media/);
  });

  it('projects previously seen tasks without grading secrets and rejects reordered repeats', () => {
    const { assessment } = fixture();
    const prior = exposedAssessmentTasks(assessment);
    expect(JSON.stringify(prior)).not.toMatch(
      /correctIndex|explanation|rubric|guidance|privateLearningObjectives|private translation/
    );
    expect(prior.find((task) => task.skill === 'LISTENING')).toMatchObject({
      context: 'private transcript',
    });
    const next = structuredClone(assessment);
    const grammar = next.sections.find((section) => section.skill === 'GRAMMAR');
    if (!grammar || grammar.skill !== 'GRAMMAR') throw new Error('grammar fixture missing');
    grammar.items = grammar.items.map((item) => ({
      ...item,
      id: `new-${item.id}`,
      options: [...item.options].reverse(),
    }));
    expect(() => assertAssessmentTaskIndependence(next, [], prior)).toThrow(/differ/);
  });

  it('requires owned ready speaking references when the captured policy requires them', () => {
    const { assessment, scope } = fixture();
    for (const reference of [
      null,
      { id: 'reference-0', status: 'PENDING', storageRef: null },
      { id: 'reference-0', status: 'READY', storageRef: null },
    ]) {
      expect(() =>
        publicAssessmentMaterial(assessment, {
          ...scope,
          ownedSpeakingReferences: { ...scope.ownedSpeakingReferences, 'speaking-0': reference },
        })
      ).toThrow(/owned media/);
    }
    const communicative = structuredClone(assessment);
    const speaking = communicative.sections.find((section) => section.skill === 'SPEAKING')!;
    if (speaking.skill !== 'SPEAKING') throw new Error('speaking fixture');
    speaking.items[0].mode = 'COMMUNICATIVE';
    speaking.items[0].referenceAudioId = null;
    const next = reviewed(
      {
        ...scope,
        ownedSpeakingReferences: { ...scope.ownedSpeakingReferences, 'speaking-0': null },
      },
      communicative
    );
    expect(() => publicAssessmentMaterial(communicative, next)).not.toThrow();
  });

  it('uses canonical per-skill mastery and checks scoped productive evidence', () => {
    const { assessment, scope } = fixture();
    const answers = assessment.sections
      .filter((section) => ['GRAMMAR', 'READING', 'LISTENING'].includes(section.skill))
      .flatMap((section) => section.items.map((item) => ({ itemId: item.id, selectedIndex: 1 })));
    const evidence = assessment.sections
      .filter((section) => ['SPEAKING', 'WRITING'].includes(section.skill))
      .flatMap((section) =>
        section.items.map((item) => ({
          assessmentId: assessment.id,
          userId: assessment.userId,
          classAttempt: assessment.classAttempt,
          assessmentAttempt: assessment.assessmentAttempt,
          itemId: item.id,
          sectionId: section.id,
          operationId: `operation-${item.id}`,
          status: 'SCORED',
          materialDigest: scope.reviewedMaterialDigest,
          score: 0.8,
        }))
      );
    expect(evaluateAssessmentMaterial(assessment, scope, answers, evidence)).toMatchObject({
      complete: true,
      mastered: true,
    });
    const passed = assessmentEvaluationReceipt(
      assessment,
      evaluateAssessmentMaterial(assessment, scope, answers, evidence)
    );
    expect(passed).toMatchObject({
      source: 'ASSESSMENT',
      passed: true,
      passedSections: 5,
      totalSections: 5,
    });
    expect(passed.overallScore).toBeCloseTo(0.92);
    expect(() =>
      assessmentEvaluationReceipt(
        assessment,
        evaluateAssessmentMaterial(assessment, scope, answers.slice(1), evidence)
      )
    ).toThrow('Assessment is incomplete.');
    expect(evaluateAssessmentMaterial(assessment, scope, answers.slice(1), evidence)).toMatchObject(
      { complete: false, mastered: false }
    );
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, [...answers, answers[0]], evidence)
    ).toThrow(/duplicated/);
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, answers, [{ ...evidence[0], userId: 'other' }])
    ).toThrow(/different material or learner/);
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, answers, [{ ...evidence[0], score: 2 }])
    ).toThrow();
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, answers, [
        { ...evidence[0], materialDigest: 'a'.repeat(64) },
      ])
    ).toThrow(/different material/);
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, answers, [
        { ...evidence[0], sectionId: 'section-writing' },
      ])
    ).toThrow(/different material/);
    expect(() =>
      evaluateAssessmentMaterial(assessment, scope, answers, [
        evidence[0],
        { ...evidence[1], operationId: evidence[0].operationId },
      ])
    ).toThrow(/different material/);
    const failedSpeaking = evidence.map((entry) =>
      entry.itemId.startsWith('speaking-') ? { ...entry, score: 0.6 } : entry
    );
    expect(evaluateAssessmentMaterial(assessment, scope, answers, failedSpeaking)).toMatchObject({
      complete: true,
      mastered: false,
    });
    expect(
      assessmentEvaluationReceipt(
        assessment,
        evaluateAssessmentMaterial(assessment, scope, answers, failedSpeaking)
      )
    ).toMatchObject({ passed: false, passedSections: 4, totalSections: 5 });
  });

  it('rejects oversized material before accepting a review', () => {
    const { assessment, scope } = fixture();
    const oversized = structuredClone(assessment);
    const writing = oversized.sections.find((section) => section.skill === 'WRITING')!;
    if (writing.skill !== 'WRITING') throw new Error('writing fixture');
    writing.items[0].privateRubric = 'x'.repeat(1_000_001);
    expect(() => publicAssessmentMaterial(oversized, scope)).toThrow(/size limit/);
  });

  it('retains only genuine captured provider exemptions', () => {
    const { assessment, scope } = fixture();
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const exempt = {
      ...assessment,
      requirements,
      sections: assessment.sections.filter(
        (section) => section.skill !== 'LISTENING' && section.skill !== 'SPEAKING'
      ),
    };
    const exemptScope = reviewed({ ...scope, requirements, ownedListening: null }, exempt);
    expect(
      publicAssessmentMaterial(exempt, exemptScope).sections.map((section) => section.skill)
    ).toEqual(['GRAMMAR', 'READING', 'WRITING']);
    const extra = { ...assessment, requirements };
    expect(() => validateAssessmentMaterial(extra, reviewed(exemptScope, extra))).toThrow(
      /requirements/
    );
    expect(() => validateAssessmentMaterial(exempt, scope)).toThrow(/owned class/);
  });

  it('recomputes the same failed receipt from verified retained tasks and evidence', () => {
    const { assessment, scope } = fixture();
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    const material = {
      ...assessment,
      requirements,
      sections: assessment.sections.filter(
        (section) => section.skill !== 'LISTENING' && section.skill !== 'SPEAKING'
      ),
    };
    const currentScope = reviewed({ ...scope, requirements, ownedListening: null }, material);
    const choices = material.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        'correctIndex' in item
          ? [{ itemId: item.id, selectedIndex: section.skill === 'GRAMMAR' ? 0 : 1 }]
          : []
      )
    );
    const evidence = material.sections.flatMap((section) =>
      section.skill === 'WRITING'
        ? section.items.map((item) => ({
            assessmentId: material.id,
            userId: material.userId,
            classAttempt: material.classAttempt,
            assessmentAttempt: material.assessmentAttempt,
            itemId: item.id,
            sectionId: section.id,
            operationId: `operation-${item.id}`,
            status: 'SCORED',
            materialDigest: currentScope.reviewedMaterialDigest,
            score: 0.8,
          }))
        : []
    );
    const retained = {
      formativeIds: currentScope.formativeItemIds,
      formativeTasks: currentScope.formativeTasks,
      passThresholds: currentScope.passThresholds,
    };
    const live = evaluateAssessmentMaterial(material, currentScope, choices, evidence);
    const historical = evaluateRetainedAssessmentMaterial(material, retained, choices, evidence);
    expect(assessmentEvaluationReceipt(material, historical)).toEqual(
      assessmentEvaluationReceipt(material, live)
    );
    expect(historical.mastered).toBe(false);
    expect(() =>
      evaluateRetainedAssessmentMaterial(
        { ...material, sections: material.sections.slice(1) },
        retained,
        choices,
        evidence
      )
    ).toThrow(/incomplete/);
  });

  it('recomputes mixed speaking and writing results only under the reviewed read-aloud policy', () => {
    const { assessment, scope } = fixture();
    const speaking = assessment.sections.find((section) => section.skill === 'SPEAKING');
    if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Speaking fixture missing');
    for (const item of speaking.items) item.privateRubric = READ_ALOUD_ASSESSMENT_RUBRIC;
    const currentScope = reviewed(scope, assessment);
    const choices = assessment.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        'correctIndex' in item
          ? [
              {
                itemId: item.id,
                selectedIndex: section.skill === 'GRAMMAR' ? 0 : item.correctIndex,
              },
            ]
          : []
      )
    );
    const evidence = assessment.sections.flatMap((section) =>
      section.skill === 'SPEAKING' || section.skill === 'WRITING'
        ? section.items.map((item) => ({
            assessmentId: assessment.id,
            userId: assessment.userId,
            classAttempt: assessment.classAttempt,
            assessmentAttempt: assessment.assessmentAttempt,
            itemId: item.id,
            sectionId: section.id,
            operationId: `operation-${item.id}`,
            status: 'SCORED',
            materialDigest: currentScope.reviewedMaterialDigest,
            score: 0.8,
          }))
        : []
    );
    const retained = {
      formativeIds: currentScope.formativeItemIds,
      formativeTasks: currentScope.formativeTasks,
      passThresholds: currentScope.passThresholds,
    };
    expect(() =>
      evaluateRetainedAssessmentMaterial(assessment, retained, choices, evidence)
    ).toThrow(/incomplete/);
    const historical = evaluateRetainedAssessmentMaterial(
      assessment,
      { ...retained, speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY },
      choices,
      evidence
    );
    const live = evaluateAssessmentMaterial(assessment, currentScope, choices, evidence);
    expect(assessmentEvaluationReceipt(assessment, historical)).toEqual(
      assessmentEvaluationReceipt(assessment, live)
    );
    expect(historical.mastered).toBe(false);
    speaking.items[0]!.privateRubric = 'Assess accent.';
    expect(() =>
      evaluateRetainedAssessmentMaterial(
        assessment,
        { ...retained, speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY },
        choices,
        evidence
      )
    ).toThrow();
  });
});
