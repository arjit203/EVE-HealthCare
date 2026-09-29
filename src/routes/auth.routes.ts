import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { loginSchema, signupSchema } from '../validators/auth.validator';

export const authRouter = Router();

authRouter.post('/signup', validate({ body: signupSchema }), authController.signup);
authRouter.post('/login', validate({ body: loginSchema }), authController.login);
