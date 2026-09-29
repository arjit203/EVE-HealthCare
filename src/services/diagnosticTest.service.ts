import { diagnosticTestRepository } from '../repositories/diagnosticTest.repository';
import { AppError } from '../utils/AppError';
import { isUniqueViolation } from '../utils/prismaErrors';
import type { CreateDiagnosticTestInput } from '../validators/diagnosticTest.validator';

export const diagnosticTestService = {
  async create(input: CreateDiagnosticTestInput) {
    try {
      return await diagnosticTestRepository.create(input);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('A diagnostic test with this name already exists');
      }
      throw err;
    }
  },

  list() {
    return diagnosticTestRepository.findAll();
  },
};
