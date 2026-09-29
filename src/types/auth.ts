import type { Role } from '@prisma/client';

/** The authenticated user, as extracted from a verified JWT. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** A user as returned by the API. Never includes passwordHash. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
}
