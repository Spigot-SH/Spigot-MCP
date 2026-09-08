#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = resolve(projectRoot, 'src/tools/index.ts');
const environmentExamplePath = resolve(projectRoot, '.env.example');
const apiToolImportMarker = '// <api-tool-imports>';
const apiToolFactoryMarker = '// <api-tool-factories>';
const supportedTypes = new Map([
  ['string', 'z.string()'],
  ['number', 'z.number()'],
  ['boolean', 'z.boolean()']
]);

const dryRun = process.argv.includes('--dry-run');
const readline = createInterface({ input: process.stdin, terminal: false });
const answers = [];
let waitingForAnswer;
let inputClosed = false;

readline.on('line', (line) => {
  if (waitingForAnswer !== undefined) {
    const resolve = waitingForAnswer;
    waitingForAnswer = undefined;
    resolve(line);
    return;
  }
  answers.push(line);
});
readline.on('close', () => {
  inputClosed = true;
});

try {
  const details = await collectDetails();
  const changes = buildChanges(details);

  printSummary(details, changes);
  const shouldWrite = dryRun ? false : await confirm('Write these files and update the registry?');
  if (shouldWrite) {
    await applyChanges(changes);
    console.log(
      `\nCreated ${details.toolName}. Run: npm run format && npm run test && npm run typecheck`
    );
  } else {
    console.log(
      dryRun ? '\nDry run complete; no files were changed.' : '\nCancelled; no files were changed.'
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Tool generation failed.';
  console.error(`\nError: ${message}`);
  process.exitCode = 1;
} finally {
  readline.close();
}

async function collectDetails() {
  console.log(
    '\nCreate a no-auth, flat-JSON API tool. Supported field types: string, number, boolean.'
  );
  const toolName = await askToolName();
  const description = await askRequired('Tool description');
  const apiBaseUrl = await askApiBaseUrl();
  const method = await askMethod();
  const endpointPath = await askEndpointPath();
  const authentication = (
    await askRequired('Does this endpoint require authentication? (yes/no)')
  ).toLowerCase();
  if (authentication !== 'no') {
    throw new Error(
      'This generator intentionally supports no-auth APIs only. Add authenticated integrations manually so their secret configuration can be reviewed.'
    );
  }
  const flatResponse = (
    await askRequired('Does it return a flat JSON object? (yes/no)')
  ).toLowerCase();
  if (flatResponse !== 'yes') {
    throw new Error(
      'This generator supports flat JSON responses only. Scaffold manually for nested, paginated, streamed, or non-JSON APIs.'
    );
  }

  const inputFields = parseInputFields(
    await ask('Input fields (`name:type`, comma-separated; leave blank for none)', '')
  );
  const queryFields = parseQueryFields(
    await ask('Fields sent as query parameters (comma-separated; leave blank for none)', ''),
    inputFields
  );
  const outputFields = parseOutputFields(
    await askRequired('Response mappings (`outputName:responseField:type`, comma-separated)')
  );
  validateEndpointArguments(endpointPath, inputFields);

  const pathArgumentNames = getPathArgumentNames(endpointPath);
  if (method === 'GET') {
    const transmitted = new Set([...pathArgumentNames, ...queryFields]);
    const unused = inputFields.filter((field) => !transmitted.has(field.name));
    if (unused.length > 0) {
      throw new Error(
        `GET input fields must be path or query parameters: ${unused.map((field) => field.name).join(', ')}`
      );
    }
  }

  return {
    toolName,
    description,
    apiBaseUrl,
    host: new URL(apiBaseUrl).hostname,
    method,
    endpointPath,
    inputFields,
    queryFields,
    outputFields,
    pathArgumentNames
  };
}

function buildChanges(details) {
  const fileStem = details.toolName.replaceAll('_', '-');
  const camelName = toCamelCase(details.toolName);
  const pascalName = toPascalCase(details.toolName);
  const schemaPath = resolve(projectRoot, `src/schemas/${fileStem}.schema.ts`);
  const servicePath = resolve(projectRoot, `src/services/${fileStem}.service.ts`);
  const toolPath = resolve(projectRoot, `src/tools/${fileStem}.tool.ts`);
  const testPath = resolve(projectRoot, `src/services/${fileStem}.service.test.ts`);
  const importLine = `import { create${pascalName}Tool } from './${fileStem}.tool.js';`;
  // The leading comma lets repeated insertions remain valid even when Prettier
  // removes a trailing comma immediately before the registry marker.
  const factoryLine = `,\n    create${pascalName}Tool(dependencies)`;

  return {
    files: [
      [schemaPath, buildSchemaFile(details, camelName)],
      [servicePath, buildServiceFile(details, camelName, pascalName)],
      [toolPath, buildToolFile(details, fileStem, camelName, pascalName)],
      [testPath, buildServiceTestFile(details, fileStem, pascalName)]
    ],
    registry: { importLine, factoryLine },
    host: details.host
  };
}

function buildSchemaFile(details, camelName) {
  return `import { z } from 'zod';

export const ${camelName}InputSchema = z.object({
${zodFields(details.inputFields)}
});

export const ${camelName}OutputSchema = z.object({
${zodFields(details.outputFields)}
  requestId: z.string()
});
`;
}

function buildServiceFile(details, camelName, pascalName) {
  const pathReplacements = details.pathArgumentNames
    .map((name) => `    .replace(':${name}', encodeURIComponent(input.${name}))`)
    .join('');
  const queryLines = details.queryFields
    .map((name) => `    url.searchParams.set('${name}', String(input.${name}));`)
    .join('\n');
  const responseFields = details.outputFields
    .map((field) => `  ${field.responseName}: ${zodFor(field.type)}`)
    .join(',\n');
  const mappedFields = details.outputFields
    .map((field) => `      ${field.name}: response.${field.responseName}`)
    .join(',\n');
  const body = details.method === 'GET' ? '' : `,\n        body: JSON.stringify(input)`;
  const contentType = details.method === 'GET' ? '' : `, 'content-type': 'application/json'`;

  return `import { z } from 'zod';

import type { ${camelName}InputSchema, ${camelName}OutputSchema } from '../schemas/${details.toolName.replaceAll('_', '-')}.schema.js';
import type { HttpClient } from './http-client.js';

const apiBaseUrl = ${JSON.stringify(details.apiBaseUrl)};
const endpointPath = ${JSON.stringify(details.endpointPath)};
const responseSchema = z.object({
${responseFields}
});

export type ${pascalName}Result = Omit<z.infer<typeof ${camelName}OutputSchema>, 'requestId'>;

export class ${pascalName}Service {
  public constructor(private readonly httpClient: HttpClient) {}

  public async execute(input: z.infer<typeof ${camelName}InputSchema>): Promise<${pascalName}Result> {
    const path = endpointPath${pathReplacements};
    const url = new URL(path, apiBaseUrl);
${queryLines || '    // This endpoint has no query parameters.'}
    const response = await this.httpClient.requestJson(
      {
        url: url.toString(),
        method: '${details.method}',
        headers: { accept: 'application/json'${contentType} }${body}
      },
      responseSchema
    );

    return {
${mappedFields}
    };
  }
}
`;
}

function buildToolFile(details, fileStem, camelName, pascalName) {
  return `import { ${camelName}InputSchema, ${camelName}OutputSchema } from '../schemas/${fileStem}.schema.js';
import { ${pascalName}Service } from '../services/${fileStem}.service.js';
import { executeTool } from './tool-executor.js';
import type { RegisteredTool } from './registered-tool.js';
import type { ToolDefinition, ToolDependencies } from '../types/tool.js';

export function create${pascalName}Definition(
  dependencies: ToolDependencies,
  service = new ${pascalName}Service(dependencies.httpClient)
): ToolDefinition<typeof ${camelName}InputSchema, typeof ${camelName}OutputSchema> {
  return {
    name: '${details.toolName}',
    description: ${JSON.stringify(details.description)},
    inputSchema: ${camelName}InputSchema,
    outputSchema: ${camelName}OutputSchema,
    async execute(input, context) {
      const data = await service.execute(input);
      const output = { ...data, requestId: context.requestId };
      return {
        structuredContent: output,
        content: [{ type: 'text', text: JSON.stringify({ data: output }) }]
      };
    }
  };
}

export function create${pascalName}Tool(dependencies: ToolDependencies): RegisteredTool {
  const definition = create${pascalName}Definition(dependencies);
  return {
    name: definition.name,
    description: definition.description,
    register(server, logger) {
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
          outputSchema: definition.outputSchema
        },
        async (input, extra) =>
          executeTool(definition, input, logger, { requestId: String(extra.requestId) })
      );
    }
  };
}
`;
}

function buildServiceTestFile(details, fileStem, pascalName) {
  const response = Object.fromEntries(
    details.outputFields.map((field) => [field.responseName, sampleValue(field.type)])
  );
  const expected = Object.fromEntries(
    details.outputFields.map((field) => [field.name, response[field.responseName]])
  );
  const input = Object.fromEntries(
    details.inputFields.map((field) => [field.name, sampleValue(field.type)])
  );

  return `import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../config/env.js';
import { HttpClient, type FetchImplementation } from './http-client.js';
import { ${pascalName}Service } from './${fileStem}.service.js';

const config: AppConfig['externalApi'] = {
  timeoutMs: 1_000,
  retries: 0,
  retryBaseDelayMs: 0,
  allowedHosts: [${JSON.stringify(details.host)}]
};

describe('${pascalName}Service', () => {
  it('maps a validated API response to the service contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(${JSON.stringify(JSON.stringify(response))}, { status: 200 })
    ) as unknown as FetchImplementation;
    const service = new ${pascalName}Service(new HttpClient(config, fetchMock));

    await expect(service.execute(${JSON.stringify(input)})).resolves.toEqual(${JSON.stringify(expected)});
  });
});
`;
}

async function applyChanges(changes) {
  for (const [path] of changes.files) {
    await ensureDoesNotExist(path);
  }

  const registry = await readFile(registryPath, 'utf8');
  if (!registry.includes(apiToolImportMarker) || !registry.includes(apiToolFactoryMarker)) {
    throw new Error(
      'Tool registry markers are missing. Add the tool manually or restore src/tools/index.ts.'
    );
  }
  if (registry.includes(changes.registry.importLine)) {
    throw new Error('A registry entry for this tool already exists.');
  }
  const updatedRegistry = registry
    .replace(apiToolImportMarker, `${changes.registry.importLine}\n${apiToolImportMarker}`)
    .replace(apiToolFactoryMarker, `${changes.registry.factoryLine}\n    ${apiToolFactoryMarker}`);
  const environmentExample = await readFile(environmentExamplePath, 'utf8');

  await Promise.all(
    changes.files.map(([path, content]) =>
      writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    )
  );
  await writeFile(registryPath, updatedRegistry);
  await writeFile(environmentExamplePath, addAllowedHost(environmentExample, changes.host));
}

function addAllowedHost(environmentExample, host) {
  const matcher = /^EXTERNAL_API_ALLOWED_HOSTS=(.*)$/mu;
  const match = environmentExample.match(matcher);
  if (match === null) {
    throw new Error('EXTERNAL_API_ALLOWED_HOSTS is missing from .env.example.');
  }
  const hosts = new Set(
    match[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  hosts.add(host);
  return environmentExample.replace(
    matcher,
    `EXTERNAL_API_ALLOWED_HOSTS=${[...hosts].sort().join(',')}`
  );
}

async function ensureDoesNotExist(path) {
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function askToolName() {
  const value = await askRequired('Tool name (lowercase snake_case)');
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error('Tool name must be lowercase snake_case.');
  }
  return value;
}

async function askApiBaseUrl() {
  const value = await askRequired(
    'API base URL (HTTPS origin, for example https://api.example.com)'
  );
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('API base URL must be an HTTPS origin without a path, query, or fragment.');
  }
  return url.origin;
}

async function askMethod() {
  const value = (await ask('HTTP method', 'GET')).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value)) {
    throw new Error('HTTP method must be GET, POST, PUT, PATCH, or DELETE.');
  }
  return value;
}

async function askEndpointPath() {
  const value = await askRequired(
    'Endpoint path (use :argument for path parameters, for example /v1/items/:id)'
  );
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new Error(
      'Endpoint path must start with / and must not contain a query string or fragment.'
    );
  }
  return value;
}

