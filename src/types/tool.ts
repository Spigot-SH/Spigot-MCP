import type { z } from 'zod';
import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import type { HttpClient } from '../services/http-client.js';

export interface ToolExecutionContext {
  requestId: string;
}

export interface ToolDependencies {
  textAnalysisService: TextAnalysisServicePort;
  httpClient: HttpClient;
  serverMetadata: ServerMetadata;
  maxInputChars: number;
}

export interface TextAnalysisServicePort {
  analyze(input: TextAnalysisInput): TextAnalysisResult;
}

export interface TextAnalysisInput {
  text: string;
  includePreview: boolean;
}

export interface TextAnalysisResult {
  characterCount: number;
  wordCount: number;
  lineCount: number;
  preview?: string;
}

export interface ServerMetadata {
  name: string;
  version: string;
  environment: string;
}

export type ToolResult<TOutput extends Record<string, unknown> = Record<string, unknown>> = Omit<
  CallToolResult,
  'structuredContent'
> & {
  content: ContentBlock[];
  structuredContent?: TOutput;
};

export interface ToolDefinition<
  TSchema extends z.AnyZodObject,
  TOutputSchema extends z.AnyZodObject
> {
  name: string;
  description: string;
  inputSchema: TSchema;
  outputSchema: TOutputSchema;
  execute: (
    input: z.infer<TSchema>,
    context: ToolExecutionContext
  ) => ToolResult<z.infer<TOutputSchema>> | Promise<ToolResult<z.infer<TOutputSchema>>>;
}
