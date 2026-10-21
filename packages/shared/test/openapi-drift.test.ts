// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildOpenApiDocument,
  OPENAPI_CODEGEN_OUTPUT_PATH,
  OPENAPI_OUTPUT_PATH,
  OPENAPI_TUI_VENDOR_PATH,
} from '../scripts/generate-openapi';
import { endpoints } from '../src/contracts';

describe('openapi.json drift guard', () => {
  it('matches the committed spec (run npm run gen:openapi)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_OUTPUT_PATH, 'utf8'));
    const regenerated = buildOpenApiDocument();
    expect(regenerated).toEqual(committed);
  });

  it('regeneration is deterministic / idempotent', () => {
    expect(buildOpenApiDocument()).toEqual(buildOpenApiDocument());
    expect(buildOpenApiDocument({ codegen: true })).toEqual(
      buildOpenApiDocument({ codegen: true })
    );
  });

  it('matches the committed codegen spec (progenitor input)', () => {
    const committed = JSON.parse(readFileSync(OPENAPI_CODEGEN_OUTPUT_PATH, 'utf8'));
    const regenerated = buildOpenApiDocument({ codegen: true });
    expect(regenerated).toEqual(committed);
  });

  it('the tui crate vendored codegen spec is byte-for-byte in sync', () => {
    // `tui/openapi.codegen.json` is the copy the Rust `generate_api!` macro reads
    // so the crate builds standalone / is publishable. `gen:openapi` writes it
    // alongside the canonical spec; this guards against an out-of-sync vendor.
    const canonical = readFileSync(OPENAPI_CODEGEN_OUTPUT_PATH, 'utf8');
    const vendored = readFileSync(OPENAPI_TUI_VENDOR_PATH, 'utf8');
    expect(vendored).toBe(canonical);
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
      codegen.paths as Record<string, Record<string, { responses?: object }>>
    )) {
      for (const op of Object.values(ops)) {
        const twoxx = Object.keys(op.responses ?? {}).filter((s) => s.startsWith('2'));
        const refs = new Set(
          twoxx.map(
            (s) =>
              (
                (op.responses as Record<string, Record<string, unknown>>)[s].content as Record<
                  string,
                  { schema: { $ref?: string } }
                >
              )['application/json'].schema.$ref
          )
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
            responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }>;
          }
        >
      >
    )['/api/v1/courses/{courseId}/next-class'].post;
    expect(op.responses['201'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/NextClassCreatedResponse'
    );
    expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/NextClassDoneResponse'
    );
  });

  it('exposes exactly the seeded endpoints with their methods', () => {
    const ids = endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(ids).toEqual(
      [
        'GET /api/v1/health',
        'GET /api/v1/play/rooms',
        'POST /api/v1/play/rooms',
        'GET /api/v1/play/rooms/{roomId}',
        'POST /api/v1/play/rooms/{roomId}/actions',
        'POST /api/v1/play/rooms/{roomId}/presence',
        'GET /api/v1/play/rooms/{roomId}/invitations',
        'POST /api/v1/play/rooms/{roomId}/invitations',
        'GET /api/v1/play/rooms/{roomId}/join-requests',
        'GET /api/v1/play/enrollments',
        'GET /api/v1/play/invitations',
        'POST /api/v1/play/invitations',
        'GET /api/v1/play/join-requests/{requestId}',
        'POST /api/v1/play/join-requests/{requestId}/approve',
        'POST /api/v1/play/join-requests/{requestId}/claim',
        'POST /api/v1/play/join-requests/{requestId}/ack',
        'GET /api/v1/play/phrases',
        'POST /api/v1/play/phrases',
        'GET /api/v1/courses',
        'GET /api/v1/courses/{courseId}/notes',
        'GET /api/v1/materials/{materialId}/legacy-text',
        'DELETE /api/v1/courses/{courseId}',
        'POST /api/v1/placement/manual',
        'POST /api/v1/material-analyses/{analysisId}/retry',
        'POST /api/v1/material-analyses/{analysisId}/cancellation',
        'GET /api/v1/material-analyses/{analysisId}',
        'GET /api/v1/material-analyses/{analysisId}/focuses/{focusId}',
        'GET /api/v1/courses/{courseId}/learning-targets',
        'GET /api/v1/courses/{courseId}/practice',
        'GET /api/v1/courses/{courseId}/learning-map',
        'GET /api/v1/learning-map/upgrade',
        'GET /api/v1/courses/{courseId}/learning-map/upgrade',
        'POST /api/v1/courses/{courseId}/learning-map/upgrade',
        'GET /api/v1/courses/{courseId}/learning-map/levels/{level}',
        'GET /api/v1/courses/{courseId}/learning-map/objectives/{objectiveId}',
        'GET /api/v1/courses/{courseId}/learning-map/objectives/{objectiveId}/history',
        'GET /api/v1/courses/{courseId}/material-analyses',
        'POST /api/v1/courses/{courseId}/learning-map/advance',
        'POST /api/v1/courses/{courseId}/learning-map/selection',
        'GET /api/v1/courses/{courseId}/vocabulary',
        'PATCH /api/v1/courses/{courseId}/vocabulary/{wordId}',
        'POST /api/v1/courses/{courseId}/vocabulary/study',
        'POST /api/v1/courses/{courseId}/vocabulary/{wordId}/audio',
        'POST /api/v1/practice/{sessionId}/vocabulary',
        'POST /api/v1/practice/{sessionId}/vocabulary/{cardId}/audio',
        'POST /api/v1/materials/{materialId}/vocabulary-index',
        'POST /api/v1/courses/{courseId}/learning-targets',
        'POST /api/v1/courses/{courseId}/learning-targets/{targetId}/pronunciation',
        'POST /api/v1/courses/{courseId}/learning-targets/{targetId}/visual-cue',
        'POST /api/v1/courses/{courseId}/practice',
        'POST /api/v1/practice/{sessionId}/submit',
        'GET /api/v1/episodes/{episodeId}',
        'GET /api/v1/practice/{sessionId}/speaking/{promptId}',
        'GET /api/v1/practice/{sessionId}',
        'PATCH /api/v1/practice/{sessionId}',
        'POST /api/v1/practice/{sessionId}/generation',
        'POST /api/v1/courses/{courseId}/next-class',
        'GET /api/v1/classes/{classId}',
        'GET /api/v1/classes/{classId}/pencil',
        'POST /api/v1/classes/{classId}/pencil',
        'POST /api/v1/classes/{classId}',
        'POST /api/v1/classes/{classId}/submit',
        'POST /api/v1/exams',
        'GET /api/v1/exams/{examId}',
        'POST /api/v1/exams/{examId}/submit',
        'GET /api/v1/placement',
        'POST /api/v1/placement',
        'POST /api/v1/placement/from-notes',
        'POST /api/v1/placement/from-notes/confirm',
        'POST /api/v1/placement/generate',
        'GET /api/v1/courses/{courseId}/graph',
        'GET /api/v1/onboarding/config',
        'GET /api/v1/users/me',
        'POST /api/v1/episodes/{episodeId}/interact',
        'GET /api/v1/episodes/{episodeId}/interact/{interactionId}',
        'POST /api/v1/auth/pair/redeem',
        'GET /api/v1/learn/activity',
        'GET /api/v1/courses/{courseId}/exams',
      ].sort()
    );
  });

  it('declares the speaking poll recordingId query parameter', () => {
    const doc = buildOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, { parameters?: unknown[] }>>)[
      '/api/v1/practice/{sessionId}/speaking/{promptId}'
    ].get;
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
    const schemas = (doc.components as Record<string, Record<string, unknown>>).schemas as Record<
      string,
      { additionalProperties?: unknown }
    >;

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
      // Exam schemas are subsets of richer Prisma rows -> open.
      'ExamEpisodeRef',
      'ExamSection',
      'ExamResult',
      'ExamDetailResponse',
      // Memory + onboarding-infra are subsets/projections -> open.
      'MemoryNode',
      'MemoryEdge',
      'MemoryGraphResponse',
      'OnboardingInfra',
      // The interaction response is a subset of the richer Prisma row -> open.
      'InteractionResponse',
      // /users/me returns a richer row; the CLI reads the identity subset -> open.
      'MeResponse',
    ]) {
      expect(schemas[open].additionalProperties).not.toBe(false);
    }
    for (const closed of [
      'CoursesListResponse',
      'PracticeOverviewResponse',
      'SubmitPracticeResponse',
      'StartPracticeReady',
      'StartPracticeReadyFull',
      'RedeemPairingResponse',
      // Class submit + speaking prompt are exact-match -> closed.
      'ClassSpeakingPrompt',
      'SubmitClassRequest',
      'SubmitClassResponse',
      'SubmitClassSectionResult',
      // next-class returns exactly one closed shape per status.
      'NextClassCreatedResponse',
      'NextClassDoneResponse',
      // Exam start/submit + speaking-prompt are exact-match -> closed.
      'ExamSpeakingPrompt',
      'StartExamRequest',
      'StartExamResponse',
      'SubmitExamRequest',
      'ExamSectionScore',
      'SubmitExamResponse',
      // Placement question + responses + config are exact projections -> closed.
      'PlacementQuestion',
      'GeneratePlacementResponse',
      'SubmitPlacementRequest',
      'SubmitPlacementResponse',
      'OnboardingConfigResponse',
      // The ask request is the exact body the route validates -> closed.
      'AskInteractionRequest',
    ]) {
      expect(schemas[closed].additionalProperties).toBe(false);
    }
  });

  it('EpisodeStatus covers the Prisma enum including TRANSCRIBING', () => {
    const doc = buildOpenApiDocument();
    const schemas = (doc.components as Record<string, Record<string, unknown>>).schemas as Record<
      string,
      { enum?: string[] }
    >;
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
    const schemas = (doc.components as Record<string, Record<string, unknown>>).schemas;
    const response = schemas.StartPracticeResponse as {
      oneOf: { $ref: string }[];
      discriminator: { propertyName: string; mapping: Record<string, string> };
    };
    expect(response.oneOf).toEqual([
      { $ref: '#/components/schemas/StartPracticePreparing' },
      { $ref: '#/components/schemas/StartPracticeUnavailable' },
      { $ref: '#/components/schemas/StartPracticeReady' },
      { $ref: '#/components/schemas/StartPracticeReadySpeaking' },
      { $ref: '#/components/schemas/StartPracticeReadyWriting' },
      { $ref: '#/components/schemas/StartPracticeReadyFull' },
      { $ref: '#/components/schemas/StartPracticeReadyVocabulary' },
    ]);
    expect(response.discriminator).toEqual({
      propertyName: 'status',
      mapping: {
        preparing: '#/components/schemas/StartPracticePreparing',
        unavailable: '#/components/schemas/StartPracticeUnavailable',
        ready: '#/components/schemas/StartPracticeReady',
        ready_speaking: '#/components/schemas/StartPracticeReadySpeaking',
        ready_writing: '#/components/schemas/StartPracticeReadyWriting',
        ready_full: '#/components/schemas/StartPracticeReadyFull',
        ready_vocabulary: '#/components/schemas/StartPracticeReadyVocabulary',
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
          (doc.paths as Record<string, Record<string, { responses: object }>>)[path][method] as {
            responses: object;
          }
        ).responses
      ).sort();
    expect(codes('/api/v1/health', 'get')).toEqual(['200', '503']);
    expect(codes('/api/v1/courses', 'get')).toEqual(['200']);
    expect(codes('/api/v1/courses/{courseId}/practice', 'get')).toEqual(['200']);
    expect(codes('/api/v1/courses/{courseId}/practice', 'post')).toEqual(['200', '202']);
    expect(codes('/api/v1/practice/{sessionId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/practice/{sessionId}', 'patch')).toEqual(['200']);
    expect(codes('/api/v1/practice/{sessionId}/generation', 'post')).toEqual(['200']);
    expect(codes('/api/v1/practice/{sessionId}/submit', 'post')).toEqual(['200']);
    expect(codes('/api/v1/episodes/{episodeId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/practice/{sessionId}/speaking/{promptId}', 'get')).toEqual(['200']);
    // next-class returns 200 { done } or 201 { classId }.
    expect(codes('/api/v1/courses/{courseId}/next-class', 'post')).toEqual(['200', '201']);
    expect(codes('/api/v1/classes/{classId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/classes/{classId}/submit', 'post')).toEqual(['200']);
    // Exam start returns 201; get/submit return 200.
    expect(codes('/api/v1/exams', 'post')).toEqual(['201']);
    expect(codes('/api/v1/exams/{examId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/exams/{examId}/submit', 'post')).toEqual(['200']);
    // Placement admission can be pending while polling retains its exact session.
    expect(codes('/api/v1/placement', 'get')).toEqual(['200', '202']);
    expect(codes('/api/v1/placement', 'post')).toEqual(['200']);
    expect(codes('/api/v1/courses/{courseId}/graph', 'get')).toEqual(['200']);
    expect(codes('/api/v1/onboarding/config', 'get')).toEqual(['200']);
    expect(codes('/api/v1/users/me', 'get')).toEqual(['200']);
    // Ask creates a PENDING interaction (201); polling reads it (200).
    expect(codes('/api/v1/episodes/{episodeId}/interact', 'post')).toEqual(['201']);
    expect(codes('/api/v1/episodes/{episodeId}/interact/{interactionId}', 'get')).toEqual(['200']);
    expect(codes('/api/v1/auth/pair/redeem', 'post')).toEqual(['200']);
  });

  it('declares exact placement admission, source and polling identities', () => {
    const doc = buildOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, { parameters?: unknown[] }>>)[
      '/api/v1/placement'
    ].get;
    expect(op.parameters).toContainEqual({
      name: 'native',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
    expect(op.parameters).toContainEqual({
      name: 'target',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
    expect(op.parameters).toContainEqual({
      name: 'requestId',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
    expect(op.parameters).toContainEqual({
      name: 'placementSessionId',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
    expect(op.parameters).toContainEqual({
      name: 'resultDigest',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
  });
});
