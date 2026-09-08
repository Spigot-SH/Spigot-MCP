import { createAnalyzeTextTool } from './analyze-text.tool.js';
import { createServerInfoTool } from './server-info.tool.js';
import type { RegisteredTool } from './registered-tool.js';
import type { ToolDependencies } from '../types/tool.js';

// <api-tool-imports>

/**
 * The sole registry for application tools. Adding a tool requires one entry here;
 * no changes are needed in the MCP server or runtime composition layers.
 */
export function createTools(dependencies: ToolDependencies): readonly RegisteredTool[] {
  return [
    createServerInfoTool(dependencies),
    createAnalyzeTextTool(dependencies)
    // <api-tool-factories>
  ];
}
