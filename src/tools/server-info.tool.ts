import { serverInfoInputSchema } from '../schemas/server-info.schema.js';
import { serverInfoOutputSchema } from '../schemas/tool-output.schema.js';
import { executeTool } from './tool-executor.js';
import type { RegisteredTool } from './registered-tool.js';
import type { ToolDefinition, ToolDependencies } from '../types/tool.js';

export function createServerInfoDefinition(
  dependencies: ToolDependencies
): ToolDefinition<typeof serverInfoInputSchema, typeof serverInfoOutputSchema> {
  return {
    name: 'server_info',
    description: 'Returns non-sensitive metadata about this MCP server and its readiness.',
    inputSchema: serverInfoInputSchema,
    outputSchema: serverInfoOutputSchema,
    execute(_input, context) {
      const output = {
        ...dependencies.serverMetadata,
        status: 'ready' as const,
        requestId: context.requestId
      };
      return {
        structuredContent: output,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: output
            })
          }
        ]
      };
    }
  };
}

export function createServerInfoTool(dependencies: ToolDependencies): RegisteredTool {
  const definition = createServerInfoDefinition(dependencies);
  return {
    name: definition.name,
    description: definition.description,
    register(server, logger) {
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
          outputSchema: definition.outputSchema
        },
        async (input, extra) =>
          executeTool(definition, input, logger, { requestId: String(extra.requestId) })
      );
    }
  };
}
