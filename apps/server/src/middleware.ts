import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

/**
 * Express middleware that logs every request as a single line via the shared pino logger.
 * Kept tiny so behaviour stays obvious during the scaffold task.
 */
export function createHttpLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          url: req.originalUrl || req.url,
          status: res.statusCode,
          ms: Date.now() - start,
        },
        'req',
      );
    });
    next();
  };
}
