import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email('Invalid email address'));

// bcrypt silently ignores everything after the first 72 *bytes*. A character limit is not enough:
// "é" is 2 bytes in UTF-8, so 72 of them are 144 bytes. Longer passwords are rejected instead.
export const MAX_PASSWORD_BYTES = 72;
export const passwordWithinBcryptLimit = (password: string) =>
  Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
const bcryptLimitMessage = `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .refine(passwordWithinBcryptLimit, bcryptLimitMessage),
});

export const loginSchema = z.object({
  email,
  // Same byte limit: otherwise a login with a correct 72-byte prefix plus extra bytes would match.
  password: z
    .string()
    .min(1, 'Password is required')
    .refine(passwordWithinBcryptLimit, bcryptLimitMessage),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
