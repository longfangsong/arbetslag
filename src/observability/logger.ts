/**
 * Structured Logger for Agent Framework
 * 
 * Supports:
 * - JSON output (for machine parsing)
 * - Human-readable output (for development)
 * - Log level filtering
 * - Context metadata propagation
 * 
 * Edge-runtime compatible (no pino dependency)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: any;
}

class StructuredLogger {
  private level: LogLevel;
  private serviceName: string;

  constructor(serviceName: string, level: LogLevel = 'info') {
    this.serviceName = serviceName;
    // Try to read log level from environment, fall back to parameter
    this.level = level;
    try {
      const envLevel = (globalThis as any).process?.env?.LOG_LEVEL as LogLevel | undefined;
      if (envLevel) {
        this.level = envLevel;
      }
    } catch {
      // Running in environment without process - ignore
    }
  }

  /**
   * Log at DEBUG level (most detailed)
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log at INFO level
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    // Check if we should log based on level
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentIndex = levels.indexOf(this.level);
    const messageIndex = levels.indexOf(level);

    if (messageIndex < currentIndex) {
      return; // Skip log if level is lower than configured
    }

    // Format JSON output
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...(context && { context }),
    };

    // Use console methods (works in Node.js and edge runtime)
    if (typeof console !== 'undefined') {
      if (level === 'error') {
        console.error(JSON.stringify(logEntry));
      } else if (level === 'warn') {
        console.warn(JSON.stringify(logEntry));
      } else {
        console.log(JSON.stringify(logEntry));
      }
    }
  }
}

// Singleton instance
export const logger = new StructuredLogger('agent-factory', 'info');

/**
 * Create a logger for a specific service
 */
export function createLogger(serviceName: string): StructuredLogger {
  return new StructuredLogger(serviceName);
}

// Legacy exports for compatibility
export class Logger {
  private logger: StructuredLogger;

  constructor(serviceName: string) {
    this.logger = new StructuredLogger(serviceName);
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const errorContext = {
      ...context,
      error: error?.message,
      stack: error?.stack,
    };
    this.logger.error(message, errorContext);
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }
}
