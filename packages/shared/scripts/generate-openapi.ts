// Generates packages/shared/openapi.json — an OpenAPI 3.0.3 document built from
// the Zod contract registry in src/contracts. 3.0.3 (not 3.1) is deliberate:
// the Rust codegen phase uses `progenitor`, which only supports OpenAPI 3.0.x.
// Zod emits JSON Schema 2020-12, so every schema is post-processed through a pure
// `to30` transform before assembly. The committed JSON is the codegen input; a
// drift test keeps it in sync. Run with: npm run gen:openapi
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { endpoints, type EndpointDef } from '../src/contracts/endpoints';
import {
  cefrLevelSchema,
  courseSummarySchema,
  coursesListResponseSchema,
  healthCheckResultSchema,
  healthResponseSchema,
  pairedUserSchema,
  practiceItemSchema,
  practiceKindSchema,
  practiceOverviewResponseSchema,
  practiceRecentSessionSchema,
  practiceSpeakingPromptSchema,
  practiceStatusSchema,
  practiceWritingPromptSchema,
  redeemPairingRequestSchema,
  redeemPairingResponseSchema,
  startPracticeReadySchema,
  startPracticeReadySpeakingSchema,
  startPracticeReadyWritingSchema,
  startPracticeRequestSchema,
  startPracticeResponseSchema,
  startPracticeUnavailableSchema,
  submitPracticeRequestSchema,
  submitPracticeResponseSchema,
  userRoleSchema,
} from '../src/contracts/schemas';

const here = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(here, '..');

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonSchema = { [key: string]: JsonValue };

// The response emitted for the StartPracticeResponse component: a 3.0
// discriminated oneOf over the four named variant components.
const START_PRACTICE_RESPONSE_NAME = 'StartPracticeResponse';
const startPracticeVariants: Record<string, string> = {
  unavailable: 'StartPracticeUnavailable',
  ready: 'StartPracticeReady',
  ready_speaking: 'StartPracticeReadySpeaking',
  ready_writing: 'StartPracticeReadyWriting',
};

// Named component schemas. Reusable leaves are registered so they emit `$ref`
// pointers instead of being inlined — this keeps the document DRY and gives the
// Rust codegen clean, named types. Order is irrelevant; refs resolve by id.
const namedSchemas: Record<string, z.ZodType> = {
  CefrLevel: cefrLevelSchema,
  PracticeKind: practiceKindSchema,
  PracticeStatus: practiceStatusSchema,
  UserRole: userRoleSchema,
  HealthCheckResult: healthCheckResultSchema,
  HealthResponse: healthResponseSchema,
  CourseSummary: courseSummarySchema,
  CoursesListResponse: coursesListResponseSchema,
  PracticeRecentSession: practiceRecentSessionSchema,
  PracticeOverviewResponse: practiceOverviewResponseSchema,
  PracticeItem: practiceItemSchema,
  PracticeSpeakingPrompt: practiceSpeakingPromptSchema,
  PracticeWritingPrompt: practiceWritingPromptSchema,
  StartPracticeRequest: startPracticeRequestSchema,
  StartPracticeUnavailable: startPracticeUnavailableSchema,
  StartPracticeReady: startPracticeReadySchema,
  StartPracticeReadySpeaking: startPracticeReadySpeakingSchema,
  StartPracticeReadyWriting: startPracticeReadyWritingSchema,
  [START_PRACTICE_RESPONSE_NAME]: startPracticeResponseSchema,
  SubmitPracticeRequest: submitPracticeRequestSchema,
  SubmitPracticeResponse: submitPracticeResponseSchema,
  RedeemPairingRequest: redeemPairingRequestSchema,
  RedeemPairingResponse: redeemPairingResponseSchema,
  PairedUser: pairedUserSchema,
};

// Map a Zod schema instance back to its component name so endpoints can $ref it.
const nameBySchema = new Map<z.ZodType, string>(
  Object.entries(namedSchemas).map(([name, schema]) => [schema, name]),
);

