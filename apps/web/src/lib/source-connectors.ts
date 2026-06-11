import { isCommandAvailable } from './local-command';

export type WorkspaceSourceConnectorId = 'slack' | 'gmail';
export type LocalAgentSourceId = 'claude-code' | 'codex';
export type PrivateSourceConnectorId = WorkspaceSourceConnectorId | LocalAgentSourceId;
export type PrivateSourceKind = 'workspace' | 'local-agent';
export type PrivateSourceStatus = 'ready' | 'action_required';
export type ConnectorAuthMode = 'slack-app' | 'google-workspace-cli' | 'local-cli';

interface ConnectorEnvVar {
  name: string;
  required: boolean;
  purpose: string;
}

export interface PrivateSourceConnectorDefinition {
  id: PrivateSourceConnectorId;
  kind: PrivateSourceKind;
  label: string;
  description: string;
  authMode: ConnectorAuthMode;
  privateOnly: true;
  command?: string;
  envVars: ConnectorEnvVar[];
  setupActions: string[];
}

export interface PrivateSourceConnectorReadiness extends PrivateSourceConnectorDefinition {
  status: PrivateSourceStatus;
  detail: string;
}

interface BuildPrivateSourceReadinessInput {
  env?: Record<string, string | undefined>;
  commandAvailability?: Partial<Record<string, boolean>>;
}

export const SOURCE_CONNECTORS: PrivateSourceConnectorDefinition[] = [
  {
    id: 'slack',
    kind: 'workspace',
    label: 'Slack',
    description: 'Private channel, thread, and DM digests from a user-owned Slack app.',
    authMode: 'slack-app',
    privateOnly: true,
    envVars: [
      {
        name: 'SLACK_BOT_TOKEN',
        required: true,
        purpose: 'Bot token used by hosted or self-hosted Slack ingestion workers.',
      },
      {
        name: 'SLACK_SIGNING_SECRET',
        required: true,
        purpose: 'Request signature secret for Slack events and slash commands.',
      },
      {
        name: 'SLACK_APP_TOKEN',
        required: false,
        purpose: 'Socket Mode token for installs that cannot expose a public webhook.',
      },
    ],
    setupActions: [
      'Create a Slack app in the target workspace.',
      'Grant bot scopes for the private channels or DMs the owner explicitly selects.',
      'Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to the Sotto deployment.',
    ],
  },
  {
    id: 'gmail',
    kind: 'workspace',
    label: 'Gmail',
    description: 'Private email digests through Google Workspace CLI, using the owner account.',
    authMode: 'google-workspace-cli',
    privateOnly: true,
    command: 'gws',
    envVars: [
      {
        name: 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE',
        required: false,
        purpose: 'Headless credentials exported with gws auth export for hosted workers.',
      },
      {
        name: 'GOOGLE_WORKSPACE_CLI_TOKEN',
        required: false,
        purpose: 'Pre-obtained access token for short-lived server or CI runs.',
      },
    ],
    setupActions: [
      'Install the gws binary from googleworkspace/cli.',
      'Run gws auth login locally, or export credentials for a hosted worker.',
      'Use the gws Gmail command surface to collect owner-selected messages.',
    ],
  },
];

export const LOCAL_AGENT_SOURCES: PrivateSourceConnectorDefinition[] = [
  {
    id: 'claude-code',
    kind: 'local-agent',
    label: 'Claude Code',
    description:
      'Local Claude Code runs can submit private episode inputs through API keys or MCP.',
    authMode: 'local-cli',
    privateOnly: true,
    command: 'claude',
    envVars: [
      {
        name: 'CLAUDE_CODE_CREDENTIALS_JSON',
        required: false,
        purpose: 'Container-friendly Claude Code credentials for self-hosted workers.',
      },
      {
        name: 'CLAUDE_HOME',
        required: false,
        purpose: 'Writable Claude home directory when credentials are volume-mounted.',
      },
    ],
    setupActions: [
      'Install and authenticate the claude CLI.',
      'Create a Sotto API key.',
      'Use the MCP ingest_agent_output tool or POST to /api/v1/ingest/agent.',
    ],
  },
  {
    id: 'codex',
    kind: 'local-agent',
    label: 'Codex',
    description: 'Codex CLI runs can submit private episode inputs through API keys or MCP.',
    authMode: 'local-cli',
    privateOnly: true,
    command: 'codex',
    envVars: [
      {
        name: 'CODEX_HOME',
        required: false,
        purpose: 'Codex home directory containing CLI auth and config.',
      },
    ],
    setupActions: [
      'Install and authenticate the codex CLI.',
      'Create a Sotto API key.',
      'Use the MCP ingest_agent_output tool or POST to /api/v1/ingest/agent.',
    ],
  },
];

