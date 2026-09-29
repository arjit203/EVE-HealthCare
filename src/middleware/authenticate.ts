import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Protects a route: requires "Authorization: Bearer <jwt>" and sets req.user.
 * The user is taken from the verified token, so no database lookup is needed.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header) throw AppError.unauthorized('Missing Authorization header');

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Authorization header must be in the format: Bearer <token>');
  }

  req.user = verifyAccessToken(token);
  next();
};
