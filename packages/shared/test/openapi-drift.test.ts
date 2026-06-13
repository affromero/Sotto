import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildOpenApiDocument,
  OPENAPI_CODEGEN_OUTPUT_PATH,
  OPENAPI_OUTPUT_PATH,
} from '../scripts/generate-openapi';
import { endpoints } from '../src/contracts';
import {
  classDetailResponseSchema,
  coursesListResponseSchema,
  episodeDetailResponseSchema,
  healthResponseSchema,
  nextClassCreatedResponseSchema,
  nextClassDoneResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingResponseSchema,
  speakingPollResponseSchema,
  startPracticeResponseSchema,
  submitClassResponseSchema,
  submitPracticeResponseSchema,
} from '../src/contracts/schemas';

describe('openapi.json drift guard', () => {
  it('matches the committed spec (run npm run gen:openapi)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_OUTPUT_PATH, 'utf8'));
    const regenerated = buildOpenApiDocument();
    expect(regenerated).toEqual(committed);
  });

  it('regeneration is deterministic / idempotent', () => {
    expect(buildOpenApiDocument()).toEqual(buildOpenApiDocument());
    expect(buildOpenApiDocument({ codegen: true })).toEqual(
      buildOpenApiDocument({ codegen: true }),
    );
  });

  it('matches the committed codegen spec (progenitor input)', () => {
    const committed = JSON.parse(
      readFileSync(OPENAPI_CODEGEN_OUTPUT_PATH, 'utf8'),
    );
    const regenerated = buildOpenApiDocument({ codegen: true });
    expect(regenerated).toEqual(committed);
  });

  it('codegen spec excludes operations progenitor cannot generate', () => {
    // next-class (two distinct 2xx bodies) is in the truthful spec but NOT the
    // codegen spec, which progenitor's generate_api! consumes.
    const full = buildOpenApiDocument();
    const codegen = buildOpenApiDocument({ codegen: true });
    const path = '/api/v1/courses/{courseId}/next-class';
    expect((full.paths as Record<string, unknown>)[path]).toBeDefined();
    expect((codegen.paths as Record<string, unknown>)[path]).toBeUndefined();
    // No codegen operation declares two distinct 2xx response bodies (the
    // progenitor constraint that motivated the exclusion).
    for (const ops of Object.values(
      codegen.paths as Record<string, Record<string, { responses?: object }>>,
    )) {
      for (const op of Object.values(ops)) {
        const twoxx = Object.keys(op.responses ?? {}).filter((s) =>
          s.startsWith('2'),
        );
        const refs = new Set(
          twoxx.map(
            (s) =>
              (
                (op.responses as Record<string, Record<string, unknown>>)[s]
                  .content as Record<string, Record<string, { schema: { $ref?: string } }>>
              )['application/json'].schema.$ref,
          ),
        );
        expect(refs.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('next-class emits a distinct schema per success status', () => {
    const doc = buildOpenApiDocument();
    const op = (
      doc.paths as Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              { content: Record<string, { schema: { $ref: string } }> }
            >;
          }
        >
      >
    )['/api/v1/courses/{courseId}/next-class'].post;
    expect(op.responses['201'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/NextClassCreatedResponse',
    );
    expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/NextClassDoneResponse',
    );
  });

  it('exposes exactly the seeded endpoints with their methods', () => {
    const ids = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(ids).toEqual(
      [
        'GET /api/v1/health',
        'GET /api/v1/courses',
        'GET /api/v1/courses/{courseId}/practice',
        'POST /api/v1/courses/{courseId}/practice',
        'POST /api/v1/practice/{sessionId}/submit',
        'GET /api/v1/episodes/{episodeId}',
        'GET /api/v1/practice/{sessionId}/speaking/{promptId}',
        'POST /api/v1/courses/{courseId}/next-class',
        'GET /api/v1/classes/{classId}',
        'POST /api/v1/classes/{classId}/submit',
        'POST /api/v1/auth/pair/redeem',
      ].sort(),
    );
  });

  it('declares the speaking poll recordingId query parameter', () => {
    const doc = buildOpenApiDocument();
    const op = (
      doc.paths as Record<string, Record<string, { parameters?: unknown[] }>>
    )['/api/v1/practice/{sessionId}/speaking/{promptId}'].get;
    expect(op.parameters).toContainEqual({
      name: 'recordingId',
      in: 'query',
      required: true,
      schema: { type: 'string' },
    });
  });

  // The episode + speaking-poll schemas model a SUBSET of the route response,
  // so they must be OPEN (not `additionalProperties: false`) or the contract
  // lies about the superset the routes return. Exact-match schemas stay closed.
  it('leaves subset-of-route response schemas open and exact-match ones closed', () => {
    const doc = buildOpenApiDocument();
    const schemas = (doc.components as Record<string, Record<string, unknown>>)
      .schemas as Record<string, { additionalProperties?: unknown }>;

    for (const open of [
      'EpisodeSegment',
      'EpisodeDetailResponse',
      'SpeakingPollResponse',
      // Class schemas are subsets of richer Prisma rows -> open.
      'ClassQuestion',
      'ClassWritingPrompt',
      'ClassEpisodeRef',
      'ClassSection',
      'ClassDetailResponse',
    ]) {
      expect(schemas[open].additionalProperties).not.toBe(false);
    }
    for (const closed of [
      'CoursesListResponse',
      'PracticeOverviewResponse',
      'SubmitPracticeResponse',
      'StartPracticeReady',
      'RedeemPairingResponse',
      // Class submit + speaking prompt are exact-match -> closed.
      'ClassSpeakingPrompt',
      'SubmitClassRequest',
      'SubmitClassResponse',
      'SubmitClassSectionResult',
      // next-class returns exactly one closed shape per status.
      'NextClassCreatedResponse',
      'NextClassDoneResponse',
    ]) {
      expect(schemas[closed].additionalProperties).toBe(false);
    }
  });

  it('EpisodeStatus covers the Prisma enum including TRANSCRIBING', () => {
    const doc = buildOpenApiDocument();
    const schemas = (doc.components as Record<string, Record<string, unknown>>)
      .schemas as Record<string, { enum?: string[] }>;
    expect(schemas.EpisodeStatus.enum).toContain('TRANSCRIBING');
  });
});

// Guards the progenitor codegen contract: progenitor only supports OpenAPI 3.0.x,
// which forbids the 2020-12 constructs Zod emits (const, propertyNames, null-type).
describe('progenitor-ready OpenAPI 3.0.3 invariants', () => {
  const doc = buildOpenApiDocument();

  function everyNode(node: unknown): Record<string, unknown>[] {
    const acc: Record<string, unknown>[] = [];
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(visit);
        return;
      }
      if (n && typeof n === 'object') {
        const obj = n as Record<string, unknown>;
        acc.push(obj);
        Object.values(obj).forEach(visit);
      }
    };
    visit(node);
    return acc;
  }

  it('declares OpenAPI 3.0.3', () => {
    expect(doc.openapi).toBe('3.0.3');
  });

  it('contains no 2020-12-only keywords', () => {
    for (const node of everyNode(doc)) {
      expect(node).not.toHaveProperty('const');
      expect(node).not.toHaveProperty('propertyNames');
      expect(node).not.toHaveProperty('$schema');
      expect(node).not.toHaveProperty('prefixItems');
      expect(node).not.toHaveProperty('unevaluatedProperties');
      expect(node.type).not.toBe('null');
    }
  });

  it('uses no $ref with sibling keywords (illegal in 3.0)', () => {
    for (const node of everyNode(doc)) {
      if ('$ref' in node) {
        expect(Object.keys(node)).toEqual(['$ref']);
      }
    }
  });

  it('StartPracticeResponse is a discriminated oneOf over named variants', () => {
    const schemas = (doc.components as Record<string, Record<string, unknown>>)
      .schemas;
    const response = schemas.StartPracticeResponse as {
      oneOf: { $ref: string }[];
      discriminator: { propertyName: string; mapping: Record<string, string> };
    };
    expect(response.oneOf).toEqual([
      { $ref: '#/components/schemas/StartPracticeUnavailable' },
      { $ref: '#/components/schemas/StartPracticeReady' },
      { $ref: '#/components/schemas/StartPracticeReadySpeaking' },
      { $ref: '#/components/schemas/StartPracticeReadyWriting' },
    ]);
    expect(response.discriminator).toEqual({
      propertyName: 'status',
      mapping: {
        unavailable: '#/components/schemas/StartPracticeUnavailable',
        ready: '#/components/schemas/StartPracticeReady',
        ready_speaking: '#/components/schemas/StartPracticeReadySpeaking',
        ready_writing: '#/components/schemas/StartPracticeReadyWriting',
      },
    });
    for (const variant of Object.values(response.discriminator.mapping)) {
      const name = variant.split('/').pop() as string;
      expect(schemas[name]).toBeDefined();
    }
  });

  it('emits the real success status codes per route', () => {
    const codes = (path: string, method: string): string[] =>
      Object.keys(
        (
          (doc.paths as Record<string, Record<string, { responses: object }>>)[
            path
          ][method] as { responses: object }
        ).responses,
      ).sort();
    expect(codes('/api/v1/health', 'get')).toEqual(['200', '503']);
    expect(codes('/api/v1/courses', 'get')).toEqual(['200']);
    expect(codes('/api/v1/courses/{courseId}/practice', 'get')).toEqual(['200']);
    expect(codes('/api/v1/courses/{courseId}/practice', 'post')).toEqual([
      '200',
      '201',
    ]);
    expect(codes('/api/v1/practice/{sessionId}/submit', 'post')).toEqual(['200']);
    expect(codes('/api/v1/episodes/{episodeId}', 'get')).toEqual(['200']);
    expect(
      codes('/api/v1/practice/{sessionId}/speaking/{promptId}', 'get'),
    ).toEqual(['200']);
    // next-class returns 200 { done } or 201 { classId }.
    expect(codes('/api/v1/courses/{courseId}/next-class', 'post')).toEqual([
      '200',
      '201',
    ]);
    expect(codes('/api/v1/classes/{classId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/classes/{classId}/submit', 'post')).toEqual(['200']);
    expect(codes('/api/v1/auth/pair/redeem', 'post')).toEqual(['200']);
  });
});

describe('response schemas accept representative payloads', () => {
  it('health (unauthenticated shape)', () => {
    expect(
      healthResponseSchema.parse({
        status: 'healthy',
        version: 'dev',
        timestamp: '2026-06-13T00:00:00.000Z',
      }),
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
            activeClassId: null,
            curriculum: { title: 'Spanish for English speakers' },
            placement: { level: 'A1', createdAt: '2026-06-13T00:00:00.000Z' },
          },
        ],
      }),
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
      }),
    ).toBeTruthy();
  });

  it('start practice — every union branch', () => {
    expect(
      startPracticeResponseSchema.parse({
        status: 'unavailable',
        reason: 'nothing_due',
      }),
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready',
        sessionId: 's1',
        kind: 'GRAMMAR',
        items: [{ id: 'q0', prompt: 'Pick one', options: ['a', 'b'] }],
      }),
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
      }),
    ).toBeTruthy();
    expect(
      startPracticeResponseSchema.parse({
        status: 'ready_writing',
        sessionId: 's3',
        prompts: [{ id: 'w1', task: 'Describe your day', guidance: null }],
      }),
    ).toBeTruthy();
  });

  it('submit practice', () => {
    expect(
      submitPracticeResponseSchema.parse({ score: 0.5, correct: 3, total: 6 }),
    ).toBeTruthy();
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
      }),
    ).toBeTruthy();
  });

  it('speaking poll (pending then scored)', () => {
    expect(
      speakingPollResponseSchema.parse({
        status: 'PENDING',
        overallScore: null,
        transcript: null,
        feedback: null,
      }),
    ).toBeTruthy();
    expect(
      speakingPollResponseSchema.parse({
        status: 'SCORED',
        overallScore: 0.87,
        transcript: 'Hola, ¿qué tal?',
        feedback: 'Great rhythm; soften the final vowel.',
      }),
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
          handle: null,
          image: null,
          role: 'USER',
        },
      }),
    ).toBeTruthy();
    expect(
      redeemPairingResponseSchema.parse({ token: 'sk_sotto_xyz', user: null }),
    ).toBeTruthy();
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
      }),
    ).toBeTruthy();
  });
});
