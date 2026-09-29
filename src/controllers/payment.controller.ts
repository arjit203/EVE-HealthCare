import type { Request, Response } from 'express';
import { paymentService } from '../services/payment.service';

export const paymentController = {
  async create(req: Request, res: Response) {
    const payment = await paymentService.pay(req.user!.id, req.body);
    // 201 for both SUCCESS and FAILED: the request worked; the payment outcome is in the body.
    res.status(201).json({ data: payment });
  },
};
