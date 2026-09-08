import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';
import type { z } from 'zod';

import { ValidationError, toSafeToolError } from '../utils/errors.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../types/tool.js';

export function executeTool<TSchema extends z.AnyZodObject, TOutputSchema extends z.AnyZodObject>(
  tool: ToolDefinition<TSchema, TOutputSchema>,
  input: unknown,
  logger: Logger,
  context: Partial<ToolExecutionContext> = {}
): Promise<ToolResult<z.infer<TOutputSchema>>> {
  return execute(tool, input, logger, { requestId: context.requestId ?? randomUUID() });
}

async function execute<TSchema extends z.AnyZodObject, TOutputSchema extends z.AnyZodObject>(
  tool: ToolDefinition<TSchema, TOutputSchema>,
  input: unknown,
  logger: Logger,
  context: ToolExecutionContext
): Promise<ToolResult<z.infer<TOutputSchema>>> {
  const startedAt = performance.now();
  logger.info({ requestId: context.requestId, tool: tool.name, event: 'tool_execution_started' });

  try {
    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ValidationError();
    }

    const result = await tool.execute(parsedInput.data, context);
    logger.info({
      requestId: context.requestId,
      tool: tool.name,
      event: 'tool_execution_completed',
      success: true,
      durationMs: elapsedMs(startedAt)
    });
    return result;
  } catch (error) {
    const safeError = toSafeToolError<z.infer<TOutputSchema>>(error, context.requestId);
    logger.warn({
      requestId: context.requestId,
      tool: tool.name,
      event: 'tool_execution_completed',
      success: false,
      durationMs: elapsedMs(startedAt),
      errorCode: getErrorCode(error)
    });
    return safeError;
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function getErrorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'INTERNAL_SERVER_ERROR';
}
