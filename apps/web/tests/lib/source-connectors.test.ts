import { describe, expect, it } from 'vitest';
import {
  buildPrivateSourceReadiness,
  LOCAL_AGENT_SOURCES,
  SOURCE_CONNECTORS,
} from '@/lib/source-connectors';

describe('buildPrivateSourceReadiness', () => {
  it('keeps Slack, Gmail, Claude Code, and Codex as private connector definitions', () => {
    expect(SOURCE_CONNECTORS.map((connector) => connector.id)).toEqual(['slack', 'gmail']);
    expect(LOCAL_AGENT_SOURCES.map((connector) => connector.id)).toEqual(['claude-code', 'codex']);

    const readiness = buildPrivateSourceReadiness({
      commandAvailability: { gws: true, claude: true, codex: true },
      env: {
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_SIGNING_SECRET: 'secret',
      },
    });

    expect(readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'slack',
          kind: 'workspace',
          privateOnly: true,
          status: 'ready',
        }),
        expect.objectContaining({
          id: 'gmail',
          authMode: 'google-workspace-cli',
          privateOnly: true,
          status: 'ready',
        }),
        expect.objectContaining({
          id: 'claude-code',
          kind: 'local-agent',
          command: 'claude',
          privateOnly: true,
          status: 'ready',
        }),
        expect.objectContaining({
          id: 'codex',
          kind: 'local-agent',
          command: 'codex',
          privateOnly: true,
          status: 'ready',
        }),
      ])
    );
  });

  it('reports exact setup gaps without treating optional connector env vars as required', () => {
    const readiness = buildPrivateSourceReadiness({
      commandAvailability: { gws: false, claude: false, codex: true },
      env: { SLACK_APP_TOKEN: 'xapp-optional' },
    });

    expect(readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'slack',
          status: 'action_required',
          detail: 'Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET for Slack ingestion.',
        }),
        expect.objectContaining({
          id: 'gmail',
          status: 'action_required',
          detail: 'Install the gws CLI and authenticate Gmail access.',
        }),
        expect.objectContaining({
          id: 'claude-code',
          status: 'action_required',
          detail: 'Install and authenticate the claude CLI.',
        }),
        expect.objectContaining({
          id: 'codex',
          status: 'ready',
          detail: 'codex command available',
        }),
      ])
    );
  });

  it('recognizes Google Workspace CLI headless credentials for hosted Gmail ingestion', () => {
    const readiness = buildPrivateSourceReadiness({
      commandAvailability: { gws: true },
      env: {
        GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: '/run/secrets/gws.json',
      },
    });

    expect(readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gmail',
          status: 'ready',
          detail: 'gws command and headless credentials configured',
        }),
      ])
    );
  });
});
