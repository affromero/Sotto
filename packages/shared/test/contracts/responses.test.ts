import { describe, expect, it } from 'vitest';
import {
  askInteractionRequestSchema,
  classDetailResponseSchema,
  coursesListResponseSchema,
  episodeDetailResponseSchema,
  examDetailResponseSchema,
  generatePlacementResponseSchema,
  healthResponseSchema,
  interactionResponseSchema,
  meResponseSchema,
  memoryGraphResponseSchema,
  nextClassCreatedResponseSchema,
  nextClassDoneResponseSchema,
  onboardingConfigResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingResponseSchema,
  speakingPollResponseSchema,
  startPracticeResponseSchema,
  submitClassResponseSchema,
  submitExamResponseSchema,
  submitPlacementResponseSchema,
  submitPracticeResponseSchema,
  manualPlacementResponseSchema,
  deleteCourseResponseSchema,
} from '../../src/contracts/schemas';

describe('response schemas accept representative payloads', () => {
  it('health (unauthenticated shape)', () => {
    expect(
      healthResponseSchema.parse({
        status: 'healthy',
        version: 'dev',
        timestamp: '2026-06-13T00:00:00.000Z',
      })
    ).toBeTruthy();
  });

  it('courses list', () => {
    expect(
      coursesListResponseSchema.parse({
        courses: [
          {
            id: 'c1',
            nativeLang: 'en',
            targetLang: 'es',
            currentLevel: 'A1',
            startLevel: 'A1',
            placementSource: 'TEST',
            activeClassId: null,
            curriculum: { title: 'Spanish for English speakers' },
            placement: { level: 'A1', createdAt: '2026-06-13T00:00:00.000Z' },
          },
        ],
      })
    ).toBeTruthy();
  });

  it('practice overview', () => {
    expect(
      practiceOverviewResponseSchema.parse({
        due: { vocab: 3, grammar: 1 },
        totalVocab: 42,
        recent: [
          {
            id: 's1',
            kind: 'VOCAB',
            status: 'COMPLETED',
            score: 0.83,
            startedAt: '2026-06-13T00:00:00.000Z',
            completedAt: '2026-06-13T00:05:00.000Z',
          },
        ],
      })
    ).toBeTruthy();
  });

  it('start practice — every union branch', () => {
    const preparing = startPracticeResponseSchema.parse({
      status: 'preparing',
      sessionId: 's1',
      preparationStatus: 'RUNNING',
      message: 'Preparing saved practice.',
      canRecover: false,
    });
    expect(preparing).toMatchObject({ status: 'preparing', preparationStatus: 'RUNNING' });
    expect(
      startPracticeResponseSchema.parse({
        status: 'unavailable',
        reason: 'nothing_due',
      })
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready',
        sessionId: 's1',
        kind: 'GRAMMAR',
        items: [{ id: 'q0', prompt: 'Pick one', options: ['a', 'b'] }],
      })
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready_speaking',
        sessionId: 's2',
        prompts: [
          {
            id: 'p1',
            targetPhrase: 'Hola',
            translation: 'Hello',
            referenceTtsUrl: null,
          },
        ],
      })
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready_writing',
        sessionId: 's3',
        prompts: [{ id: 'w1', task: 'Describe your day', guidance: null }],
      })
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready_full',
        sessionId: 's4',
        kind: 'FULL',
        items: [{ id: 'q0', prompt: 'Pick one', options: ['a', 'b'] }],
        speakingPrompts: [
          {
            id: 'p1',
            targetPhrase: 'Hola',
            translation: 'Hello',
            referenceTtsUrl: null,
          },
        ],
        writingPrompts: [{ id: 'w1', task: 'Describe your day', guidance: null }],
      })
    ).toBeTruthy();
  });

  it('submit practice', () => {
    expect(submitPracticeResponseSchema.parse({ score: 0.5, correct: 3, total: 6 })).toBeTruthy();
  });

  it('episode detail (segments with resolved audio, nullable fields)', () => {
    expect(
      episodeDetailResponseSchema.parse({
        id: 'ep1',
        title: 'Cafe conversation',
        status: 'READY',
        audioUrl: 'https://cdn.example/ep1.mp3',
        duration: 312,
        language: 'es',
        segments: [
          {
            id: 'seg1',
            speaker: 'Host',
            text: 'Hola, ¿qué tal?',
            audioUrl: 'https://cdn.example/seg1.mp3',
            order: 0,
            startTime: 0,
            duration: 4.2,
          },
          {
            id: 'seg2',
            speaker: 'Guest',
            text: 'Muy bien, gracias.',
            audioUrl: null,
            order: 1,
            startTime: null,
            duration: null,
          },
        ],
      })
    ).toBeTruthy();
  });

  it('speaking poll (pending then scored)', () => {
    expect(
      speakingPollResponseSchema.parse({
        status: 'PENDING',
        overallScore: null,
        transcript: null,
        feedback: null,
      })
    ).toBeTruthy();
    expect(
      speakingPollResponseSchema.parse({
        status: 'SCORED',
        overallScore: 0.87,
        transcript: 'Hola, ¿qué tal?',
        feedback: 'Great rhythm; soften the final vowel.',
      })
    ).toBeTruthy();
  });

  it('episode/segment schemas accept the route superset (loose)', () => {
    // The real route returns full Prisma rows; the loosened schemas must accept
    // and preserve the extra fields rather than rejecting them.
    const parsed = episodeDetailResponseSchema.parse({
      id: 'ep1',
      title: 'Cafe conversation',
      status: 'TRANSCRIBING',
      audioUrl: null,
      duration: null,
      language: 'es',
      // Server-only fields the client ignores but must not be rejected.
      visibility: 'UNLISTED',
      isSaved: false,
      fileSize: 12345,
      tags: [],
      segments: [
        {
          id: 'seg1',
          speaker: 'Host',
          text: 'Hola',
          audioUrl: null,
          order: 0,
          startTime: null,
          duration: null,
          episodeId: 'ep1',
          version: 1,
          wordTimings: null,
          ttsProvider: 'openai',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ],
    }) as Record<string, unknown>;
    // Extra keys survive (loose passthrough), proving the object is open.
    expect(parsed.visibility).toBe('UNLISTED');

    const poll = speakingPollResponseSchema.parse({
      status: 'SCORED',
      overallScore: 0.9,
      transcript: 'Hola',
      feedback: 'Nice.',
      rubricScores: { accuracy: 0.9, fluency: 0.88, completeness: 1 },
      phonemeScores: [{ word: 'hola', ops: [] }],
    }) as Record<string, unknown>;
    expect(poll.rubricScores).toBeDefined();
  });

  it('redeem pairing token (user may be null)', () => {
    expect(
      redeemPairingResponseSchema.parse({
        token: 'sk_sotto_abc123',
        user: {
          id: 'u1',
          name: null,
          email: 'learner@example.com',
          image: null,
          role: 'USER',
        },
      })
    ).toBeTruthy();
    expect(redeemPairingResponseSchema.parse({ token: 'sk_sotto_xyz', user: null })).toBeTruthy();
  });

  it('next class — distinct closed shapes per status', () => {
    // 201 created: { classId } required, nothing extra.
    expect(nextClassCreatedResponseSchema.parse({ classId: 'cls1' })).toBeTruthy();
    expect(() => nextClassCreatedResponseSchema.parse({ done: true })).toThrow();
    // 200 done: { done: true } required.
    expect(nextClassDoneResponseSchema.parse({ done: true })).toBeTruthy();
    expect(() => nextClassDoneResponseSchema.parse({ done: false })).toThrow();
    expect(() => nextClassDoneResponseSchema.parse({ classId: 'x' })).toThrow();
  });

  it('class detail (mixed sections, route superset is loose)', () => {
    const parsed = classDetailResponseSchema.parse({
      id: 'cls1',
      courseId: 'course1',
      status: 'IN_PROGRESS',
      order: 3,
      passThreshold: 0.7,
      submitted: false,
      // Server-only fields the client ignores; must survive (loose).
      lesson: { objective: 'Past tense' },
      submission: null,
      sourceUrl: null,
      sourceTitle: null,
      sections: [
        {
          id: 'sec-g',
          skill: 'GRAMMAR',
          status: 'READY',
          attempt: 1,
          score: null,
          passed: false,
          episode: null,
          questions: [
            {
              id: 'q0',
              order: 0,
              question: 'Pick the article',
              options: ['el', 'la', 'los', 'las'],
              passageRef: null,
              passageText: null,
            },
          ],
          prompts: [],
          writingPrompts: [],
        },
        {
          id: 'sec-l',
          skill: 'LISTENING',
          status: 'READY',
          attempt: 1,
          score: null,
          passed: false,
          episode: {
            id: 'ep1',
            audioUrl: 'https://cdn.example/ep1.mp3',
            title: 'At the cafe',
            references: [],
          },
          questions: [],
          prompts: [],
          writingPrompts: [],
        },
        {
          id: 'sec-w',
          skill: 'WRITING',
          status: 'READY',
          attempt: 1,
          score: null,
          passed: false,
          episode: null,
          questions: [],
          prompts: [],
          writingPrompts: [
            { id: 'w0', order: 0, task: 'Describe your day', guidance: null, response: null },
          ],
        },
      ],
    }) as Record<string, unknown>;
    expect(parsed.lesson).toBeDefined();
  });

  it('submit class result', () => {
    expect(
      submitClassResponseSchema.parse({
        passed: true,
        overallScore: 0.8,
        passedSections: 4,
        totalSections: 5,
        sections: [{ id: 'sec-g', skill: 'GRAMMAR', score: 0.9, passed: true }],
      })
    ).toBeTruthy();
  });

  it('exam detail (mixed sections, route superset is loose)', () => {
    const parsed = examDetailResponseSchema.parse({
      id: 'exam1',
      institution: 'CEFR_GENERIC',
      institutionLabel: 'CEFR (generic)',
      level: 'B1',
      status: 'IN_PROGRESS',
      examName: 'Mock B1',
      // Server-only / extra fields the client ignores; must survive (loose).
      createdAt: '2026-06-13T00:00:00.000Z',
      result: null,
      sections: [
        {
          id: 'ex-g',
          skill: 'GRAMMAR',
          part: 'Part 1',
          order: 0,
          format: 'mcq',
          weight: 0.25,
          status: 'READY',
          score: null,
          episode: null,
          speakingPrompts: [],
          writingPrompts: [],
          questions: [
            {
              id: 'g0',
              order: 0,
              question: 'Choose',
              options: ['a', 'b', 'c', 'd'],
              passageRef: null,
              passageText: null,
            },
          ],
        },
        {
          id: 'ex-l',
          skill: 'LISTENING',
          part: 'Part 3',
          order: 1,
          format: 'mcq',
          weight: 0.2,
          status: 'READY',
          score: null,
          episode: { id: 'ep1', audioUrl: null, status: 'GENERATING_AUDIO' },
          speakingPrompts: [],
          writingPrompts: [],
          questions: [],
        },
      ],
    }) as Record<string, unknown>;
    expect(parsed.createdAt).toBeDefined();

    // A scored exam carries the band/feedback result.
    expect(
      examDetailResponseSchema.parse({
        id: 'exam1',
        institution: 'CEFR_GENERIC',
        institutionLabel: 'CEFR',
        level: 'B2',
        status: 'SCORED',
        examName: 'Mock B2',
        sections: [],
        result: {
          overallScore: 0.74,
          band: 'B2',
          feedback: 'Strong reading.',
          sectionResults: [{ sectionId: 'ex-g', skill: 'GRAMMAR', score: 0.8, feedback: null }],
        },
      })
    ).toBeTruthy();
  });

  it('submit exam result (band + per-section)', () => {
    expect(
      submitExamResponseSchema.parse({
        overallScore: 0.72,
        band: 'B2',
        feedback: 'Solid overall.',
        sections: [
          { sectionId: 'ex-g', skill: 'GRAMMAR', weight: 0.5, score: 0.8 },
          { sectionId: 'ex-r', skill: 'READING', weight: 0.5, score: 0.6 },
        ],
      })
    ).toBeTruthy();
  });

  it('placement questions (generate response)', () => {
    expect(
      generatePlacementResponseSchema.parse({
        native: 'en',
        target: 'es',
        questions: [
          {
            id: 'pq_0',
            cefr: 'A2',
            skill: 'grammar',
            prompt: 'Choose the article',
            options: ['el', 'la', 'los', 'las'],
          },
        ],
      })
    ).toBeTruthy();
  });

  it('submit placement result (level + per-skill ratios)', () => {
    expect(
      submitPlacementResponseSchema.parse({
        courseId: 'c-new',
        level: 'B1',
        scoreBySkill: { grammar: 0.8, vocab: 0.5, reading: 0.6 },
      })
    ).toBeTruthy();
  });

  it('manual placement result (courseId + level)', () => {
    expect(manualPlacementResponseSchema.parse({ courseId: 'c-new', level: 'C1' })).toBeTruthy();
  });

  it('delete course result (deleted flag + counts)', () => {
    expect(
      deleteCourseResponseSchema.parse({
        deleted: true,
        episodesDeleted: 3,
        filesAttempted: 12,
        filesDeleted: 11,
        filesFailed: 1,
      })
    ).toBeTruthy();
  });

  it('memory graph (vocab + grammar nodes, loose superset)', () => {
    const parsed = memoryGraphResponseSchema.parse({
      nodes: [
        {
          id: 'v0',
          kind: 'vocab',
          label: 'casa',
          translation: 'house',
          strength: 0.6,
          due: true,
          // Server-only extra fields the client ignores; must survive (loose).
          lastReviewedAt: '2026-06-13T00:00:00.000Z',
        },
        { id: 'g0', kind: 'grammar', label: 'Past tense', strength: 0.4, due: false },
      ],
      edges: [{ source: 'v0', target: 'g0', type: 'reinforces', weight: 1 }],
    }) as { nodes: Array<Record<string, unknown>> };
    expect(parsed.nodes[0].lastReviewedAt).toBeDefined();
    // Grammar nodes have no translation.
    expect(parsed.nodes[1].translation).toBeUndefined();
  });

  it('onboarding config (owner sees infra, non-owner gets null)', () => {
    expect(
      onboardingConfigResponseSchema.parse({
        selfHosted: true,
        isOwner: true,
        infra: {
          aiProvider: 'openai',
          aiModel: 'gpt-5',
          aiBaseUrl: null,
          sttProvider: 'whisper',
          sttBaseUrl: null,
          sttModel: null,
          ttsProvider: 'elevenlabs',
          ttsBaseUrl: null,
          storageProvider: 'r2',
          s3Bucket: 'sotto',
          s3Region: 'auto',
        },
      })
    ).toBeTruthy();
    expect(
      onboardingConfigResponseSchema.parse({
        selfHosted: false,
        isOwner: false,
        infra: null,
      })
    ).toBeTruthy();
  });

  it('me (identity subset; tolerates the rich route extras)', () => {
    // The route returns more than the CLI reads; `.loose()` keeps the extras.
    const parsed = meResponseSchema.parse({
      id: 'u_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      image: null,
      episodeCount: 12,
      createdAt: '2026-01-01T00:00:00.000Z',
      preferredLanguage: 'es',
    });
    expect(parsed.id).toBe('u_1');
    // A minimal identity (only id) is also valid.
    expect(meResponseSchema.parse({ id: 'u_2' }).id).toBe('u_2');
  });

  it('ask interaction request (the exact validated body)', () => {
    expect(
      askInteractionRequestSchema.parse({
        question: 'What does casa mean?',
        timestamp: 12.5,
      })
    ).toBeTruthy();
    // Empty question and negative timestamp are rejected.
    expect(() => askInteractionRequestSchema.parse({ question: '', timestamp: 0 })).toThrow();
    expect(() => askInteractionRequestSchema.parse({ question: 'hi', timestamp: -1 })).toThrow();
  });

  it('interaction response (pending -> answered, nullable fields)', () => {
    // Pending: no answer yet.
    expect(
      interactionResponseSchema.parse({
        id: 'int-1',
        question: 'What does casa mean?',
        timestamp: 0,
        status: 'PENDING',
        answer: null,
        helpful: null,
        segmentOrder: null,
      })
    ).toBeTruthy();
    // Answered: text present, and the POST's extra row fields are tolerated
    // because the schema is `.loose()`.
    expect(
      interactionResponseSchema.parse({
        id: 'int-1',
        question: 'What does casa mean?',
        timestamp: 0,
        status: 'ANSWERED',
        answer: 'It means house.',
        helpful: true,
        segmentOrder: 2,
        userId: 'u-extra',
        createdAt: '2026-06-13T00:00:00.000Z',
      })
    ).toBeTruthy();
  });
});
