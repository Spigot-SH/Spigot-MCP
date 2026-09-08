import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from 'pino';

/** A heterogeneous tool registry entry with its own typed MCP registration. */
export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  register(server: McpServer, logger: Logger): void;
}
