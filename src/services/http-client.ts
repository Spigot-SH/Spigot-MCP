import type { AppConfig } from '../config/env.js';
import type { z } from 'zod';
import { ExternalServiceError, ValidationError } from '../utils/errors.js';

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Readonly<Record<string, string>>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  headers: Headers;
}

export type FetchImplementation = typeof fetch;
export type Sleep = (milliseconds: number) => Promise<void>;
export type Random = () => number;

const maxRetryDelayMs = 30_000;

/**
 * A deliberately restricted outbound client. It is not used by current tools,
 * but future integrations must use this boundary rather than calling fetch directly.
 */
export class HttpClient {
  public constructor(
    private readonly config: AppConfig['externalApi'],
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly sleep: Sleep = sleepFor,
    private readonly random: Random = Math.random
  ) {}

  public async request(request: HttpRequest): Promise<HttpResponse> {
    const url = this.validateUrl(request.url);

    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchImplementation(url, {
          method: request.method,
          signal: controller.signal,
          redirect: 'manual',
          ...(request.headers === undefined ? {} : { headers: request.headers }),
          ...(request.body === undefined ? {} : { body: request.body })
        });
        const body = await response.text();
        if (isRedirect(response.status)) {
          throw new ExternalServiceError();
        }
        if (isRetryableStatus(response.status) && attempt < this.config.retries) {
          await this.waitBeforeRetry(attempt, response.headers.get('retry-after'));
          continue;
        }
        if (!response.ok) {
          throw new ExternalServiceError();
        }
        return { status: response.status, body, headers: response.headers };
      } catch (error) {
        if (error instanceof ValidationError || error instanceof ExternalServiceError) {
          throw error;
        }
        if (attempt < this.config.retries) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ExternalServiceError();
  }

  public async requestJson<TOutput>(
    request: HttpRequest,
    schema: z.ZodType<TOutput>
  ): Promise<TOutput> {
    const response = await this.request(request);
    let payload: unknown;
    try {
      payload = JSON.parse(response.body) as unknown;
    } catch {
      throw new ExternalServiceError();
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ExternalServiceError();
    }
    return parsed.data;
  }

  private validateUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ValidationError('The external service URL is invalid.');
    }

    if (
      url.protocol !== 'https:' ||
      !this.config.allowedHosts.includes(url.hostname.toLowerCase())
    ) {
      throw new ValidationError('The external service URL is not permitted.');
    }
    return url;
  }

  private async waitBeforeRetry(attempt: number, retryAfter: string | null = null): Promise<void> {
    await this.sleep(this.calculateRetryDelay(attempt, retryAfter));
  }

  private calculateRetryDelay(attempt: number, retryAfter: string | null): number {
    const serverDelay = parseRetryAfter(retryAfter);
    if (serverDelay !== null) {
      return Math.min(serverDelay, maxRetryDelayMs);
    }

    const exponentialDelay = Math.min(this.config.retryBaseDelayMs * 2 ** attempt, maxRetryDelayMs);
    return Math.round(exponentialDelay * (0.5 + this.random()));
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
