import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SottoClient } from './client.js';

const level = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const course = z.string().min(1).max(200);
const selection = z
  .object({
    catalogVersion: z.number().int().positive().nullable(),
    level,
    nodeIds: z.array(z.string().min(1).max(120)).max(8),
    materialFocusId: z.string().min(1).optional(),
  })
  .strict();

export function registerLearningTools(server: McpServer, client: SottoClient) {
  const result = async (work: () => Promise<unknown>) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await work()) }] };
    } catch (error) {
      return {
        content: [
          { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
        ],
        isError: true,
      };
    }
  };
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'list_courses',
    {
      description: 'List the active learner’s courses and current CEFR levels.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    () => result(() => client.learningRequest('GET', '/api/v1/courses'))
  );
  server.registerTool(
    'get_learning_map',
    {
      description:
        'Read a course’s Situations and Grammar trees, objective progress and level requirements. Lower-level browsing preserves the current level and active class.',
      inputSchema: { course_id: course, level: level.optional() },
      annotations: readAnnotations,
    },
    ({ course_id, level }) =>
      result(() =>
        client.learningRequest('GET', coursePath(course_id) + (level ? `/levels/${level}` : ''))
      )
  );
  server.registerTool(
    'get_learning_objective',
    {
      description:
        'Read the exact objective, its assessment criteria, ancestors and qualified progress.',
      inputSchema: {
        course_id: course,
        objective_id: z.string().min(1).max(120),
        level: level.optional(),
      },
      annotations: readAnnotations,
    },
    ({ course_id, objective_id, level }) =>
      result(() =>
        client.learningRequest(
          'GET',
          `${coursePath(course_id)}/objectives/${encodeURIComponent(objective_id)}${query({ level })}`
        )
      )
  );
  server.registerTool(
    'get_learning_evidence',
    {
      description:
        'Read a page of qualified assessment history. Upload exposure does not count as mastery.',
      inputSchema: {
        course_id: course,
        objective_id: z.string().min(1).max(120),
        level: level.optional(),
        after: z.string().max(2000).optional(),
      },
      annotations: readAnnotations,
    },
    ({ course_id, objective_id, level, after }) =>
      result(() =>
        client.learningRequest(
          'GET',
          `${coursePath(course_id)}/objectives/${encodeURIComponent(objective_id)}/history${query({ level, after })}`
        )
      )
  );
  server.registerTool(
    'list_source_analyses',
    {
      description:
        'List retained analyses and coverage for the active learner’s uploaded course sources.',
      inputSchema: { course_id: course, after: z.string().max(2000).optional() },
      annotations: readAnnotations,
    },
    ({ course_id, after }) =>
      result(() =>
        client.learningRequest(
          'GET',
          `/api/v1/courses/${encodeURIComponent(course_id)}/material-analyses${query({ after })}`
        )
      )
  );
  server.registerTool(
    'list_source_focuses',
    {
      description: 'Read a page of precise teaching focuses from a retained source analysis.',
      inputSchema: {
        analysis_id: z.uuid(),
        after_order: z.number().int().nonnegative().optional(),
      },
      annotations: readAnnotations,
    },
    ({ analysis_id, after_order }) =>
      result(() =>
        client.learningRequest(
          'GET',
          `/api/v1/material-analyses/${analysis_id}${query({ afterOrder: after_order?.toString() })}`
        )
      )
  );
  server.registerTool(
    'get_source_focus',
    {
      description: 'Read a private source focus with verified citations and extraction coverage.',
      inputSchema: { analysis_id: z.uuid(), focus_id: z.string().min(1).max(200) },
      annotations: readAnnotations,
    },
    ({ analysis_id, focus_id }) =>
      result(() =>
        client.learningRequest(
          'GET',
          `/api/v1/material-analyses/${analysis_id}/focuses/${encodeURIComponent(focus_id)}`
        )
      )
  );
  server.registerTool(
    'preview_focused_practice',
    {
      description:
        'Resolve selected groups or objectives into at most four exact objectives and available practice formats. A private source focus can be practised alone or combined with objectives.',
      inputSchema: { course_id: course, selection },
      annotations: readAnnotations,
    },
    ({ course_id, selection }) =>
      result(() => client.learningRequest('POST', `${coursePath(course_id)}/selection`, selection))
  );
  server.registerTool(
    'start_focused_practice',
    {
      description:
        'Generate a repeatable focused class through the configured providers. Use the preview’s explicit objective IDs and an available format. Preserve request_id and the exact selection when retrying a lost response. A new class requires a new request_id.',
      inputSchema: {
        course_id: course,
        request_id: z.uuid(),
        kind: z.enum(['FULL', 'GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
        selection,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ course_id, request_id, kind, selection }) =>
      result(() =>
        client.learningRequest(
          'POST',
          `/api/v1/courses/${encodeURIComponent(course_id)}/practice`,
          { requestId: request_id, kind, learningSelection: selection }
        )
      )
  );
  server.registerTool(
    'get_practice_session',
    {
      description:
        'Read saved practice material, progress or preparation status without starting another generation.',
      inputSchema: { session_id: z.string().min(1).max(200) },
      annotations: readAnnotations,
    },
    ({ session_id }) =>
      result(() =>
        client.learningRequest('GET', `/api/v1/practice/${encodeURIComponent(session_id)}`)
      )
  );
  server.registerTool(
    'advance_learning_level',
    {
      description:
        'Explicitly complete the current band after the server verifies every pinned requirement. Requires the learner’s request to advance. Preserve the same request_id, expected_level and catalog_hash on retries. C2 completion keeps the course at C2.',
      inputSchema: {
        course_id: course,
        request_id: z.uuid(),
        expected_level: level,
        catalog_hash: z.string().regex(/^[a-f0-9]{64}$/),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ course_id, request_id, expected_level, catalog_hash }) =>
      result(() =>
        client.learningRequest('POST', `${coursePath(course_id)}/advance`, {
          requestId: request_id,
          expectedLevel: expected_level,
          catalogHash: catalog_hash,
        })
      )
  );
}

function coursePath(id: string) {
  return `/api/v1/courses/${encodeURIComponent(id)}/learning-map`;
}
function query(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, value);
  return params.size ? `?${params}` : '';
}
