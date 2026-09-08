import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AppConfig } from '../config/env.js';
import { ExternalServiceError, ValidationError } from '../utils/errors.js';
import { HttpClient, type FetchImplementation } from './http-client.js';

const config: AppConfig['externalApi'] = {
  timeoutMs: 1_000,
  retries: 1,
  retryBaseDelayMs: 0,
  allowedHosts: ['api.example.test']
};

describe('HttpClient', () => {
  it('blocks unapproved outbound hosts before a request is made', async () => {
    const fetchMock = vi.fn() as unknown as FetchImplementation;
    const client = new HttpClient(config, fetchMock);

    await expect(
      client.request({ url: 'https://untrusted.test/data', method: 'GET' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a transient upstream response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('retry', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('{"ok":true}', { status: 200 })
      ) as unknown as FetchImplementation;
    const client = new HttpClient(config, fetchMock);

    await expect(
      client.requestJson(
        { url: 'https://api.example.test/data', method: 'GET' },
        z.object({ ok: z.boolean() })
      )
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects redirects instead of following them outside the host allowlist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 302, headers: { location: 'https://internal.example.test' } })
      ) as unknown as FetchImplementation;
    const client = new HttpClient(config, fetchMock);

    await expect(
      client.request({ url: 'https://api.example.test/redirect', method: 'GET' })
    ).rejects.toBeInstanceOf(ExternalServiceError);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('maps malformed upstream payloads to a safe error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('not-json', { status: 200 })
      ) as unknown as FetchImplementation;
    const client = new HttpClient(config, fetchMock);

    await expect(
      client.requestJson(
        { url: 'https://api.example.test/data', method: 'GET' },
        z.object({ ok: z.boolean() })
      )
    ).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
