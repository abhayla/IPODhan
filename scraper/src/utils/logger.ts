import pino from 'pino';
import { config } from '../config.js';

const transport = config.env === 'development'
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  : undefined;

export const logger = pino({
  level: config.logging.level,
  transport,
  timestamp: pino.stdTimeFunctions.isoTime
});

export default logger;
