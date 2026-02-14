/**
 * Simple logger for Sotto
 * Wraps console with structured output and log levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, data));
    }
  },

  error(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },
};
