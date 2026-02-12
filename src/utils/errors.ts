/**
 * Structured error types for Disclaude agents.
 *
 * Provides consistent error handling with rich context for debugging
 * and error recovery strategies.
 */

/**
 * Base error class for all agent execution errors.
 */
export class AgentExecutionError extends Error {
  /**
   * @param message - Human-readable error message
   * @param options - Additional error context
   */
  constructor(
    message: string,
    public options: {
      /** Original error that caused this error */
      cause?: Error;
      /** Agent type that threw the error */
      agent?: string;
      /** Task ID being processed */
      taskId?: string;
      /** Iteration number */
      iteration?: number;
      /** Whether the error is recoverable (can retry) */
      recoverable?: boolean;
    }
  ) {
    super(message);
    this.name = 'AgentExecutionError';

    // Maintain stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentExecutionError);
    }

    // Include cause in message for better logging
    if (options.cause) {
      this.message = `${message} (caused by: ${options.cause.message})`;
    }
  }

  /**
   * Get error details as object for logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      agent: this.options.agent,
      taskId: this.options.taskId,
      iteration: this.options.iteration,
      recoverable: this.options.recoverable,
      cause: this.options.cause?.message,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  /**
   * @param message - Human-readable error message
   * @param timeoutMs - Timeout duration in milliseconds
   * @param operation - Operation that timed out (optional)
   */
  constructor(
    message: string,
    public timeoutMs: number,
    public operation?: string
  ) {
    super(message);
    this.name = 'TimeoutError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }

  /**
   * Get timeout duration in human-readable format.
   */
  getTimeoutDuration(): string {
    if (this.timeoutMs < 1000) {
      return `${this.timeoutMs}ms`;
    } else if (this.timeoutMs < 60000) {
      return `${(this.timeoutMs / 1000).toFixed(1)}s`;
    } else {
      return `${(this.timeoutMs / 60000).toFixed(1)}m`;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      timeoutMs: this.timeoutMs,
      timeoutDuration: this.getTimeoutDuration(),
      operation: this.operation,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when SDK operation fails.
 */
export class SDKError extends Error {
  /**
   * @param message - Human-readable error message
   * @param sdkDetails - Raw SDK error details
   * @param sdkOperation - SDK operation that failed (query, stream, etc.)
   */
  constructor(
    message: string,
    public sdkDetails: unknown,
    public sdkOperation?: string
  ) {
    super(message);
    this.name = 'SDKError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SDKError);
    }
  }

  /**
   * Check if this error is retryable.
   *
   * SDK errors are typically retryable if they're network-related
   * or transient failures.
   */
  isRetryable(): boolean {
    // Check for common retryable error patterns
    const message = this.message.toLowerCase();

    const retryablePatterns = [
      'timeout',
      'network',
      'connection',
      'econnreset',
      'etimedout',
      'econnrefused',
      'rate limit',
      'temporary',
      'unavailable',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      sdkOperation: this.sdkOperation,
      isRetryable: this.isRetryable(),
      sdkDetails: this.sdkDetails,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when file operation fails.
 */
export class FileOperationError extends Error {
  public cause?: Error;

  /**
   * @param message - Human-readable error message
   * @param filePath - File path that caused the error
   * @param operation - File operation that failed (read, write, delete, etc.)
   * @param cause - Original error
   */
  constructor(
    message: string,
    public filePath: string,
    public operation: string,
    cause?: Error
  ) {
    super(message);
    this.name = 'FileOperationError';
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileOperationError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      filePath: this.filePath,
      operation: this.operation,
      cause: this.cause ? this.cause.message : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends Error {
  /**
   * @param message - Human-readable error message
   * @param field - Field that failed validation
   * @param value - Value that failed validation
   */
  constructor(
    message: string,
    public field?: string,
    public value?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      field: this.field,
      value: this.value,
      stack: this.stack,
    };
  }
}

/**
 * Helper function to check if an error is retryable.
 *
 * @param error - Error to check
 * @returns true if error is retryable
 */
export function isRetryable(error: Error): boolean {
  if (error instanceof SDKError) {
    return error.isRetryable();
  }

  if (error instanceof AgentExecutionError) {
    return error.options.recoverable ?? false;
  }

  // Timeout errors are generally not retryable at the same timeout
  if (error instanceof TimeoutError) {
    return false;
  }

  // File operation errors are not retryable (might succeed on retry if locking issue)
  if (error instanceof FileOperationError) {
    return true;
  }

  // Validation errors are never retryable (same input will fail again)
  if (error instanceof ValidationError) {
    return false;
  }

  // Default: unknown errors are not retryable
  return false;
}

/**
 * Helper function to format error for logging.
 *
 * @param error - Error to format
 * @returns Formatted error object
 */
export function formatError(error: Error): Record<string, unknown> {
  if (error instanceof AgentExecutionError ||
      error instanceof TimeoutError ||
      error instanceof SDKError ||
      error instanceof FileOperationError ||
      error instanceof ValidationError) {
    return error.toJSON();
  }

  // Generic error
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}
