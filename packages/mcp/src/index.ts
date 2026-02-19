#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SottoClient } from './client.js';
import { createServer } from './server.js';

const apiKey = process.env.SOTTO_API_KEY;
if (!apiKey) {
  process.stderr.write('Error: SOTTO_API_KEY environment variable is required\n');
  process.exit(1);
}

const baseUrl = process.env.SOTTO_API_URL || 'https://sotto.fm';
const client = new SottoClient(apiKey, baseUrl);
const server = createServer(client);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('Sotto MCP server started\n');
