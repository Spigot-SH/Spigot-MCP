import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MCP_SERVER_NAME: z.string().min(1).max(100).default('spigot-mcp'),
  MCP_SERVER_VERSION: z.string().min(1).max(100).default('0.1.0'),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  HTTP_HOST: z.string().min(1).max(255).default('127.0.0.1'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  HTTP_ALLOWED_HOSTS: z.string().optional(),
  HTTP_CORS_ORIGINS: z.string().optional(),
  MAX_INPUT_CHARS: z.coerce.number().int().min(1).max(100_000).default(10_000),
  MAX_REQUEST_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  EXTERNAL_API_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  EXTERNAL_API_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(200),
  EXTERNAL_API_ALLOWED_HOSTS: z.string().optional()
});

export type AppConfig = Readonly<{
  environment: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  serverName: string;
  serverVersion: string;
  transport: 'stdio' | 'http';
  http: Readonly<{
    host: string;
    port: number;
    allowedHosts: readonly string[];
    corsOrigins: readonly string[];
  }>;
  maxInputChars: number;
  maxRequestBytes: number;
  externalApi: Readonly<{
    timeoutMs: number;
    retries: number;
    retryBaseDelayMs: number;
    allowedHosts: readonly string[];
  }>;
}>;

export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Loads a local dotenv file for development without overriding deployment-provided variables. */
export function loadEnvironmentFile(path = process.env.DOTENV_CONFIG_PATH ?? '.env'): void {
  loadDotenv({ path, override: false, quiet: true });
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ConfigurationError(`Invalid environment configuration: ${fields}`);
  }

  const values = parsed.data;
  const allowedHosts = parseCsv(values.HTTP_ALLOWED_HOSTS);
  if (
    values.MCP_TRANSPORT === 'http' &&
    !isLoopbackHost(values.HTTP_HOST) &&
    allowedHosts.length === 0
  ) {
    throw new ConfigurationError('HTTP_ALLOWED_HOSTS is required for a non-loopback HTTP host.');
  }
  return {
    environment: values.NODE_ENV,
    logLevel: values.LOG_LEVEL,
    serverName: values.MCP_SERVER_NAME,
    serverVersion: values.MCP_SERVER_VERSION,
    transport: values.MCP_TRANSPORT,
    http: {
      host: values.HTTP_HOST,
      port: values.HTTP_PORT,
      allowedHosts,
      corsOrigins: parseCsv(values.HTTP_CORS_ORIGINS)
    },
    maxInputChars: values.MAX_INPUT_CHARS,
    maxRequestBytes: values.MAX_REQUEST_BYTES,
    externalApi: {
      timeoutMs: values.EXTERNAL_API_TIMEOUT_MS,
      retries: values.EXTERNAL_API_RETRIES,
      retryBaseDelayMs: values.EXTERNAL_API_RETRY_BASE_DELAY_MS,
      allowedHosts: parseCsv(values.EXTERNAL_API_ALLOWED_HOSTS)
    }
  };
}

function parseCsv(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return [];
  }

  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
