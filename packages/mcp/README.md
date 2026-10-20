# @sotto/mcp

MCP server for Sotto. Create and manage private AI episodes from any MCP-compatible client (Claude Desktop, Claude Code, Codex, Cursor, OpenClaw, Hermes).

## Setup

### 1. Get an API key

Create an API key from your Sotto deployment at `/settings/devices` (owner only). Keys start with `sk_sotto_`.

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

#### OpenClaw

Register the Sotto MCP server with OpenClaw:

```bash
openclaw mcp add sotto \
  --command npx \
  --arg -y \
  --arg @sotto/mcp \
  --env SOTTO_API_KEY=sk_sotto_your_key_here \
  --env SOTTO_API_URL=https://your-sotto.example.com
```

Or add it to `~/.openclaw/openclaw.json` under `mcp.servers`:

```json
{
  "mcp": {
    "servers": {
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
}
```

#### Hermes

Add the server to `~/.hermes/config.yaml` under `mcp_servers`, then run `/reload-mcp` in the agent:

```yaml
mcp_servers:
  sotto:
    command: 'npx'
    args: ['-y', '@sotto/mcp']
    env:
      SOTTO_API_KEY: 'sk_sotto_your_key_here'
      SOTTO_API_URL: 'https://your-sotto.example.com'
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

| Tool                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `create_episode`           | Create an AI episode from a topic                                   |
| `ingest_agent_output`      | Create a private episode from local agent output                    |
| `get_episode`              | Get episode details + generation status                             |
| `list_episodes`            | List your episodes                                                  |
| `update_episode`           | Update title, topic, or visibility                                  |
| `delete_episode`           | Delete a episode                                                    |
| `get_me`                   | Get your Sotto profile                                              |
| `list_courses`             | List the active learner's courses and current levels                |
| `get_learning_map`         | Read Situations, Grammar and exact requirements for a selected band |
| `get_learning_objective`   | Read an objective's criteria and qualified progress                 |
| `get_learning_evidence`    | Page the exact objective's assessment history                       |
| `list_source_analyses`     | List retained analyses of uploaded course materials                 |
| `list_source_focuses`      | Page an analysis's saved teaching focuses                           |
| `get_source_focus`         | Read a private focus with verified citations and coverage           |
| `preview_focused_practice` | Resolve groups or objectives and available practice formats         |
| `start_focused_practice`   | Generate another class for the explicit selected focuses            |
| `get_practice_session`     | Read retained preparation, material or results                      |
| `advance_learning_level`   | Explicitly request one-band advancement through the server gate     |

### Learning maps and practice

Read the course map before choosing practice. `level` selects a band to inspect;
lower-level review preserves the current band and active class. Grammar and
Situations are independent branches. A saved source focus can be practised alone
or combined with exact canonical objectives. Source exposure establishes no
mastery. Only eligible assessments contribute objective evidence.

Call `preview_focused_practice` with `course_id` and `selection`:

```json
{
  "catalogVersion": 1,
  "level": "A2",
  "nodeIds": ["de.g.als-wenn-past"]
}
```

Use the preview's concrete objective IDs and an available `kind` when starting
practice. Preserve `request_id` and the exact selection after a lost response.
A new class requires a new request ID. Read `get_practice_session` to resume its
saved preparation or material. The configured providers may incur costs.

Ask for advancement only when the learner requests it. Supply a stable
`request_id`, the observed `expected_level` and `catalog_hash`. The server
rechecks pinned requirements and pending work before advancing exactly one
band. Completing C2 keeps C2. Tools return the server's readiness, refusals and
receipts directly.

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
