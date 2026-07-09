-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "documentNumberNotApplicableReason" TEXT,
ALTER COLUMN "dateOfBirth" DROP NOT NULL;
