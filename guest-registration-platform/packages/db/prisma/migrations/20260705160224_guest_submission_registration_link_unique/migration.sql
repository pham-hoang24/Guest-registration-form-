/*
  Warnings:

  - You are about to drop the column `isPrimaryGuest` on the `Guest` table. All the data in the column will be lost.
  - You are about to drop the column `nationality` on the `Guest` table. All the data in the column will be lost.
  - You are about to drop the column `submissionId` on the `Guest` table. All the data in the column will be lost.
  - You are about to drop the column `guestEmail` on the `GuestSubmission` table. All the data in the column will be lost.
  - You are about to drop the column `guestPhone` on the `GuestSubmission` table. All the data in the column will be lost.
  - The `status` column on the `GuestSubmission` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `RegistrationLink` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[registrationLinkId]` on the table `GuestSubmission` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `guestType` to the `Guest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `isAdult` to the `Guest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passengerCardId` to the `Guest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `propertyId` to the `Guest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roleOnCard` to the `Guest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Guest` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RegistrationLinkStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GuestSubmissionStatus" AS ENUM ('OPEN', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PassengerCardStatus" AS ENUM ('SUBMITTED', 'PDF_READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PdfJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PASSENGER_CARD_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'GUEST_SIGNATURE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'PDF_JOB_CREATED';

-- DropForeignKey
ALTER TABLE "Guest" DROP CONSTRAINT "Guest_submissionId_fkey";

-- DropIndex
DROP INDEX "Guest_submissionId_idx";

-- DropIndex
DROP INDEX "GuestSubmission_deleteAfter_status_idx";

-- AlterTable
ALTER TABLE "Guest" DROP COLUMN "isPrimaryGuest",
DROP COLUMN "nationality",
DROP COLUMN "submissionId",
ADD COLUMN     "citizenship" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "finnishPersonalIdentityCodeEncrypted" TEXT,
ADD COLUMN     "guestType" TEXT NOT NULL,
ADD COLUMN     "isAdult" BOOLEAN NOT NULL,
ADD COLUMN     "isResidentInFinland" BOOLEAN,
ADD COLUMN     "passengerCardId" TEXT NOT NULL,
ADD COLUMN     "phoneE164" TEXT,
ADD COLUMN     "propertyId" TEXT NOT NULL,
ADD COLUMN     "roleOnCard" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "documentType" DROP NOT NULL,
ALTER COLUMN "documentNumberEncrypted" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GuestSubmission" DROP COLUMN "guestEmail",
DROP COLUMN "guestPhone",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "maxPassengerCards" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "primaryGuestEmail" TEXT,
ADD COLUMN     "primaryGuestName" TEXT,
ADD COLUMN     "primaryGuestPhoneE164" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "GuestSubmissionStatus" NOT NULL DEFAULT 'OPEN',
ALTER COLUMN "purposeOfStay" DROP NOT NULL,
ALTER COLUMN "retainUntil" DROP NOT NULL,
ALTER COLUMN "deleteAfter" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RegistrationLink" DROP COLUMN "status",
ADD COLUMN     "status" "RegistrationLinkStatus" NOT NULL DEFAULT 'ACTIVE';

-- DropEnum
DROP TYPE "LinkStatus";

-- DropEnum
DROP TYPE "SubmissionStatus";

-- CreateTable
CREATE TABLE "PassengerCard" (
    "id" TEXT NOT NULL,
    "guestSubmissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "cardNumber" INTEGER NOT NULL,
    "cardType" TEXT NOT NULL,
    "countryOfEntryToFinland" TEXT,
    "cardHolderName" TEXT,
    "cardHolderEmail" TEXT,
    "cardHolderPhoneE164" TEXT,
    "submissionFingerprint" TEXT NOT NULL,
    "status" "PassengerCardStatus" NOT NULL DEFAULT 'SUBMITTED',
    "requirementVersion" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassengerCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassengerCardSignature" (
    "id" TEXT NOT NULL,
    "passengerCardId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "signatureEncrypted" TEXT,
    "signatureSha256" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedIpHash" TEXT,
    "signedUserAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassengerCardSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfJob" (
    "id" TEXT NOT NULL,
    "passengerCardId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "PdfJobStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PassengerCard_tenantId_propertyId_idx" ON "PassengerCard"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "PassengerCard_guestSubmissionId_idx" ON "PassengerCard"("guestSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "PassengerCard_guestSubmissionId_submissionFingerprint_key" ON "PassengerCard"("guestSubmissionId", "submissionFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PassengerCardSignature_passengerCardId_key" ON "PassengerCardSignature"("passengerCardId");

-- CreateIndex
CREATE UNIQUE INDEX "PdfJob_passengerCardId_key" ON "PdfJob"("passengerCardId");

-- CreateIndex
CREATE INDEX "Guest_passengerCardId_idx" ON "Guest"("passengerCardId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSubmission_registrationLinkId_key" ON "GuestSubmission"("registrationLinkId");

-- CreateIndex
CREATE INDEX "GuestSubmission_deleteAfter_idx" ON "GuestSubmission"("deleteAfter");

-- CreateIndex
CREATE INDEX "GuestSubmission_deletedAt_idx" ON "GuestSubmission"("deletedAt");

-- AddForeignKey
ALTER TABLE "PassengerCard" ADD CONSTRAINT "PassengerCard_guestSubmissionId_fkey" FOREIGN KEY ("guestSubmissionId") REFERENCES "GuestSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_passengerCardId_fkey" FOREIGN KEY ("passengerCardId") REFERENCES "PassengerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassengerCardSignature" ADD CONSTRAINT "PassengerCardSignature_passengerCardId_fkey" FOREIGN KEY ("passengerCardId") REFERENCES "PassengerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfJob" ADD CONSTRAINT "PdfJob_passengerCardId_fkey" FOREIGN KEY ("passengerCardId") REFERENCES "PassengerCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
