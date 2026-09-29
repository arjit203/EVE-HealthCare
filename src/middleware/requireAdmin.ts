import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';

/**
 * Authorization check for admin-only routes. Must be placed after `authenticate`:
 * authenticate answers "who are you?" (401), this answers "are you allowed?" (403).
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) throw AppError.unauthorized();
  if (req.user.role !== 'ADMIN') throw AppError.forbidden('Admin access required');
  next();
};
