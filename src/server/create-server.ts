import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';

import { createTools } from '../tools/index.js';
import type { ToolDependencies } from '../types/tool.js';

export function createMcpServer(dependencies: ToolDependencies, logger: Logger): McpServer {
  const server = new McpServer({
    name: dependencies.serverMetadata.name,
    version: dependencies.serverMetadata.version
  });

  for (const tool of createTools(dependencies)) {
    tool.register(server, logger);
  }

  return server;
}