async function ask(label, defaultValue) {
  process.stdout.write(`${label}${defaultValue === '' ? '' : ` [${defaultValue}]`}: `);
  const answer = (await nextAnswer()).trim();
  return answer === '' ? defaultValue : answer;
}

function nextAnswer() {
  if (answers.length > 0) {
    return Promise.resolve(answers.shift());
  }
  if (inputClosed) {
    return Promise.reject(new Error('Input closed before all required answers were provided.'));
  }
  return new Promise((resolve) => {
    waitingForAnswer = resolve;
  });
}

async function askRequired(label) {
  const value = await ask(label, '');
  if (value === '') {
    throw new Error(`${label} is required.`);
  }
  return value;
}

async function confirm(label) {
  return (await ask(`${label} (yes/no)`, 'no')).toLowerCase() === 'yes';
}

function parseInputFields(value) {
  if (value === '') {
    return [];
  }
  return parseFieldList(value, 2, (parts) => ({ name: parts[0], type: parts[1] }));
}

function parseOutputFields(value) {
  return parseFieldList(value, 3, (parts) => ({
    name: parts[0],
    responseName: parts[1],
    type: parts[2]
  }));
}

function parseFieldList(value, expectedParts, mapper) {
  const fields = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(':').map((part) => part.trim()));
  if (fields.some((parts) => parts.length !== expectedParts)) {
    throw new Error('One or more fields do not follow the required format.');
  }
  const mapped = fields.map(mapper);
  const names = new Set();
  for (const field of mapped) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(field.name) || !supportedTypes.has(field.type)) {
      throw new Error(
        'Field names must be JavaScript identifiers and types must be string, number, or boolean.'
      );
    }
    if (names.has(field.name)) {
      throw new Error(`Duplicate field name: ${field.name}`);
    }
    names.add(field.name);
  }
  return mapped;
}