export const PRIVATE_SOURCE_CONNECTORS = [...SOURCE_CONNECTORS, ...LOCAL_AGENT_SOURCES] as const;

function hasEnv(env: Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => Boolean(env[name]?.trim()));
}

function getCommandAvailability(
  command: string | undefined,
  commandAvailability: Partial<Record<string, boolean>>
): boolean {
  return command ? commandAvailability[command] === true : false;
}

function buildSlackReadiness(
  env: Record<string, string | undefined>,
  definition: PrivateSourceConnectorDefinition
): PrivateSourceConnectorReadiness {
  const ready = hasEnv(env, ['SLACK_BOT_TOKEN']) && hasEnv(env, ['SLACK_SIGNING_SECRET']);
  return {
    ...definition,
    status: ready ? 'ready' : 'action_required',
    detail: ready
      ? 'Slack app credentials configured'
      : 'Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET for Slack ingestion.',
  };
}

function buildGmailReadiness(
  env: Record<string, string | undefined>,
  commandAvailability: Partial<Record<string, boolean>>,
  definition: PrivateSourceConnectorDefinition
): PrivateSourceConnectorReadiness {
  const commandReady = getCommandAvailability(definition.command, commandAvailability);
  const headlessCredentialsReady = hasEnv(env, [
    'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE',
    'GOOGLE_WORKSPACE_CLI_TOKEN',
  ]);

  if (!commandReady) {
    return {
      ...definition,
      status: 'action_required',
      detail: 'Install the gws CLI and authenticate Gmail access.',
    };
  }

  return {
    ...definition,
    status: 'ready',
    detail: headlessCredentialsReady
      ? 'gws command and headless credentials configured'
      : 'gws command available; use local auth or export credentials for hosted workers.',
  };
}

function buildLocalAgentReadiness(
  commandAvailability: Partial<Record<string, boolean>>,
  definition: PrivateSourceConnectorDefinition
): PrivateSourceConnectorReadiness {
  const commandReady = getCommandAvailability(definition.command, commandAvailability);
  return {
    ...definition,
    status: commandReady ? 'ready' : 'action_required',
    detail: commandReady
      ? `${definition.command} command available`
      : `Install and authenticate the ${definition.command} CLI.`,
  };
}

export function buildPrivateSourceReadiness(
  input: BuildPrivateSourceReadinessInput = {}
): PrivateSourceConnectorReadiness[] {
  const env = input.env ?? process.env;
  const commandAvailability = input.commandAvailability ?? {};

  return PRIVATE_SOURCE_CONNECTORS.map((definition) => {
    if (definition.id === 'slack') return buildSlackReadiness(env, definition);
    if (definition.id === 'gmail') {
      return buildGmailReadiness(env, commandAvailability, definition);
    }
    return buildLocalAgentReadiness(commandAvailability, definition);
  });
}

export async function getPrivateSourceReadiness(
  env: Record<string, string | undefined> = process.env
): Promise<PrivateSourceConnectorReadiness[]> {
  const commands = Array.from(
    new Set(
      PRIVATE_SOURCE_CONNECTORS.map((connector) => connector.command).filter(
        (command): command is string => Boolean(command)
      )
    )
  );
  const availabilityEntries = await Promise.all(
    commands.map(async (command) => [command, await isCommandAvailable(command)] as const)
  );

  return buildPrivateSourceReadiness({
    env,
    commandAvailability: Object.fromEntries(availabilityEntries),
  });
}
