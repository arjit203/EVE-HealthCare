-- Hand-written, and deliberately FIRST: the old partial index "WHERE status = 'SUCCESS'" depends on
-- the PaymentStatus enum, so PostgreSQL cannot change the column's type while it exists. It is
-- replaced by the unique booking_id below (one payment per booking). Prisma does not know about
-- partial indexes, so this line is not generated.
DROP INDEX IF EXISTS "payments_one_success_per_booking";

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('SUCCESS', 'FAILED');
ALTER TABLE "public"."payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TABLE "webhook_events" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
COMMIT;

-- DropIndex
DROP INDEX "payments_booking_id_idx";

-- DropIndex
DROP INDEX "payments_provider_reference_key";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "provider_reference",
ADD COLUMN     "provider_payment_id" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_key" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");
