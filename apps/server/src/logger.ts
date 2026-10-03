import { type Logger, pino } from 'pino';

const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';

export function createLogger(): Logger {
  return pino({ level: process.env.LOG_LEVEL ?? (isDev ? 'info' : 'info') });
}