function parseQueryFields(value, inputFields) {
  if (value === '') {
    return [];
  }
  const inputNames = new Set(inputFields.map((field) => field.name));
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (new Set(names).size !== names.length || names.some((name) => !inputNames.has(name))) {
    throw new Error('Query fields must be unique names declared in the input fields.');
  }
  return names;
}

function getPathArgumentNames(endpointPath) {
  return [...endpointPath.matchAll(/:([A-Za-z][A-Za-z0-9]*)/gu)].map((match) => match[1]);
}

function validateEndpointArguments(endpointPath, inputFields) {
  const inputNames = new Set(inputFields.map((field) => field.name));
  const pathNames = getPathArgumentNames(endpointPath);
  if (
    new Set(pathNames).size !== pathNames.length ||
    pathNames.some((name) => !inputNames.has(name))
  ) {
    throw new Error('Every :path parameter must be unique and declared in the input fields.');
  }
}

function zodFields(fields) {
  return fields.map((field) => `  ${field.name}: ${zodFor(field.type)},`).join('\n');
}

function zodFor(type) {
  return supportedTypes.get(type);
}

function sampleValue(type) {
  return type === 'string' ? 'example' : type === 'number' ? 1 : true;
}

function toCamelCase(value) {
  return value.replace(/_([a-z0-9])/gu, (_, character) => character.toUpperCase());
}

function toPascalCase(value) {
  const camelCase = toCamelCase(value);
  return camelCase[0].toUpperCase() + camelCase.slice(1);
}

function printSummary(details, changes) {
  console.log(`\nTool: ${details.toolName}\nHost allowlist: ${details.host}\nFiles:`);
  for (const [path] of changes.files) {
    console.log(`- ${path.replace(`${projectRoot}/`, '')}`);
  }
  console.log('- src/tools/index.ts\n- .env.example');
}
