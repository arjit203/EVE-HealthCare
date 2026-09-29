import type { Request, Response } from 'express';
import { authService } from '../services/auth.service';

export const authController = {
  async signup(req: Request, res: Response) {
    const user = await authService.signup(req.body);
    res.status(201).json({ data: user });
  },

  async login(req: Request, res: Response) {
    const result = await authService.login(req.body);
    res.status(200).json({ data: result });
  },
};
