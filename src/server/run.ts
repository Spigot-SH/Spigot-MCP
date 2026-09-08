import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from 'pino';

import { loadConfig, loadEnvironmentFile } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createMcpServer } from './create-server.js';
import { createToolDependencies } from './dependencies.js';
import { startHttpServer } from './http.js';

export async function runServer(): Promise<void> {
  loadEnvironmentFile();
  const config = loadConfig();
  const logger = createLogger(config);
  const lifecycle =
    config.transport === 'http'
      ? await startHttpServer(config, createToolDependencies(config), logger)
      : await startStdioServer(config, logger);
  let isShuttingDown = false;

  const shutdown = createShutdownHandler(
    lifecycle,
    logger,
    () => {
      isShuttingDown = true;
    },
    () => isShuttingDown
  );
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function startStdioServer(config: ReturnType<typeof loadConfig>, logger: Logger) {
  const server = createMcpServer(createToolDependencies(config), logger);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: config.maxRequestBytes
  });
  await server.connect(transport);
  logger.info({ event: 'server_started', transport: 'stdio' });
  return server;
}

function createShutdownHandler(
  server: { close(): Promise<void> },
  logger: Logger,
  markShuttingDown: () => void,
  isShuttingDown: () => boolean
): () => void {
  return () => {
    if (isShuttingDown()) {
      return;
    }
    markShuttingDown();
    logger.info({ event: 'server_shutdown_started' });
    void (async () => {
      try {
        await server.close();
        logger.info({ event: 'server_shutdown_completed' });
      } catch {
        logger.error({ event: 'server_shutdown_failed' });
        process.exitCode = 1;
      } finally {
        await flushLogger(logger);
      }
    })();
  };
}

function flushLogger(logger: Logger): Promise<void> {
  return new Promise((resolve) => {
    logger.flush(() => resolve());
  });
}
