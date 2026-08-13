-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "importId" TEXT;

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "importedById" TEXT,
    "format" TEXT NOT NULL,
    "filename" TEXT,
    "fileHash" TEXT NOT NULL,
    "bank" TEXT,
    "periodStart" TEXT,
    "periodEnd" TEXT,
    "linesParsed" INTEGER NOT NULL DEFAULT 0,
    "linesImported" INTEGER NOT NULL DEFAULT 0,
    "linesSkipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementImport_organizationId_createdAt_idx" ON "StatementImport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StatementImport_organizationId_fileHash_idx" ON "StatementImport"("organizationId", "fileHash");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

