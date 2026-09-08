# Spigot MCP

Spigot MCP is a stateless [Model Context Protocol](https://modelcontextprotocol.io/) server written in TypeScript. It uses the official MCP TypeScript SDK over standard input/output, so it works with MCP-compatible clients without exposing an HTTP listener by default.

The included tools are intentionally safe, dependency-free examples. They provide a production-ready pattern for adding domain-specific agent capabilities without adding a database, cache, or other infrastructure.

## Architecture

```text
MCP client
  -> Stdio transport (src/server)
  -> Tool registry and request lifecycle (src/tools)
  -> Business services (src/services)
  -> Config, schemas, logging, and safe errors (src/config, src/schemas, src/utils)
```

- `src/server`: MCP SDK setup, stdio transport, and shutdown lifecycle.
- `src/tools`: declarative, self-registering tool definitions. The registry assembles tools; tools only validate/translate inputs and invoke services.
- `src/services`: domain logic and the reusable restricted outbound HTTP boundary.
- `src/schemas`: Zod input schemas.
- `src/config`: typed, startup-validated environment configuration.
- `src/utils`: JSON logging and MCP-safe application errors.
- `src/types`: shared contracts between tools and services.

Each tool execution uses the MCP JSON-RPC request ID, emits structured start/completion logs, and returns schema-validated MCP `structuredContent` plus a text fallback. Request payloads are deliberately not logged.

## Prerequisites

- Node.js 20.11 or newer (Node 22 LTS recommended)
- npm 10 or newer
- Docker, optionally

## Install and run locally

```bash
cp .env.example .env
npm install
npm run dev
```

The server communicates using MCP JSON-RPC over stdin/stdout. Keep stdout reserved for MCP traffic; operational logs are emitted as structured JSON by the logger.

For a compiled production run:

```bash
npm run build
npm run start
```

## Environment configuration

Copy `.env.example` to `.env` for local development. The application loads this file at startup without overriding real environment variables supplied by a deployment platform. All variables have secure defaults except where a future deployment chooses to require stricter values.

| Variable                           | Default       | Purpose                                                                 |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                         | `development` | One of `development`, `test`, or `production`.                          |
| `LOG_LEVEL`                        | `info`        | Pino log level.                                                         |
| `MCP_SERVER_NAME`                  | `spigot-mcp`  | Advertised MCP server name.                                             |
| `MCP_SERVER_VERSION`               | `0.1.0`       | Advertised MCP server version.                                          |
| `MAX_INPUT_CHARS`                  | `10000`       | Maximum accepted text size for `analyze_text`.                          |
| `MAX_REQUEST_BYTES`                | `1048576`     | Maximum complete JSON-RPC message accepted over stdio.                  |
| `EXTERNAL_API_TIMEOUT_MS`          | `5000`        | Timeout used by the outbound HTTP service.                              |
| `EXTERNAL_API_RETRIES`             | `2`           | Retry count for transient network and 5xx failures.                     |
| `EXTERNAL_API_RETRY_BASE_DELAY_MS` | `200`         | Base backoff delay; retries use capped exponential backoff with jitter. |
| `EXTERNAL_API_ALLOWED_HOSTS`       | empty         | Comma-separated HTTPS host allowlist for future external integrations.  |

Do not put secrets in source code or logs. If a future tool needs a credential, inject it through the runtime environment or a secret manager and redact it in the logging configuration.

## Available MCP tools

| Tool           | Input                                            | Output                                                                      |
| -------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `server_info`  | No arguments                                     | Non-sensitive server name, version, environment, readiness, and request ID. |
| `analyze_text` | `{ "text": string, "includePreview"?: boolean }` | Character, word, and line counts; optionally a 160-character preview.       |

`analyze_text` never retains input. Text is constrained by `MAX_INPUT_CHARS`; malformed input returns an MCP tool error with a safe error code and request ID.

## Docker

Build the minimal multi-stage production image:

```bash
docker build -t spigot-mcp .
docker run --rm -i --env-file .env spigot-mcp
```

The final image installs production dependencies only and runs as the non-root `node` user. Pass deployment configuration as environment variables or with `--env-file`; the image does not contain `.env` files.

### Deploy as a remote MCP server (Claude.ai)

The default `stdio` transport is for local clients. Claude.ai cannot start a process on your computer: deploy the image to a public HTTPS domain and use the Streamable HTTP endpoint at `/mcp`.

```bash
docker build -t spigot-mcp .
docker run --rm -p 3000:3000 \
  -e MCP_TRANSPORT=http \
  -e HTTP_HOST=0.0.0.0 \
  -e HTTP_PORT=3000 \
  -e HTTP_ALLOWED_HOSTS=mcp.example.com \
  spigot-mcp
```

Put a TLS-terminating reverse proxy or managed platform in front of the container; Claude.ai requires the resulting public URL, for example `https://mcp.example.com/mcp`. Confirm `https://mcp.example.com/health` responds with `{ "status": "ready" }`, then add the `/mcp` URL in Claude's **Settings → Connectors → Add custom connector**. Custom remote connectors are available on Claude/Claude Desktop paid plans; Claude supports both authless and OAuth-based remote MCP servers. This starter is intentionally authless because its included tools expose only public information. Add OAuth at the HTTP transport boundary before adding private or write-capable tools.

### Temporary public URL without a domain

For local development or a short Claude.ai demo, expose the HTTP server using a Cloudflare Quick Tunnel. This creates a random HTTPS URL under `trycloudflare.com`; no domain or Cloudflare account is needed.

1. Build the server:

   ```bash
   npm run build
   ```

2. In the first terminal, start a tunnel to the local HTTP port:

   ```bash
   npx wrangler tunnel quick-start http://127.0.0.1:3000
   ```

   Alternatively, use an installed `cloudflared` binary:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:3000
   ```

   The command prints a URL like `https://orange-forest-1234.trycloudflare.com`. Keep this terminal running.

3. Set the tunnel's hostname (without `https://`) in `.env`:

   ```env
   MCP_TRANSPORT=http
   HTTP_HOST=127.0.0.1
   HTTP_PORT=3000
   HTTP_ALLOWED_HOSTS=orange-forest-1234.trycloudflare.com
   ```

4. In a second terminal, start the server:

   ```bash
   npm run start
   ```

5. Verify the tunnel and add this URL in Claude.ai's **Settings → Connectors → Add custom connector**:

   ```text
   https://orange-forest-1234.trycloudflare.com/mcp
   ```

   The health endpoint is available at `https://orange-forest-1234.trycloudflare.com/health`.

Quick Tunnels are temporary: the hostname changes when the tunnel process stops, and anyone with the URL can access this authless server. Use them only for development and demos. They also have service limits and do not support SSE; this server's basic tool calls use direct JSON responses. For persistent or sensitive use, deploy a stable HTTPS endpoint and add OAuth. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## Quality checks

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

Tests cover services, outbound HTTP policy/retries/output validation, tool validation, and safe error mapping. External dependencies are mocked.

## Add a new MCP tool

1. Define its Zod input schema in `src/schemas`.
2. Put business logic and external integration work in a service in `src/services`. Use `HttpClient` for outbound calls; it enforces HTTPS, an allowlist, no redirect following, timeout, retry behavior with jitter, and optional response validation.
3. Create a self-registering tool module in `src/tools` with Zod input and output schemas, then return MCP `structuredContent`. It can construct its service using the shared `httpClient` dependency.
4. Add one import and one factory entry to `src/tools/index.ts`. No changes are needed in `src/server/create-server.ts` or `src/server/run.ts`.
5. Add service, schema/error, and tool execution tests. Never log raw user input, credentials, or untrusted response bodies.

The explicit registry is intentional: it keeps every model-visible capability reviewable and avoids unsafe runtime discovery of arbitrary files or API URLs.

### Scaffold a simple public API tool

For a no-auth JSON API with a flat response object, use the interactive generator:

```bash
npm run tool:add
```

It asks for the tool name and description, HTTPS API origin, method and endpoint path, input/query fields, and the API response fields to expose. After showing a summary, it generates schema, service, tool, and mocked service-test files; adds the tool to the registry; and adds only that API hostname to `.env.example`'s outbound allowlist. Inspect the generated code and run:

```bash
npm run format
npm run test
npm run typecheck
```

Preview the planned files without writing them:

```bash
npm run tool:add -- --dry-run
```

The generator deliberately supports only no-auth APIs with simple `string`, `number`, and `boolean` fields and flat JSON responses. Build authenticated, nested, paginated, streamed, or non-JSON integrations manually so their credentials, response mapping, and authorization behavior receive a focused review.

## Production considerations

- Use a process supervisor and capture stderr logs centrally.
- Set explicit environment values in deployment rather than relying on defaults.
- Configure `EXTERNAL_API_ALLOWED_HOSTS` before enabling any networked integration; do not relax the HTTPS-only policy without a reviewed requirement.
- Add authentication/authorization at the transport boundary when deploying beyond a trusted local MCP client. The tools already depend on interfaces rather than transport state, so this can be added without changing business services.
- Configure `MAX_REQUEST_BYTES` for the maximum JSON-RPC payload your client should be permitted to send; future HTTP/SSE transports must enforce equivalent proxy and application limits.
- Pin and regularly update dependencies, scan images, and run the verification commands in CI.
