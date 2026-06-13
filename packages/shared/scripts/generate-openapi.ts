// Generates packages/shared/openapi.json — an OpenAPI 3.1 document built from
// the Zod contract registry in src/contracts. The committed JSON is the codegen
// input for the Rust terminal client; a drift test keeps it in sync. Run with:
//   npm run gen:openapi
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
  startPracticeRequestSchema,
  startPracticeResponseSchema,
  submitPracticeRequestSchema,
  submitPracticeResponseSchema,
  userRoleSchema,
} from '../src/contracts/schemas';

const here = dirname(fileURLToPath(import.meta.url));
const sharedRoot = resolve(here, '..');

type JsonSchema = Record<string, unknown>;

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
  StartPracticeResponse: startPracticeResponseSchema,
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

// Build components.schemas via a single registry pass so cross-references emit
// as `$ref`. Strip the per-schema `$schema`/`$id` keys (not valid inside an
// OpenAPI components.schemas entry).
function buildComponentsSchemas(): Record<string, JsonSchema> {
  const registry = z.registry<{ id: string }>();
  for (const [name, schema] of Object.entries(namedSchemas)) {
    registry.add(schema, { id: name });
  }
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    uri: (id) => `#/components/schemas/${id}`,
  });
  const out: Record<string, JsonSchema> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const { $schema: _schema, $id: _id, ...rest } = schema as JsonSchema;
    void _schema;
    void _id;
    out[name] = rest;
  }
  return out;
}

// Path-template params (e.g. {courseId}) -> OpenAPI path parameter objects.
function pathParameters(path: string): JsonSchema[] {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function operationFor(endpoint: EndpointDef): JsonSchema {
  const successStatus = endpoint.method === 'POST' ? '201' : '200';
  const operation: JsonSchema = {
    operationId: endpoint.id,
    summary: endpoint.summary,
    responses: {
      [successStatus]: {
        description: 'Success',
        content: { 'application/json': { schema: refFor(endpoint.response) } },
      },
    },
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

function buildPaths(): Record<string, JsonSchema> {
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
    openapi: '3.1.0',
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
