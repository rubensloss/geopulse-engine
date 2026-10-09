-- CreateTable
CREATE TABLE IF NOT EXISTS "public_audit_logs" (
    "id" TEXT NOT NULL,
    "clientIp" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "public_audit_logs_clientIp_createdAt_idx" ON "public_audit_logs"("clientIp", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "public_audit_logs_createdAt_idx" ON "public_audit_logs"("createdAt");
