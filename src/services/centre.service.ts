import { centreRepository } from '../repositories/centre.repository';
import { diagnosticTestRepository } from '../repositories/diagnosticTest.repository';
import { offeringRepository } from '../repositories/offering.repository';
import { AppError } from '../utils/AppError';
import { isUniqueViolation } from '../utils/prismaErrors';
import type {
  CreateCentreInput,
  CreateOfferingInput,
  UpdateOfferingInput,
} from '../validators/centre.validator';

const getCentreOrThrow = async (centreId: string) => {
  const centre = await centreRepository.findById(centreId);
  if (!centre) throw AppError.notFound('Diagnostic centre');
  return centre;
};

export const centreService = {
  async create(input: CreateCentreInput) {
    try {
      return await centreRepository.create(input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('A centre with this name already exists at this location');
      }
      throw err;
    }
  },

  list() {
    return centreRepository.findAll();
  },

  getById(centreId: string) {
    return getCentreOrThrow(centreId);
  },

  /** Starts offering a test at a centre, at that centre's own price. */
  async addOffering(centreId: string, input: CreateOfferingInput) {
    await getCentreOrThrow(centreId);
    const test = await diagnosticTestRepository.findById(input.testId);
    if (!test) throw AppError.notFound('Diagnostic test');

    try {
      return await offeringRepository.create({ centreId, ...input });
    } catch (err) {
      // Unique (centre_id, test_id): the centre already offers this test.
      if (isUniqueViolation(err)) {
        throw AppError.conflict('This centre already offers this test; update its price instead');
      }
      throw err;
    }
  },

  async listOfferings(centreId: string) {
    // 404 for an unknown centre, rather than an empty list that looks like "no tests".
    await getCentreOrThrow(centreId);
    return offeringRepository.findByCentre(centreId);
  },

  /**
   * Changes the price for future bookings only: each booking stores its own amount,
   * so existing bookings keep the price that was charged when they were made.
   */
  async updateOfferingPrice(centreId: string, testId: string, input: UpdateOfferingInput) {
    const offering = await offeringRepository.findByCentreAndTest(centreId, testId);
    if (!offering) throw AppError.notFound('Test offering at this centre');

    return offeringRepository.updatePrice(offering.id, input.pricePaise);
  },
};
