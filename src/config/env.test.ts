import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig, loadEnvironmentFile } from './env.js';

describe('loadConfig', () => {
  it('returns typed defaults', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      environment: 'test',
      maxInputChars: 10_000,
      maxRequestBytes: 1_048_576,
      externalApi: { allowedHosts: [] }
    });
  });

  it('rejects unsafe configuration values', () => {
    expect(() => loadConfig({ EXTERNAL_API_TIMEOUT_MS: 'not-a-number' })).toThrow(
      ConfigurationError
    );
  });

  it('requires host-header protection for a public HTTP server', () => {
    expect(() => loadConfig({ MCP_TRANSPORT: 'http', HTTP_HOST: '0.0.0.0' })).toThrow(
      ConfigurationError
    );
    expect(
      loadConfig({
        MCP_TRANSPORT: 'http',
        HTTP_HOST: '0.0.0.0',
        HTTP_ALLOWED_HOSTS: 'mcp.example.com'
      })
    ).toMatchObject({ transport: 'http', http: { allowedHosts: ['mcp.example.com'] } });
  });

  it('loads local dotenv values without replacing an existing deployment value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spigot-mcp-'));
    const environmentFile = join(directory, '.env');
    const originalName = process.env.MCP_SERVER_NAME;
    const originalVersion = process.env.MCP_SERVER_VERSION;
    try {
      await writeFile(environmentFile, 'MCP_SERVER_NAME=dotenv-server\nMCP_SERVER_VERSION=2.0.0\n');
      delete process.env.MCP_SERVER_NAME;
      delete process.env.MCP_SERVER_VERSION;

      loadEnvironmentFile(environmentFile);
      expect(loadConfig()).toMatchObject({ serverName: 'dotenv-server', serverVersion: '2.0.0' });

      process.env.MCP_SERVER_NAME = 'deployment-server';
      loadEnvironmentFile(environmentFile);
      expect(loadConfig()).toMatchObject({ serverName: 'deployment-server' });
    } finally {
      if (originalName === undefined) {
        delete process.env.MCP_SERVER_NAME;
      } else {
        process.env.MCP_SERVER_NAME = originalName;
      }
      if (originalVersion === undefined) {
        delete process.env.MCP_SERVER_VERSION;
      } else {
        process.env.MCP_SERVER_VERSION = originalVersion;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
