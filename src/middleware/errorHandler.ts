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

  // Request-body errors raised by express.json() (body-parser), identified by err.type.
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Malformed JSON body');
  }
  if (err?.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body encoding');
  }

  // Services translate the constraint errors they expect; these are the fallbacks. The messages
  // are deliberately generic: Prisma's own messages name tables, columns and constraints.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return sendError(res, 409, 'CONFLICT', 'Resource already exists');
    if (err.code === 'P2025') return sendError(res, 404, 'NOT_FOUND', 'Resource not found');
    // Foreign key violation: a referenced record does not exist (nothing can be deleted).
    if (err.code === 'P2003') return sendError(res, 404, 'NOT_FOUND', 'Related resource not found');
  }

  logger.error('Unhandled error', {
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Something went wrong');
};
