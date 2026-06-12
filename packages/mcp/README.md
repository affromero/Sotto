# @sotto/mcp

MCP server for Sotto. Create and manage private AI episodes from any MCP-compatible client (Claude Desktop, Claude Code, Cursor).

## Setup

### 1. Get an API key

Create an API key from your Sotto deployment at `/settings/api`. Keys start with `sk_sotto_`.

### 2. Configure your client

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sotto": {
      "command": "npx",
      "args": ["-y", "@sotto/mcp"],
      "env": {
        "SOTTO_API_KEY": "sk_sotto_your_key_here",
        "SOTTO_API_URL": "https://your-sotto.example.com"
      }
    }
  }
}
```

#### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "sotto": {
      "command": "npx",
      "args": ["-y", "@sotto/mcp"],
      "env": {
        "SOTTO_API_KEY": "sk_sotto_your_key_here",
        "SOTTO_API_URL": "https://your-sotto.example.com"
      }
    }
  }
}
```

#### Codex CLI

Register the Sotto MCP server with Codex:

```bash
codex mcp add sotto \
  --env SOTTO_API_KEY=sk_sotto_your_key_here \
  --env SOTTO_API_URL=https://your-sotto.example.com \
  -- npx -y @sotto/mcp
```

#### Local development

Point at your local dev server:

```json
{
  "mcpServers": {
    "sotto": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "SOTTO_API_KEY": "sk_sotto_your_key_here",
        "SOTTO_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Environment Variables

| Variable        | Required | Default | Description                      |
| --------------- | -------- | ------- | -------------------------------- |
| `SOTTO_API_KEY` | Yes      | —       | Your `sk_sotto_...` API key      |
| `SOTTO_API_URL` | Yes      | —       | API base URL for your deployment |

## Tools

| Tool                        | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `create_episode`            | Create an AI episode from a topic                       |
| `ingest_agent_output`       | Create a private episode from local agent output        |
| `get_episode`               | Get episode details + generation status                 |
| `list_episodes`             | List your episodes                                      |
| `update_episode`            | Update title, topic, or visibility                      |
| `delete_episode`            | Delete a episode                                        |
| `get_me`                    | Get your Sotto profile                                  |

### Local Agent Ingestion

Use `ingest_agent_output` when Claude Code, Codex, OpenClaw, Hermes, or another local agent has produced a report you want in your private episode feed. The tool requires an explicit `tts_provider` and never publishes the result publicly.

Minimal fields:

```json
{
  "title": "Daily engineering notes",
  "content": "Paste or pass the local agent output here.",
  "tts_provider": "openai",
  "agent_provider": "claude-code",
  "agent_name": "Claude Code",
  "idempotency_key": "claude-code:2026-05-18:daily-notes"
}
```

Optional fields include `topic`, `duration_minutes`, `focus_areas`, `source_url`, `agent_model`, `agent_run_id`, `ai_model`, and `tts_model`.

### Workspace Source Connectors

The web app exposes `/api/v1/source-connectors/readiness` so self-hosted installs can verify private source setup before wiring workers. Slack is modeled as a user-owned Slack app with `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`. Gmail is modeled through Google Workspace CLI (`gws`) so local and hosted installs can use the same owner-controlled command surface.

## Resources

| Resource | URI                     | Description                              |
| -------- | ----------------------- | ---------------------------------------- |
| Episode  | `sotto://episodes/{id}` | Episode detail (with list for discovery) |
| Profile  | `sotto://me`            | Your profile                             |

## Development

```bash
# Build
npm run build --workspace=@sotto/mcp

# Type check
npx tsc --noEmit --project packages/mcp/tsconfig.json

# Test startup
SOTTO_API_KEY=test SOTTO_API_URL=http://localhost:3000 node packages/mcp/dist/index.js

# Inspect with MCP Inspector
npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
```

## License

MIT
