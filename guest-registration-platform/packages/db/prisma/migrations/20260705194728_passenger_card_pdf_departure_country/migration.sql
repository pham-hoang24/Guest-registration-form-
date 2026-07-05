-- DropForeignKey
ALTER TABLE "EncryptedPdf" DROP CONSTRAINT "EncryptedPdf_submissionId_fkey";

-- DropIndex
DROP INDEX "EncryptedPdf_submissionId_key";

-- AlterTable
ALTER TABLE "EncryptedPdf" DROP COLUMN "submissionId",
ADD COLUMN     "batchId" TEXT NOT NULL,
ADD COLUMN     "passengerCardId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "GuestSubmission" ADD COLUMN     "departureDateKnown" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "departureDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PassengerCard" ADD COLUMN     "countryOfEntryNotApplicableReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedPdf_passengerCardId_key" ON "EncryptedPdf"("passengerCardId");

-- CreateIndex
CREATE INDEX "EncryptedPdf_batchId_idx" ON "EncryptedPdf"("batchId");

-- AddForeignKey
ALTER TABLE "EncryptedPdf" ADD CONSTRAINT "EncryptedPdf_passengerCardId_fkey" FOREIGN KEY ("passengerCardId") REFERENCES "PassengerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

