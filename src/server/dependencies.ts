import type { AppConfig } from '../config/env.js';
import { HttpClient } from '../services/http-client.js';
import { TextAnalysisService } from '../services/text-analysis.service.js';
import type { ToolDependencies } from '../types/tool.js';

export function createToolDependencies(config: AppConfig): ToolDependencies {
  return {
    textAnalysisService: new TextAnalysisService(),
    httpClient: new HttpClient(config.externalApi),
    serverMetadata: {
      name: config.serverName,
      version: config.serverVersion,
      environment: config.environment
    },
    maxInputChars: config.maxInputChars
  };
}
