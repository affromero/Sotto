import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Developers — Sotto API',
  description: 'Sotto public API documentation — endpoints, authentication, and usage examples.',
};

interface Param {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  description: string;
  auth: boolean;
  params?: Param[];
  response?: string;
}

interface Section {
  title: string;
  description: string;
  endpoints: Endpoint[];
}

const sections: Section[] = [
  {
    title: 'Private RSS',
    description: 'Create and manage private podcast feeds for any podcast app.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/rss/private',
        description: 'Create a new private feed token. The raw feed URL is returned once.',
        auth: true,
        params: [
          { name: 'name', type: 'string', required: false, description: 'Feed display name' },
        ],
        response: '{ id: string, token: string, feedUrl: string }',
      },
      {
        method: 'GET',
        path: '/api/rss/private',
        description: 'List active private feed token metadata. Token hashes are never returned.',
        auth: true,
        response: '{ id, name, feedType, createdAt, lastUsedAt }[]',
      },
      {
        method: 'GET',
        path: '/api/rss/private/:token',
        description:
          'RSS 2.0 feed for the token owner, including private and unlisted ready episodes.',
        auth: false,
        response: 'application/rss+xml',
      },
      {
        method: 'DELETE',
        path: '/api/rss/private/tokens/:id',
        description: 'Revoke an active private feed token.',
        auth: true,
      },
    ],
  },
  {
    title: 'Podcasts',
    description: 'Read podcast details and manage your own podcasts.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/podcasts/:id',
        description: 'Get podcast details including segments, references, and metadata.',
        auth: false,
        response: '{ id, title, topic, status, audioUrl, duration, segments, references, ... }',
      },
      {
        method: 'POST',
        path: '/api/podcasts',
        description: 'Create a new podcast. Triggers the generation pipeline.',
        auth: true,
        params: [
          { name: 'title', type: 'string', required: true, description: 'Podcast title' },
          {
            name: 'topic',
            type: 'string',
            required: true,
            description: 'Topic description (up to 5000 chars)',
          },
          {
            name: 'metadata',
            type: 'object',
            required: false,
            description: 'Discovery metadata: depth, audience, tone, focusAreas, durationTarget',
          },
        ],
        response: '{ id: string, status: "PENDING" }',
      },
      {
        method: 'DELETE',
        path: '/api/podcasts/:id',
        description: 'Delete a podcast you own.',
        auth: true,
      },
    ],
  },
  {
    title: 'Users',
    description: 'Private account and library data.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/users/:id',
        description: 'Get public user profile.',
        auth: false,
        response: '{ id, name, handle, image, bio, podcastCount }',
      },
      {
        method: 'GET',
        path: '/api/users/:id/podcasts',
        description: 'List public podcasts by a user.',
        auth: false,
        params: [
          {
            name: 'page',
            type: 'number',
            required: false,
            description: 'Page number (default: 1)',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Results per page (default: 20)',
          },
        ],
      },
    ],
  },
  {
    title: 'Embed & oEmbed',
    description: 'Embed Sotto players on external sites.',
    endpoints: [
      {
        method: 'GET',
        path: '/podcast/:id/embed',
        description: 'Embeddable player iframe. Use directly in an iframe or via oEmbed.',
        auth: false,
      },
      {
        method: 'GET',
        path: '/api/oembed',
        description:
          'oEmbed endpoint for rich previews. Paste a podcast URL into Notion, Slack, or Discord for automatic embeds.',
        auth: false,
        params: [
          {
            name: 'url',
            type: 'string',
            required: true,
            description: 'Podcast URL (e.g., https://your-sotto.example/podcast/abc123)',
          },
        ],
        response:
          '{ version, type, provider_name, title, author_name, html, width, height, thumbnail_url }',
      },
    ],
  },
];

export default function DevelopersPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>API Documentation</h1>
            <p className={styles.subtitle}>
              Build on Sotto. All public endpoints are available without authentication unless noted
              otherwise.
            </p>
          </header>

          {/* Auth section */}
          <section className={styles.authSection}>
            <h2 className={styles.sectionTitle}>Authentication</h2>
            <p className={styles.sectionDescription}>
              Authenticated endpoints require an API key passed via the{' '}
              <code className={styles.inlineCode}>Authorization</code> header:
            </p>
            <pre className={styles.codeBlock}>
              <code>Authorization: Bearer YOUR_API_KEY</code>
            </pre>
            <p className={styles.sectionDescription}>
              Generate API keys from your{' '}
              <a href="/settings" className={styles.link}>
                Settings
              </a>{' '}
              page.
            </p>
          </section>

          {/* Base URL */}
          <section className={styles.authSection}>
            <h2 className={styles.sectionTitle}>Base URL</h2>
            <pre className={styles.codeBlock}>
              <code>https://your-sotto.example</code>
            </pre>
          </section>

          {/* Endpoint sections */}
          {sections.map((section) => (
            <section key={section.title} className={styles.section}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              <p className={styles.sectionDescription}>{section.description}</p>

              {section.endpoints.map((endpoint) => (
                <div key={endpoint.method + endpoint.path} className={styles.endpoint}>
                  <div className={styles.endpointHeader}>
                    <span
                      className={`${styles.method} ${styles[`method_${endpoint.method.toLowerCase()}`]}`}
                    >
                      {endpoint.method}
                    </span>
                    <code className={styles.path}>{endpoint.path}</code>
                    {endpoint.auth && <span className={styles.authBadge}>Auth required</span>}
                  </div>
                  <p className={styles.endpointDescription}>{endpoint.description}</p>

                  {endpoint.params && endpoint.params.length > 0 && (
                    <div className={styles.paramsTable}>
                      <table>
                        <thead>
                          <tr>
                            <th>Parameter</th>
                            <th>Type</th>
                            <th>Required</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {endpoint.params.map((param) => (
                            <tr key={param.name}>
                              <td>
                                <code className={styles.paramName}>{param.name}</code>
                              </td>
                              <td>
                                <code className={styles.paramType}>{param.type}</code>
                              </td>
                              <td>{param.required ? 'Yes' : 'No'}</td>
                              <td>{param.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {endpoint.response && (
                    <div className={styles.responseBlock}>
                      <span className={styles.responseLabel}>Response</span>
                      <code className={styles.responseCode}>{endpoint.response}</code>
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}

          {/* Rate limits */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Rate Limits</h2>
            <p className={styles.sectionDescription}>
              Unauthenticated requests: <strong>60 requests/minute</strong>. Authenticated requests:{' '}
              <strong>200 requests/minute</strong>. Podcast generation: <strong>20/hour</strong>,{' '}
              <strong>100/day</strong> per user.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
