import { canTransition, statusesThatCanBecome } from '../src/utils/bookingStatus';

describe('booking status transitions', () => {
  it.each([
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['CONFIRMED', 'PENDING'],
    ['CONFIRMED', 'FAILED'],
    ['FAILED', 'CONFIRMED'],
    ['FAILED', 'CANCELLED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'PENDING'],
    ['PENDING', 'PENDING'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('only PENDING and CONFIRMED bookings can be cancelled', () => {
    expect(statusesThatCanBecome('CANCELLED').sort()).toEqual(['CONFIRMED', 'PENDING']);
  });
});
