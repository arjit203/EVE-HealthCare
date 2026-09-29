-- CreateEnum
CREATE TYPE "PaymentEventOutcome" AS ENUM ('APPLIED', 'DUPLICATE_STATE', 'IGNORED_CONFLICT');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';

-- DropForeignKey
ALTER TABLE "webhook_events" DROP CONSTRAINT "webhook_events_payment_id_fkey";

-- DropTable
DROP TABLE "webhook_events";

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "outcome" "PaymentEventOutcome" NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a webhook event reports a final outcome, never PENDING. Written as IN (...) rather
-- than <> 'PENDING' because PostgreSQL does not allow using an enum value that was added earlier in
-- the same transaction.
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_status_final" CHECK ("status" IN ('SUCCESS', 'FAILED'));
