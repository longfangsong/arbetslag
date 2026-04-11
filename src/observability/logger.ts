import { pino, AnsiColors } from 'pino';

export class Logger {
  private logger: pino.Logger;

  constructor(serviceName: string) {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    });
    this.logger.info(`Logger initialized for service: ${serviceName}`);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.logger.info(context, message);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>) {
    this.prefixedError(message, error, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.logger.warn(context, message);
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.logger.debug(context, message);
  }

  private prefixedError(message: string, error?: Error, context?: Record<string, unknown>) {
    const errorContext = {
      ...context,
      error: error ? error.message : undefined,
      stack: error?.stack,
    };
    this.logger.error(errorContext, message);
  }
}

export const createLogger = (serviceName: string): Logger => new Logger(serviceName);
