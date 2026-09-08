import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config/env.js';
import { createToolDependencies } from './dependencies.js';
import { startHttpServer, type HttpServerHandle } from './http.js';

const config: AppConfig = {
  environment: 'test',
  logLevel: 'silent' as AppConfig['logLevel'],
  serverName: 'http-integration-server',
  serverVersion: '1.0.0',
  transport: 'http',
  http: { host: '127.0.0.1', port: 0, allowedHosts: [], corsOrigins: [] },
  maxInputChars: 100,
  maxRequestBytes: 1_048_576,
  externalApi: { timeoutMs: 1_000, retries: 0, retryBaseDelayMs: 0, allowedHosts: [] }
};

let handle: HttpServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('Streamable HTTP MCP server', () => {
  it('serves health checks and MCP tool discovery over a stateless HTTP endpoint', async () => {
    handle = await startHttpServer(
      config,
      createToolDependencies(config),
      pino({ enabled: false })
    );

    await expect(fetch(new URL('/health', handle.url))).resolves.toMatchObject({ status: 200 });

    const client = new Client({ name: 'http-integration-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    await client.connect(transport as unknown as Transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['server_info', 'analyze_text'])
      );
    } finally {
      await client.close();
    }
  });
});
