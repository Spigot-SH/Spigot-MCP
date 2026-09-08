import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { TextAnalysisService } from '../services/text-analysis.service.js';
import { HttpClient } from '../services/http-client.js';
import { createMcpServer } from './create-server.js';

describe('MCP server integration', () => {
  it('discovers typed tools and returns structured content correlated to the MCP request ID', async () => {
    const server = createMcpServer(
      {
        textAnalysisService: new TextAnalysisService(),
        httpClient: new HttpClient({
          timeoutMs: 1_000,
          retries: 0,
          retryBaseDelayMs: 0,
          allowedHosts: []
        }),
        serverMetadata: { name: 'integration-server', version: '1.0.0', environment: 'test' },
        maxInputChars: 100
      },
      pino({ enabled: false })
    );
    const client = new Client({ name: 'integration-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const discovered = await client.listTools();
      expect(discovered.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['server_info', 'analyze_text'])
      );
      expect(
        discovered.tools.find((tool) => tool.name === 'analyze_text')?.outputSchema
      ).toBeDefined();

      const result = await client.callTool({
        name: 'analyze_text',
        arguments: { text: 'one two\nthree' }
      });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        characterCount: 13,
        wordCount: 3,
        lineCount: 2,
        requestId: '2'
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
