import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildOpenApiDocument,
  OPENAPI_OUTPUT_PATH,
} from '../scripts/generate-openapi';
import { endpoints } from '../src/contracts';
import {
  coursesListResponseSchema,
  healthResponseSchema,
  practiceOverviewResponseSchema,
  redeemPairingResponseSchema,
  startPracticeResponseSchema,
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
        'POST /api/v1/auth/pair/redeem',
      ].sort(),
    );
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
});
