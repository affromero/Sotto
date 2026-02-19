import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SottoClient, ApiError } from './client.js';
import {
  formatPodcastDetail,
  formatPodcastList,
  formatFeed,
  formatProfile,
  formatCreated,
  formatForked,
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
    'create_podcast',
    'Create an AI podcast from a topic. Returns the podcast ID and kicks off the generation pipeline.',
    {
      title: z.string().describe('Podcast title'),
      topic: z.string().describe('What the podcast should be about'),
      depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional()
        .describe('Content depth level'),
      audience_level: z.enum(['beginner', 'intermediate', 'expert']).optional()
        .describe('Target audience expertise'),
      tone: z.enum(['casual', 'professional', 'socratic']).optional()
        .describe('Conversation tone'),
      duration_minutes: z.number().min(5).max(40).optional()
        .describe('Target duration in minutes (5-40)'),
      focus_areas: z.string().optional()
        .describe('Comma-separated focus areas, e.g. "neural networks, backpropagation"'),
      source_url: z.string().optional()
        .describe('URL to use as source material (article, paper, etc.)'),
    },
    async (params) => {
      try {
        const result = await client.createPodcast(params);
        return { content: [{ type: 'text', text: formatCreated(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'get_podcast',
    'Get podcast details including status, segments, and Q&A interactions.',
    {
      podcast_id: z.string().describe('The podcast ID'),
    },
    async ({ podcast_id }) => {
      try {
        const podcast = await client.getPodcast(podcast_id);
        return { content: [{ type: 'text', text: formatPodcastDetail(podcast) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'list_podcasts',
    'List all your podcasts, ordered by most recent first.',
    {},
    async () => {
      try {
        const podcasts = await client.listPodcasts();
        return { content: [{ type: 'text', text: formatPodcastList(podcasts) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'browse_feed',
    'Search and filter the public podcast feed. Discover podcasts by topic, tag, depth, audience, or tone.',
    {
      search: z.string().optional().describe('Search by title or topic'),
      sort: z.enum(['recent', 'popular', 'trending', 'most_forked']).optional()
        .describe('Sort order'),
      tag: z.string().optional().describe('Filter by tag slug'),
      depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional()
        .describe('Filter by depth'),
      audience: z.enum(['beginner', 'intermediate', 'expert']).optional()
        .describe('Filter by audience level'),
      tone: z.enum(['casual', 'professional', 'socratic']).optional()
        .describe('Filter by tone'),
      page: z.number().int().min(1).optional().describe('Page number'),
      limit: z.number().int().min(1).max(50).optional().describe('Results per page (max 50)'),
    },
    async (params) => {
      try {
        const feed = await client.browseFeed(params);
        return { content: [{ type: 'text', text: formatFeed(feed) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'fork_podcast',
    'Fork (remix) a public podcast with your own angle. Creates a new podcast based on the original.',
    {
      podcast_id: z.string().describe('ID of the podcast to fork'),
      topic: z.string().optional().describe('New topic angle for the fork'),
      remix_note: z.string().optional().describe('Note about what you changed'),
      focus_areas: z.string().optional()
        .describe('Comma-separated focus areas for the fork'),
      depth: z.enum(['eli5', 'quick_overview', 'standard', 'deep_dive']).optional()
        .describe('Content depth for the fork'),
      tone: z.enum(['casual', 'professional', 'socratic']).optional()
        .describe('Tone for the fork'),
    },
    async ({ podcast_id, ...params }) => {
      try {
        const result = await client.forkPodcast(podcast_id, params);
        return { content: [{ type: 'text', text: formatForked(result) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'update_podcast',
    'Update a podcast\'s title, topic, or visibility.',
    {
      podcast_id: z.string().describe('The podcast ID'),
      title: z.string().optional().describe('New title'),
      topic: z.string().optional().describe('New topic description'),
      visibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional()
        .describe('Visibility setting'),
    },
    async ({ podcast_id, ...params }) => {
      try {
        const updated = await client.updatePodcast(podcast_id, params);
        return { content: [{ type: 'text', text: formatPodcastDetail(updated) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'delete_podcast',
    'Delete a podcast you own. This is irreversible.',
    {
      podcast_id: z.string().describe('The podcast ID to delete'),
    },
    async ({ podcast_id }) => {
      try {
        await client.deletePodcast(podcast_id);
        return { content: [{ type: 'text', text: formatDeleted() }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'get_me',
    'Get your Sotto profile including podcast count, followers, and following.',
    {},
    async () => {
      try {
        const profile = await client.getMe();
        return { content: [{ type: 'text', text: formatProfile(profile) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // --- Resources ---

  server.resource(
    'podcast',
    new ResourceTemplate('sotto://podcasts/{id}', {
      list: async () => {
        try {
          const podcasts = await client.listPodcasts();
          return {
            resources: podcasts.map((p) => ({
              uri: `sotto://podcasts/${p.id}`,
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
      const podcast = await client.getPodcast(id as string);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(podcast, null, 2),
        }],
      };
    },
  );

  server.resource(
    'profile',
    'sotto://me',
    async (uri) => {
      const profile = await client.getMe();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(profile, null, 2),
        }],
      };
    },
  );

  return server;
}
