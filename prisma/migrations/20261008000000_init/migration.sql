-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "CMSPlatform" AS ENUM ('WORDPRESS', 'WEBFLOW', 'SHOPIFY', 'WEBHOOK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SearchIntent" AS ENUM ('INFORMATIONAL', 'COMMERCIAL', 'TRANSACTIONAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "QueueStatus" AS ENUM ('BACKLOG', 'SCHEDULED', 'RESEARCHING', 'WRITING', 'READY_FOR_REVIEW', 'PUBLISHED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AIEngine" AS ENUM ('CHATGPT', 'PERPLEXITY', 'GEMINI', 'CLAUDE', 'COPILOT', 'GROK', 'DEEPSEEK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NOT_MENTIONED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
    "companyName" TEXT,
    "phone" TEXT,
    "planTier" TEXT,
    "subscriptionStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "brands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "toneOfVoice" TEXT NOT NULL,
    "ctaTargetUrl" TEXT NOT NULL,
    "ctaText" TEXT,
    "forbiddenTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetLanguage" TEXT NOT NULL DEFAULT 'pt-BR',
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "publishingSchedule" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cms_integrations" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "CMSPlatform" NOT NULL,
    "siteUrl" TEXT,
    "encryptedCredentials" TEXT NOT NULL,
    "defaultPostStatus" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "topic_queues" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "primaryKeyword" TEXT NOT NULL,
    "searchIntent" "SearchIntent" NOT NULL DEFAULT 'INFORMATIONAL',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" "QueueStatus" NOT NULL DEFAULT 'BACKLOG',
    "scheduledFor" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "articles" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "topicQueueId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "schemaJsonLd" JSONB NOT NULL,
    "faqItems" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "cmsPlatform" "CMSPlatform",
    "remotePostId" TEXT,
    "publishedUrl" TEXT,
    "indexNowNotified" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "internal_link_indices" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_link_indices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "geo_monitor_runs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "queryPrompt" TEXT NOT NULL,
    "targetEngine" "AIEngine" NOT NULL,
    "isBrandMentioned" BOOLEAN NOT NULL DEFAULT false,
    "mentionRank" INTEGER,
    "sentiment" "Sentiment" NOT NULL DEFAULT 'NOT_MENTIONED',
    "citedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawAnswerText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_monitor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scan_reports" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "geoScore" INTEGER NOT NULL,
    "scanData" JSONB NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planTier" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "paymentMethod" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_configs" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT,
    "phoneNumberId" TEXT,
    "businessAccountId" TEXT,
    "verifyToken" TEXT NOT NULL DEFAULT 'geopulse_meta_verify_secret_2026',
    "templateName" TEXT DEFAULT 'dossie_executivo_geo',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "formattedTo" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEMPLATE',
    "templateName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "metaMessageId" TEXT,
    "clientName" TEXT,
    "companyName" TEXT,
    "reportSlug" TEXT,
    "dossierUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_organizationId_idx" ON "users"("organizationId");
CREATE INDEX IF NOT EXISTS "brands_organizationId_idx" ON "brands"("organizationId");
CREATE INDEX IF NOT EXISTS "cms_integrations_brandId_idx" ON "cms_integrations"("brandId");
CREATE INDEX IF NOT EXISTS "topic_queues_brandId_status_idx" ON "topic_queues"("brandId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "articles_topicQueueId_key" ON "articles"("topicQueueId");
CREATE INDEX IF NOT EXISTS "articles_brandId_status_idx" ON "articles"("brandId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "articles_brandId_slug_key" ON "articles"("brandId", "slug");
CREATE INDEX IF NOT EXISTS "internal_link_indices_brandId_idx" ON "internal_link_indices"("brandId");
CREATE INDEX IF NOT EXISTS "geo_monitor_runs_brandId_targetEngine_createdAt_idx" ON "geo_monitor_runs"("brandId", "targetEngine", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "scan_reports_slug_key" ON "scan_reports"("slug");
CREATE INDEX IF NOT EXISTS "scan_reports_domain_idx" ON "scan_reports"("domain");
CREATE INDEX IF NOT EXISTS "scan_reports_slug_idx" ON "scan_reports"("slug");
CREATE INDEX IF NOT EXISTS "subscriptions_userId_idx" ON "subscriptions"("userId");
CREATE INDEX IF NOT EXISTS "subscriptions_organizationId_idx" ON "subscriptions"("organizationId");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_to_idx" ON "whatsapp_messages"("to");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_metaMessageId_idx" ON "whatsapp_messages"("metaMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_idx" ON "whatsapp_messages"("status");
