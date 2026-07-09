-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REGISTRATION_LINK_REGENERATED';

-- Enforce at most one ACTIVE registration link per property. The owner
-- create/replace endpoint relies on this for its 409 active_link_conflict path.
CREATE UNIQUE INDEX "registration_link_one_active_per_property" ON "RegistrationLink"("propertyId") WHERE "status" = 'ACTIVE';
