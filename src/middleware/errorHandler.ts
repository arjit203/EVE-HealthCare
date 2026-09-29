import type { ErrorRequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError, z } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

const sendError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) => res.status(status).json({ error: { code, message, details } });

/**
 * Single place that converts any thrown error into a consistent JSON response:
 *   { "error": { "code": "...", "message": "...", "details"?: ... } }
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      z.flattenError(err),
    );
  }

  // Malformed JSON body (raised by express.json()).
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Malformed JSON body');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return sendError(res, 409, 'CONFLICT', 'Resource already exists');
    if (err.code === 'P2025') return sendError(res, 404, 'NOT_FOUND', 'Resource not found');
  }

  logger.error('Unhandled error', {
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Something went wrong');
};
