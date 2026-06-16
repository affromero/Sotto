import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Developers. Sotto API',
  description:
    'Sotto API documentation for deployments you run. Connect your own agent and keys, then drive courses and classes over HTTP.',
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
    title: 'Courses',
    description: 'Enroll in a language pair and drive a learner through courses gated by mastery.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/courses',
        description: 'List the courses the signed-in learner is enrolled in.',
        auth: true,
        response: '{ courses: [{ id, nativeLang, targetLang, level }] }',
      },
      {
        method: 'POST',
        path: '/api/v1/courses',
        description: 'Create a course enrollment for a native to target language pair.',
        auth: true,
        params: [
          {
            name: 'nativeLang',
            type: 'string',
            required: true,
            description: 'Native language ISO code',
          },
          {
            name: 'targetLang',
            type: 'string',
            required: true,
            description: 'Target language ISO code',
          },
        ],
        response: '{ id: string, level: string }',
      },
      {
        method: 'POST',
        path: '/api/v1/courses/:courseId/next-class',
        description:
          'Generate the next gated class for a course. Optionally sourced from a real link or an interest topic.',
        auth: true,
        params: [
          {
            name: 'sourceUrl',
            type: 'string',
            required: false,
            description: 'A readable link or paper to build the class from',
          },
          {
            name: 'topic',
            type: 'string',
            required: false,
            description: 'An interest topic to build the class from',
          },
        ],
        response: '{ classId: string }',
      },
      {
        method: 'GET',
        path: '/api/v1/courses/:courseId/graph',
        description:
          'Read the learner-owned vocabulary memory graph for a course: nodes and connections with spaced-repetition due markers.',
        auth: true,
        response: '{ nodes, edges }',
      },
    ],
  },
  {
    title: 'Placement',
    description: 'Place a learner at the right CEFR level before the first course.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/placement',
        description: 'Generate adaptive placement questions for a language pair.',
        auth: true,
        response: '{ questions: [{ id, prompt, choices }] }',
      },
      {
        method: 'POST',
        path: '/api/v1/placement',
        description: 'Submit placement answers. Creates a course and sets the starting CEFR level.',
        auth: true,
        params: [
          {
            name: 'answers',
            type: 'array',
            required: true,
            description: 'Answers to the placement questions',
          },
        ],
        response: '{ courseId: string, level: string }',
      },
    ],
  },
  {
    title: 'Classes',
    description: 'Read a generated class and submit a completed one across the five skills.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/classes/:classId',
        description:
          'Fetch a class with its sections, questions, and prompts for grammar, reading, listening, speaking, and writing.',
        auth: true,
        response: '{ id, status, sections, references }',
      },
      {
        method: 'POST',
        path: '/api/v1/classes/:classId/submit',
        description:
          'Submit a completed class. Scores the answers and advances the course level on a pass.',
        auth: true,
        params: [
          {
            name: 'answers',
            type: 'array',
            required: true,
            description: 'Section answers for the class',
          },
        ],
        response: '{ overallScore: number, passed: boolean }',
      },
    ],
  },
  {
    title: 'Agent Ingestion',
    description:
      'Send your own agent output into a private course. Nothing ingested is ever made public.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/ingest/agent',
        description:
          'Ingest output from a local agent run, such as Claude Code or Codex. The result stays private to your account.',
        auth: true,
        params: [
          {
            name: 'content',
            type: 'string',
            required: true,
            description: 'The agent output to ingest',
          },
          {
            name: 'idempotency_key',
            type: 'string',
            required: false,
            description: 'Deduplicate repeated submissions',
          },
        ],
        response: '{ id: string, visibility: "PRIVATE" }',
      },
    ],
  },
  {
    title: 'Keys and Health',
    description: 'Manage the API keys your clients use, and check that the instance is live.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/v1/keys',
        description: 'List the API keys on the signed-in account. Key hashes are never returned.',
        auth: true,
        response: '{ keys: [{ id, name, createdAt, lastUsedAt }] }',
      },
      {
        method: 'POST',
        path: '/api/v1/keys',
        description: 'Create a new API key. The raw key is returned once.',
        auth: true,
        params: [
          { name: 'name', type: 'string', required: false, description: 'Key display name' },
        ],
        response: '{ id: string, key: string }',
      },
      {
        method: 'GET',
        path: '/api/v1/health',
        description: 'Liveness check for your deployment. No authentication required.',
        auth: false,
        response: '{ status: "ok" }',
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
              Build on your own Sotto deployment. Connect your agent and keys, then drive placement,
              courses, and classes over HTTP. Endpoints require authentication unless noted
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
              <a href="/settings/devices" className={styles.link}>
                device settings
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
              Because you host the instance, rate limits are yours to set. The defaults guard
              authentication and generation endpoints, and you can tune them in your deployment
              configuration. Generation throughput is ultimately bounded by your own provider
              quotas.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
