import type { Request, Response } from 'express';
import { diagnosticTestService } from '../services/diagnosticTest.service';

export const diagnosticTestController = {
  async create(req: Request, res: Response) {
    const test = await diagnosticTestService.create(req.body);
    res.status(201).json({ data: test });
  },

  async list(_req: Request, res: Response) {
    const tests = await diagnosticTestService.list();
    res.json({ data: tests });
  },
};
