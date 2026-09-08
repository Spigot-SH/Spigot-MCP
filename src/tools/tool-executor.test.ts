import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { TextAnalysisService } from '../services/text-analysis.service.js';
import { HttpClient } from '../services/http-client.js';
import type { ToolDependencies } from '../types/tool.js';
import { ExternalServiceError } from '../utils/errors.js';
import { createAnalyzeTextDefinition } from './analyze-text.tool.js';
import { executeTool } from './tool-executor.js';

const dependencies: ToolDependencies = {
  textAnalysisService: new TextAnalysisService(),
  httpClient: new HttpClient({
    timeoutMs: 1_000,
    retries: 0,
    retryBaseDelayMs: 0,
    allowedHosts: []
  }),
  serverMetadata: { name: 'test-server', version: '1.0.0', environment: 'test' },
  maxInputChars: 20
};
const logger = pino({ enabled: false });

describe('tool execution', () => {
  it('returns structured output from a tool', async () => {
    const result = await executeTool(
      createAnalyzeTextDefinition(dependencies),
      { text: 'hello world' },
      logger,
      {
        requestId: 'request-123'
      }
    );

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textContent(result) ?? '{}')).toEqual({
      data: { characterCount: 11, wordCount: 2, lineCount: 1, requestId: 'request-123' }
    });
  });

  it('converts invalid input to a safe validation response', async () => {
    const result = await executeTool(
      createAnalyzeTextDefinition(dependencies),
      { text: '' },
      logger,
      {
        requestId: 'request-456'
      }
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(textContent(result) ?? '{}')).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The provided input is invalid.',
        requestId: 'request-456'
      }
    });
  });

  it('does not expose an unexpected error message to the client', async () => {
    const failingTool = createAnalyzeTextDefinition({
      ...dependencies,
      textAnalysisService: {
        analyze: () => {
          throw new Error('credential=sensitive-value');
        }
      }
    });

    const result = await executeTool(failingTool, { text: 'safe input' }, logger, {
      requestId: 'request-789'
    });
    expect(textContent(result)).not.toContain('sensitive-value');
    expect(JSON.parse(textContent(result) ?? '{}')).toMatchObject({
      error: { code: 'INTERNAL_SERVER_ERROR', requestId: 'request-789' }
    });
  });

  it('does not expose custom application error messages to the client', async () => {
    const failingTool = createAnalyzeTextDefinition({
      ...dependencies,
      textAnalysisService: {
        analyze: () => {
          throw new ExternalServiceError('upstream secret response');
        }
      }
    });

    const result = await executeTool(failingTool, { text: 'safe input' }, logger, {
      requestId: 'request-101'
    });
    expect(textContent(result)).not.toContain('secret');
    expect(JSON.parse(textContent(result) ?? '{}')).toMatchObject({
      error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'The external service is unavailable.' }
    });
  });
});

function textContent(result: { content: readonly unknown[] }): string | undefined {
  const first = result.content.find(
    (content): content is { type: 'text'; text: string } =>
      typeof content === 'object' &&
      content !== null &&
      'type' in content &&
      content.type === 'text' &&
      'text' in content &&
      typeof content.text === 'string'
  );
  return first?.text;
}
