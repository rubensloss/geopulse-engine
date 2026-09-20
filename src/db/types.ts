import type { CMSPlatform } from '../publishers/types.js';

export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type { CMSPlatform };
export type PostStatus = 'DRAFT' | 'PUBLISHED';
export type SearchIntent = 'INFORMATIONAL' | 'COMMERCIAL' | 'TRANSACTIONAL';
export type PlanTier = 'FREE_TRIAL' | 'STARTER' | 'PRO' | 'EXCELLENCE_CYCLE';
export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'PENDING' | 'CANCELLED';

export interface StoredUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  passwordHash: string;
  companyName: string;
  phone?: string;
  role: UserRole;
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredSubscription {
  id: string;
  userId: string;
  organizationId: string;
  planTier: PlanTier;
  planName: string;
  status: SubscriptionStatus;
  amount: number;
  currency: string;
  billingCycle: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
  paymentMethod: 'PIX' | 'CREDIT_CARD';
  paymentId?: string;
  pixQrCode?: string;
  pixCopiaECola?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EcosystemPillarsStatus {
  organizationId: string;
  googleMyBusiness: {
    name: string;
    status: 'ACTIVE' | 'PENDING' | 'ACTION_REQUIRED';
    rating?: number;
    reviewsCount?: number;
    details: string;
    actionLabel: string;
  };
  modernWebsite: {
    name: string;
    status: 'ACTIVE' | 'UPGRADE_RECOMMENDED';
    speedScore?: number;
    details: string;
    actionLabel: string;
  };
  aiAgent: {
    name: string;
    status: 'ACTIVE' | 'STANDBY' | 'NOT_CONFIGURED';
    conversationsHandled?: number;
    details: string;
    actionLabel: string;
  };
  crm: {
    name: string;
    status: 'ACTIVE' | 'READY_TO_SYNC';
    activeDealsCount?: number;
    details: string;
    actionLabel: string;
  };
  geoEngine: {
    name: string;
    status: 'DOMINATING' | 'ACTIVE' | 'SCANNING';
    shareOfModel?: string;
    details: string;
    actionLabel: string;
  };
}

export type QueueStatus = 
  | 'BACKLOG' 
  | 'SCHEDULED' 
  | 'RESEARCHING' 
  | 'WRITING' 
  | 'READY_FOR_REVIEW' 
  | 'PUBLISHED' 
  | 'FAILED';

export type AIEngine = 
  | 'CHATGPT' 
  | 'PERPLEXITY' 
  | 'GEMINI' 
  | 'CLAUDE' 
  | 'COPILOT' 
  | 'GROK' 
  | 'DEEPSEEK';

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'NOT_MENTIONED';

export interface CreateBrandDto {
  organizationId: string;
  name: string;
  websiteUrl: string;
  productDescription: string;
  targetAudience: string;
  toneOfVoice: string;
  ctaTargetUrl: string;
  ctaText?: string;
  forbiddenTerms?: string[];
  targetLanguage?: string;
  autoPublish?: boolean;
  publishingSchedule?: string;
  isActive?: boolean;
}

export interface SaveCMSIntegrationDto {
  brandId: string;
  platform: CMSPlatform;
  siteUrl?: string;
  credentials: Record<string, any>; // Credenciais brutas (serão criptografadas antes de salvar)
  defaultPostStatus?: PostStatus;
}

export interface CreateTopicDto {
  brandId: string;
  topic: string;
  primaryKeyword: string;
  searchIntent?: SearchIntent;
  priority?: number;
  scheduledFor?: Date;
}

export interface SaveArticleDto {
  brandId: string;
  topicQueueId?: string;
  title: string;
  slug: string;
  metaDescription: string;
  contentMarkdown: string;
  contentHtml: string;
  schemaJsonLd: object;
  faqItems: Array<{ question: string; answer: string }>;
  metrics: {
    totalWords: number;
    readingTimeMinutes: number;
    tableCount: number;
    directAnswerSnippetsCount: number;
  };
  status: PostStatus;
  cmsPlatform?: CMSPlatform;
  remotePostId?: string;
  publishedUrl?: string;
  indexNowNotified?: boolean;
  coverImageUrl?: string;
  coverImagePrompt?: string;
  coverImageAlt?: string;
  coverImageEngine?: string;
}

export interface RecordGEOMonitorDto {
  brandId: string;
  queryPrompt: string;
  targetEngine: AIEngine;
  isBrandMentioned: boolean;
  mentionRank?: number;
  sentiment: Sentiment;
  citedUrls?: string[];
  rawAnswerText: string;
}

export interface StoredScanReport {
  id: string;
  slug: string;
  domain: string;
  brandName: string;
  niche: string;
  scanData: any;
  createdAt: Date;
  viewCount: number;
}

export interface WhatsAppCloudConfig {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  verifyToken: string;
  templateName?: string;
  isEnabled: boolean;
  testMode?: boolean;
}

export interface StoredWhatsAppMessage {
  id: string;
  to: string;
  formattedTo: string;
  type: 'TEMPLATE' | 'TEXT';
  templateName?: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SIMULATED';
  metaMessageId?: string;
  clientName?: string;
  companyName?: string;
  reportSlug?: string;
  dossierUrl?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

