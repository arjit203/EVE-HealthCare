import type { Request, Response } from 'express';
import { centreService } from '../services/centre.service';

// Route params are validated as UUIDs by the router before these handlers run.
type CentreParams = { centreId: string };
type OfferingParams = { centreId: string; testId: string };

export const centreController = {
  async create(req: Request, res: Response) {
    const centre = await centreService.create(req.body);
    res.status(201).json({ data: centre });
  },

  async list(_req: Request, res: Response) {
    const centres = await centreService.list();
    res.json({ data: centres });
  },

  async getById(req: Request<CentreParams>, res: Response) {
    const centre = await centreService.getById(req.params.centreId);
    res.json({ data: centre });
  },

  async addOffering(req: Request<CentreParams>, res: Response) {
    const offering = await centreService.addOffering(req.params.centreId, req.body);
    res.status(201).json({ data: offering });
  },

  async listOfferings(req: Request<CentreParams>, res: Response) {
    const offerings = await centreService.listOfferings(req.params.centreId);
    res.json({ data: offerings });
  },

  async updateOfferingPrice(req: Request<OfferingParams>, res: Response) {
    const { centreId, testId } = req.params;
    const offering = await centreService.updateOfferingPrice(centreId, testId, req.body);
    res.json({ data: offering });
  },
};
