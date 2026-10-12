-- AlterTable
ALTER TABLE "User" DROP COLUMN "totpEnabled",
DROP COLUMN "totpLastCounter",
DROP COLUMN "totpSecretEnc",
ADD COLUMN     "discordLinkedAt" TIMESTAMP(3),
ADD COLUMN     "discordUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_discordUserId_key" ON "User"("discordUserId");
