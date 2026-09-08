import pino, { type Logger, type LoggerOptions } from 'pino';

import type { AppConfig } from '../config/env.js';

const loggerOptions: LoggerOptions = {
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'apiKey',
      'authorization',
      'password',
      'token',
      '*.apiKey',
      '*.authorization',
      '*.password',
      '*.token'
    ],
    censor: '[REDACTED]'
  }
};

export function createLogger(config: AppConfig): Logger {
  return pino({ ...loggerOptions, level: config.logLevel }, pino.destination(2));
}