function refFor(schema: z.ZodType): { $ref: string } {
  const name = nameBySchema.get(schema);
  if (!name) {
    throw new Error(
      'Endpoint schema is not registered as a named component. Add it to namedSchemas in generate-openapi.ts.',
    );
  }
  return { $ref: `#/components/schemas/${name}` };
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullBranch(value: JsonValue): boolean {
  return isObject(value) && value.type === 'null' && Object.keys(value).length === 1;
}

// JSON-Schema-2020-12 keywords that OpenAPI 3.0 rejects. Dropped wholesale.
const DROP_KEYWORDS = new Set([
  '$schema',
  '$id',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'prefixItems',
]);

// Pure, deterministic transform: JSON Schema 2020-12 (Zod output) -> OpenAPI 3.0.
// Recurses into every schema-bearing position and rewrites the handful of
// constructs that differ between the dialects. Key insertion order is preserved
// so the serialized document stays stable for the drift test.
function to30(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(to30);
  if (!isObject(node)) return node;

  // Nullable: `anyOf`/`oneOf` of [schema, {type:'null'}] -> drop the null branch,
  // mark the survivor nullable. Also handles a lone tail null branch.
  for (const combinator of ['anyOf', 'oneOf'] as const) {
    const branches = node[combinator];
    if (Array.isArray(branches) && branches.some(isNullBranch)) {
      const kept = branches.filter((b) => !isNullBranch(b));
      if (kept.length === 1 && isObject(kept[0])) {
        const survivor = to30(kept[0]) as { [key: string]: JsonValue };
        const rest = { ...node };
        delete rest[combinator];
        // A bare `$ref` can't carry sibling keywords in 3.0; wrap it in `allOf`
        // so `nullable` is legal. Otherwise merge keywords onto the survivor.
        if ('$ref' in survivor) {
          return { ...to30Object(rest), nullable: true, allOf: [survivor] };
        }
        return { ...to30Object(rest), ...survivor, nullable: true };
      }
      // Multiple non-null branches: keep the combinator, mark it nullable.
      const rebuilt: JsonSchema = { ...node, [combinator]: kept, nullable: true };
      return to30Object(rebuilt);
    }
  }

  // `type: [T, 'null']` tuple -> `type: T` + nullable.
  if (Array.isArray(node.type) && node.type.includes('null')) {
    const nonNull = node.type.filter((t) => t !== 'null');
    const rebuilt: JsonSchema = { ...node };
    rebuilt.type = nonNull.length === 1 ? nonNull[0] : nonNull;
    rebuilt.nullable = true;
    return to30Object(rebuilt);
  }

  return to30Object(node);
}

// Transform an object node's own keywords (after nullable handling above).
function to30Object(node: { [key: string]: JsonValue }): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROP_KEYWORDS.has(key)) continue;

    // 3.0 has no `const`; express the single value as a one-element enum.
    if (key === 'const') {
      out.enum = [value];
      continue;
    }
    out[key] = to30(value);
  }
  return out;
}

// Build components.schemas via a single registry pass so cross-references emit
// as `$ref`, then run each through `to30`. The StartPracticeResponse entry is
// replaced with an explicit oneOf + discriminator over its named variants.
function buildComponentsSchemas(): Record<string, JsonValue> {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(namedSchemas)) {
    registry.add(schema, { id: name });
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
  });

  const out: Record<string, JsonValue> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    out[name] = to30(schema as JsonValue);
  }

  out[START_PRACTICE_RESPONSE_NAME] = {
    oneOf: Object.values(startPracticeVariants).map((variant) => ({
      $ref: `#/components/schemas/${variant}`,
    })),
    discriminator: {
      propertyName: 'status',
      mapping: Object.fromEntries(
        Object.entries(startPracticeVariants).map(([value, variant]) => [
          value,
          `#/components/schemas/${variant}`,
        ]),
      ),
    },
  };

  return out;
}

// Path-template params (e.g. {courseId}) -> OpenAPI path parameter objects.
function pathParameters(path: string): JsonValue[] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function operationFor(endpoint: EndpointDef): JsonValue {
  const statuses = endpoint.successStatuses ?? [200];
  const responseRef = refFor(endpoint.response);
  const responses: JsonSchema = {};
  for (const status of statuses) {
    responses[String(status)] = {
      description: status >= 500 ? 'Degraded' : 'Success',
      content: { 'application/json': { schema: responseRef } },
    };
  }

  const operation: JsonSchema = {
    operationId: endpoint.id,
    summary: endpoint.summary,
    responses,
  };

  const parameters = pathParameters(endpoint.path);
  if (parameters.length > 0) operation.parameters = parameters;

  if (endpoint.request) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: refFor(endpoint.request) } },
    };
  }

  if (endpoint.auth === 'bearer') operation.security = [{ bearerAuth: [] }];

  return operation;
}

function buildPaths(): Record<string, JsonValue> {
  const paths: Record<string, JsonSchema> = {};
  for (const endpoint of endpoints) {
    const entry = (paths[endpoint.path] ??= {});
    entry[endpoint.method.toLowerCase()] = operationFor(endpoint);
  }
  return paths;
}

export function buildOpenApiDocument(): JsonSchema {
  const pkg = JSON.parse(
    readFileSync(resolve(sharedRoot, 'package.json'), 'utf8'),
  ) as { version: string };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Sotto API',
      version: pkg.version,
      description:
        'Core /api/v1 surface consumed by the Sotto terminal client. Generated from the Zod contract registry in @sotto/shared.',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A long-lived Sotto API key (sk_sotto_...) minted via /api/v1/auth/pair/redeem.',
        },
      },
      schemas: buildComponentsSchemas(),
    },
    paths: buildPaths(),
  };
}

export const OPENAPI_OUTPUT_PATH = resolve(sharedRoot, 'openapi.json');

function main(): void {
  const doc = buildOpenApiDocument();
  writeFileSync(OPENAPI_OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${OPENAPI_OUTPUT_PATH}\n`);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
