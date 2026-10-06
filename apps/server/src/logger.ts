import { type Logger, pino } from 'pino';
import type { Config } from './config.js';

export function createLogger(config: Pick<Config, 'logLevel'>): Logger {
  return pino({ level: config.logLevel });
}
