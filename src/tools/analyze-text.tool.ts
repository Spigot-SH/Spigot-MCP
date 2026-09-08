import { createTextAnalysisInputSchema } from '../schemas/text-analysis.schema.js';
import { textAnalysisOutputSchema } from '../schemas/tool-output.schema.js';
import { executeTool } from './tool-executor.js';
import type { RegisteredTool } from './registered-tool.js';
import type { ToolDefinition, ToolDependencies } from '../types/tool.js';

export function createAnalyzeTextDefinition(
  dependencies: ToolDependencies
): ToolDefinition<
  ReturnType<typeof createTextAnalysisInputSchema>,
  typeof textAnalysisOutputSchema
> {
  const inputSchema = createTextAnalysisInputSchema(dependencies.maxInputChars);
  return {
    name: 'analyze_text',
    description: 'Counts characters, words, and lines in supplied text without retaining it.',
    inputSchema,
    outputSchema: textAnalysisOutputSchema,
    execute(input, context) {
      const analysis = dependencies.textAnalysisService.analyze(input);
      const output = { ...analysis, requestId: context.requestId };
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

export function createAnalyzeTextTool(dependencies: ToolDependencies): RegisteredTool {
  const definition = createAnalyzeTextDefinition(dependencies);
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
