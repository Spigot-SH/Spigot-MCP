import { createServer, type Server } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import cors from 'cors';
import express from 'express';
import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import type { ToolDependencies } from '../types/tool.js';
import { createMcpServer } from './create-server.js';

export interface HttpServerHandle {
  url: string;
  close(): Promise<void>;
}

export async function startHttpServer(
  config: AppConfig,
  dependencies: ToolDependencies,
  logger: Logger
): Promise<HttpServerHandle> {
  const app = createMcpExpressApp({
    host: config.http.host,
    ...(config.http.allowedHosts.length === 0
      ? {}
      : { allowedHosts: [...config.http.allowedHosts] })
  });

  if (config.http.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: [...config.http.corsOrigins],
        methods: ['POST'],
        allowedHeaders: ['content-type', 'mcp-protocol-version'],
        maxAge: 86_400
      })
    );
  }
  app.use(
    express.json({
      limit: config.maxRequestBytes,
      type: ['application/json', 'application/*+json']
    })
  );
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ready' });
  });
  app.post('/mcp', async (request, response) => {
    const server = createMcpServer(dependencies, logger);
    // The SDK's Transport declarations are currently incompatible with
    // exactOptionalPropertyTypes. This preserves a runtime-verified stateless
    // transport without weakening project-wide TypeScript settings.
    const options = {
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    } as unknown as StreamableHTTPServerTransportOptions;
    const transport = new StreamableHTTPServerTransport(options);
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      logger.error({ event: 'http_mcp_request_failed' });
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });
  app.all('/mcp', (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null
    });
  });

  const httpServer = createServer(app);
  await listen(httpServer, config.http.port, config.http.host);
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.http.port;
  const hostname = isWildcardHost(config.http.host) ? '127.0.0.1' : config.http.host;
  const url = `http://${hostname}:${port}/mcp`;
  logger.info({ event: 'server_started', transport: 'streamable-http', url });

  return { url, close: () => closeServer(httpServer) };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}
