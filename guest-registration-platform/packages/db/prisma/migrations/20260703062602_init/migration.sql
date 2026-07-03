-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OwnerRole" AS ENUM ('OWNER', 'MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('RECEIVED', 'PDF_READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "LegalBasis" AS ENUM ('LEGAL_OBLIGATION', 'CONTRACT', 'CONSENT');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('GUEST', 'OWNER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('GUEST_REGISTRATION_SUBMITTED', 'PDF_GENERATED', 'PDF_GENERATION_FAILED', 'OWNER_LOGIN_SUCCEEDED', 'OWNER_LOGIN_FAILED', 'OWNER_VIEWED_SUBMISSION', 'OWNER_DOWNLOADED_PDF', 'RETENTION_DELETED_SUBMISSION');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerUser" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "OwnerRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "registrationLinkId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "arrivalDate" DATE NOT NULL,
    "departureDate" DATE NOT NULL,
    "purposeOfStay" TEXT NOT NULL,
    "requirementVersion" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "legalBasis" "LegalBasis" NOT NULL DEFAULT 'LEGAL_OBLIGATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "nationality" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumberEncrypted" TEXT NOT NULL,
    "isPrimaryGuest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedPdf" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "encryptedDekBase64" TEXT NOT NULL,
    "ivBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "aadJson" TEXT NOT NULL,
    "kekKeyId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "sha256Ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncryptedPdf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerUser_email_key" ON "OwnerUser"("email");

-- CreateIndex
CREATE INDEX "OwnerUser_tenantId_idx" ON "OwnerUser"("tenantId");

-- CreateIndex
CREATE INDEX "Property_tenantId_idx" ON "Property"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationLink_tokenHash_key" ON "RegistrationLink"("tokenHash");

-- CreateIndex
CREATE INDEX "RegistrationLink_tenantId_propertyId_idx" ON "RegistrationLink"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "GuestSubmission_tenantId_propertyId_idx" ON "GuestSubmission"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "GuestSubmission_deleteAfter_status_idx" ON "GuestSubmission"("deleteAfter", "status");

-- CreateIndex
CREATE INDEX "Guest_submissionId_idx" ON "Guest"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedPdf_submissionId_key" ON "EncryptedPdf"("submissionId");

-- CreateIndex
CREATE INDEX "EncryptedPdf_tenantId_idx" ON "EncryptedPdf"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "OwnerUser" ADD CONSTRAINT "OwnerUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationLink" ADD CONSTRAINT "RegistrationLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationLink" ADD CONSTRAINT "RegistrationLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSubmission" ADD CONSTRAINT "GuestSubmission_registrationLinkId_fkey" FOREIGN KEY ("registrationLinkId") REFERENCES "RegistrationLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "GuestSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedPdf" ADD CONSTRAINT "EncryptedPdf_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "GuestSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedPdf" ADD CONSTRAINT "EncryptedPdf_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
