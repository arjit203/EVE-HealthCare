-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_centre_id_test_id_fkey";

-- DropForeignKey
ALTER TABLE "centre_tests" DROP CONSTRAINT "centre_tests_centre_id_fkey";

-- DropForeignKey
ALTER TABLE "centre_tests" DROP CONSTRAINT "centre_tests_test_id_fkey";

-- DropIndex
DROP INDEX "bookings_centre_id_test_id_idx";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "amount_minor",
DROP COLUMN "centre_id",
DROP COLUMN "test_id",
ADD COLUMN     "amount_paise" INTEGER NOT NULL,
ADD COLUMN     "offering_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "amount_minor",
ADD COLUMN     "amount_paise" INTEGER NOT NULL;

-- DropTable
DROP TABLE "centre_tests";

-- CreateTable
CREATE TABLE "centre_test_offerings" (
    "id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "centre_test_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "centre_test_offerings_test_id_idx" ON "centre_test_offerings"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "centre_test_offerings_centre_id_test_id_key" ON "centre_test_offerings"("centre_id", "test_id");

-- CreateIndex
CREATE INDEX "bookings_offering_id_idx" ON "bookings"("offering_id");

-- AddForeignKey
ALTER TABLE "centre_test_offerings" ADD CONSTRAINT "centre_test_offerings_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "diagnostic_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centre_test_offerings" ADD CONSTRAINT "centre_test_offerings_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "diagnostic_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "centre_test_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints that Prisma's schema language cannot express.
-- (The old *_minor_positive checks were dropped together with their columns above.)

-- Money must always be positive.
ALTER TABLE "centre_test_offerings" ADD CONSTRAINT "centre_test_offerings_price_paise_positive" CHECK ("price_paise" > 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amount_paise_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_paise_positive" CHECK ("amount_paise" > 0);
