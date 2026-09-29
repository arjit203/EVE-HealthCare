-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_offering_id_fkey";

-- DropIndex
DROP INDEX "bookings_offering_id_idx";

-- DropIndex
DROP INDEX "bookings_user_id_idx";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "appointment_at",
DROP COLUMN "offering_id",
ADD COLUMN     "appointment_date_time" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "centre_id" UUID NOT NULL,
ADD COLUMN     "test_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_centre_id_test_id_idx" ON "bookings"("centre_id", "test_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_centre_id_test_id_fkey" FOREIGN KEY ("centre_id", "test_id") REFERENCES "centre_test_offerings"("centre_id", "test_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma's schema language cannot express partial indexes.
-- Blocks duplicate active bookings (e.g. a double-clicked "Book" button): the same user cannot hold
-- two PENDING/CONFIRMED bookings for the same test, centre and time. Cancelled or failed bookings
-- do not count, so the user can book that slot again afterwards.
CREATE UNIQUE INDEX "bookings_no_duplicate_active" ON "bookings"("user_id", "centre_id", "test_id", "appointment_date_time")
WHERE "status" IN ('PENDING', 'CONFIRMED');
