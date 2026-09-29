import type { PaymentEventOutcome, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

const eventWithPaymentReference = {
  payment: { select: { providerPaymentId: true } },
} as const;

export const paymentRepository = {
  create(
    tx: Prisma.TransactionClient,
    data: {
      bookingId: string;
      amountPaise: number;
      status: PaymentStatus;
      providerPaymentId: string;
    },
  ) {
    return tx.payment.create({ data });
  },

  findByBookingId(tx: Prisma.TransactionClient, bookingId: string) {
    return tx.payment.findUnique({ where: { bookingId } });
  },

  findByProviderPaymentId(tx: Prisma.TransactionClient, providerPaymentId: string) {
    return tx.payment.findUnique({ where: { providerPaymentId } });
  },

  updateStatus(tx: Prisma.TransactionClient, id: string, status: PaymentStatus) {
    return tx.payment.update({ where: { id }, data: { status } });
  },
};

export const paymentEventRepository = {
  findByProviderEventId(db: Db, providerEventId: string) {
    return db.paymentEvent.findUnique({
      where: { providerEventId },
      include: eventWithPaymentReference,
    });
  },

  create(
    tx: Prisma.TransactionClient,
    data: {
      providerEventId: string;
      paymentId: string;
      status: PaymentStatus;
      outcome: PaymentEventOutcome;
      payload: Prisma.InputJsonObject;
    },
  ) {
    return tx.paymentEvent.create({ data, include: eventWithPaymentReference });
  },
};
