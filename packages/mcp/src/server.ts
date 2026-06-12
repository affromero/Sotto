import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SottoClient, ApiError } from './client.js';
import {
  formatEpisodeDetail,
  formatEpisodeList,
  formatProfile,
  formatCreated,
  formatAgentIngested,
  formatDeleted,
} from './format.js';

function errorResult(err: unknown) {
  const message = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createServer(client: SottoClient): McpServer {
  const server = new McpServer({
    name: 'sotto',
    version: '0.1.0',
  });

  // --- Tools ---

  server.tool(
    'create_episode',
    'Create an AI episode from a topic. Returns the episode ID and kicks off the generation pipeline.',
    {
      title: z.string().describe('Episode title'),
      topic: z.string().describe('What the episode should be about'),
      depth: z
        .enum(['eli5', 'quick_overview', 'standard', 'deep_dive'])
        .optional()
        .describe('Content depth level'),
      audience_level: z
        .enum(['beginner', 'intermediate', 'expert'])
        .optional()
        .describe('Target audience expertise'),
      tone: z.enum(['casual', 'professional', 'socratic']).optional().describe('Conversation tone'),
      duration_minutes: z
        .number()
        .min(5)
        .max(40)
        .optional()
        .describe('Target duration in minutes (5-40)'),
      focus_areas: z
        .string()
        .optional()
        .describe('Comma-separated focus areas, e.g. "neural networks, backpropagation"'),
      source_url: z
        .string()
        .optional()
        .describe('URL to use as source material (article, paper, etc.)'),
    },
    async (params) => {
      try {
        const result = await client.createEpisode(params);
        return { content: [{ type: 'text', text: formatCreated(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'ingest_agent_output',
    'Create a private Sotto episode from output produced by a local agent run.',
    {
      title: z.string().describe('Episode title'),
      content: z.string().describe('Raw agent output, transcript, notes, or report to turn into audio'),
      tts_provider: z
        .enum(['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate', 'minimax', 'mistral'])
        .describe('Explicit TTS provider configured in Sotto'),
      topic: z.string().optional().describe('Optional topic override; defaults to title'),
      idempotency_key: z
        .string()
        .optional()
        .describe('Stable run key so retries do not create duplicate episodes'),
      source_url: z.string().optional().describe('Optional URL for the source run or report'),
      duration_minutes: z.number().min(1).max(40).optional().describe('Target duration in minutes'),
      depth: z
        .enum(['eli5', 'quick_overview', 'standard', 'deep_dive'])
        .optional()
        .describe('Content depth level'),
      audience_level: z
        .enum(['beginner', 'intermediate', 'expert', 'general'])
        .optional()
        .describe('Target audience expertise'),
      tone: z.string().optional().describe('Conversation tone'),
      focus_areas: z
        .string()
        .optional()
        .describe('Comma-separated focus areas, e.g. "bugs, tests, deployment"'),
      agent_provider: z
        .enum(['claude-code', 'codex', 'openclaw', 'hermes', 'custom'])
        .default('custom')
        .describe('Agent runtime that produced the output'),
      agent_name: z.string().default('Local agent').describe('Display name for the agent run'),
      agent_model: z.string().optional().describe('Agent model or local profile'),
      agent_run_id: z.string().optional().describe('Provider-specific run ID'),
      ai_model: z.string().optional().describe('Optional Sotto AI model for script generation'),
      tts_model: z.string().optional().describe('Optional provider-specific TTS model'),
    },
    async (params) => {
      try {
        const result = await client.ingestAgentOutput(params);
        return { content: [{ type: 'text', text: formatAgentIngested(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'get_episode',
    'Get episode details including status, segments, and Q&A interactions.',
    {
      episode_id: z.string().describe('The episode ID'),
    },
    async ({ episode_id }) => {
      try {
        const episode = await client.getEpisode(episode_id);
        return { content: [{ type: 'text', text: formatEpisodeDetail(episode) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'list_episodes',
    'List all your episodes, ordered by most recent first.',
    {},
    async () => {
      try {
        const episodes = await client.listEpisodes();
        return { content: [{ type: 'text', text: formatEpisodeList(episodes) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'update_episode',
    "Update a episode's title, topic, or visibility.",
    {
      episode_id: z.string().describe('The episode ID'),
      title: z.string().optional().describe('New title'),
      topic: z.string().optional().describe('New topic description'),
      visibility: z
        .enum(['PUBLIC', 'UNLISTED', 'PRIVATE'])
        .optional()
        .describe('Visibility setting'),
    },
    async ({ episode_id, ...params }) => {
      try {
        const updated = await client.updateEpisode(episode_id, params);
        return { content: [{ type: 'text', text: formatEpisodeDetail(updated) }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    'delete_episode',
    'Delete a episode you own. This is irreversible.',
    {
      episode_id: z.string().describe('The episode ID to delete'),
    },
    async ({ episode_id }) => {
      try {
        await client.deleteEpisode(episode_id);
        return { content: [{ type: 'text', text: formatDeleted() }] };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool('get_me', 'Get your Sotto profile and private episode count.', {}, async () => {
    try {
      const profile = await client.getMe();
      return { content: [{ type: 'text', text: formatProfile(profile) }] };
    } catch (err) {
      return errorResult(err);
    }
  });

  // --- Resources ---

  server.resource(
    'episode',
    new ResourceTemplate('sotto://episodes/{id}', {
      list: async () => {
        try {
          const episodes = await client.listEpisodes();
          return {
            resources: episodes.map((p) => ({
              uri: `sotto://episodes/${p.id}`,
              name: p.title,
              description: `${p.status} — ${p.topic}`,
              mimeType: 'application/json',
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    async (uri, { id }) => {
      const episode = await client.getEpisode(id as string);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(episode, null, 2),
          },
        ],
      };
    }
  );

  server.resource('profile', 'sotto://me', async (uri) => {
    const profile = await client.getMe();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(profile, null, 2),
        },
      ],
    };
  });

  return server;
}
