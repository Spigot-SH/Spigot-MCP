import type { ToolResult } from '../types/tool.js';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_SERVER_ERROR';

export class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  public constructor(message = 'The provided input is invalid.') {
    super('VALIDATION_ERROR', message, 400);
  }
}

export class AuthenticationError extends AppError {
  public constructor(message = 'Authentication is required.') {
    super('AUTHENTICATION_ERROR', message, 401);
  }
}

export class AuthorizationError extends AppError {
  public constructor(message = 'You are not allowed to perform this action.') {
    super('AUTHORIZATION_ERROR', message, 403);
  }
}

export class NotFoundError extends AppError {
  public constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', message, 404);
  }
}

export class RateLimitError extends AppError {
  public constructor(message = 'The request rate limit has been exceeded.') {
    super('RATE_LIMITED', message, 429);
  }
}

export class ExternalServiceError extends AppError {
  public constructor(message = 'The external service is unavailable.') {
    super('EXTERNAL_SERVICE_ERROR', message, 502);
  }
}

export class InternalServerError extends AppError {
  public constructor() {
    super('INTERNAL_SERVER_ERROR', 'The server could not complete this request.', 500);
  }
}

export function toSafeToolError<TOutput extends Record<string, unknown>>(
  error: unknown,
  requestId: string
): ToolResult<TOutput> {
  const applicationError = error instanceof AppError ? error : new InternalServerError();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: {
            code: applicationError.code,
            message: safeMessageFor(applicationError.code),
            requestId
          }
        })
      }
    ],
    isError: true
  };
}

function safeMessageFor(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    VALIDATION_ERROR: 'The provided input is invalid.',
    AUTHENTICATION_ERROR: 'Authentication is required.',
    AUTHORIZATION_ERROR: 'You are not allowed to perform this action.',
    NOT_FOUND: 'The requested resource was not found.',
    RATE_LIMITED: 'The request rate limit has been exceeded.',
    EXTERNAL_SERVICE_ERROR: 'The external service is unavailable.',
    INTERNAL_SERVER_ERROR: 'The server could not complete this request.'
  };
  return messages[code];
}
