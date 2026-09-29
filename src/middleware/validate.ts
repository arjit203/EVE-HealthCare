import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface RequestSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Validates and replaces req.body / req.params / req.query with the parsed
 * (typed, coerced, stripped) values. A ZodError is forwarded to the error handler.
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) {
      // req.query is a getter in Express 5, so it has to be redefined rather than assigned.
      Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query) });
    }
    next();
  };
