# @sotto/mcp

MCP server for Sotto. Create and manage private AI podcasts from any MCP-compatible client (Claude Desktop, Claude Code, Cursor).

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

| Tool             | Description                             |
| ---------------- | --------------------------------------- |
| `create_podcast` | Create an AI podcast from a topic       |
| `get_podcast`    | Get podcast details + generation status |
| `list_podcasts`  | List your podcasts                      |
| `update_podcast` | Update title, topic, or visibility      |
| `delete_podcast` | Delete a podcast                        |
| `get_me`         | Get your Sotto profile                  |

## Resources

| Resource | URI                     | Description                              |
| -------- | ----------------------- | ---------------------------------------- |
| Podcast  | `sotto://podcasts/{id}` | Podcast detail (with list for discovery) |
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
