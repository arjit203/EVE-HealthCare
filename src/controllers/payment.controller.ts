import type { Request, Response } from 'express';
import { paymentService } from '../services/payment.service';
import { webhookService } from '../services/webhook.service';

export const paymentController = {
  async create(req: Request, res: Response) {
    const payment = await paymentService.pay(req.user!.id, req.body);
    // 202: accepted, outcome will arrive via the webhook. 201: settled now (SUCCESS *or* FAILED —
    // a failed payment is still a successfully processed request).
    res.status(payment.status === 'PENDING' ? 202 : 201).json({ data: payment });
  },

  async webhook(req: Request, res: Response) {
    const result = await webhookService.handle(req.body);
    // Always 200 once the event is understood (applied, duplicate or conflict). An error status
    // would make the provider retry an event that will never apply differently.
    res.status(200).json({ data: result });
  },
};
