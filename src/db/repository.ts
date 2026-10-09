import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from './prisma.js';
import {
  CreateBrandDto,
  CreateTopicDto,
  QueueStatus,
  RecordGEOMonitorDto,
  SaveArticleDto,
  SaveCMSIntegrationDto,
  StoredUser,
  StoredSubscription,
  EcosystemPillarsStatus,
  PlanTier,
  SubscriptionStatus,
  UserRole,
  StoredScanReport,
  WhatsAppCloudConfig,
  StoredWhatsAppMessage,
} from './types.js';
import { decryptJsonCredential, encryptJsonCredential } from '../security/encryption.js';

export interface StoredPublicAuditLog {
  id: string;
  clientIp: string;
  domain: string;
  createdAt: Date;
}

export interface StoredOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface StoredBrand extends CreateBrandDto {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredCMSIntegration {
  id: string;
  brandId: string;
  platform: SaveCMSIntegrationDto['platform'];
  siteUrl?: string;
  encryptedCredentials: string; // Payload AES-256-GCM
  defaultPostStatus: 'DRAFT' | 'PUBLISHED';
  createdAt: Date;
}

export interface StoredTopicQueue extends CreateTopicDto {
  id: string;
  status: QueueStatus;
  createdAt: Date;
  updatedAt: Date;
  errorMessage?: string;
}

export interface StoredArticle extends SaveArticleDto {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}

export interface StoredInternalLink {
  id: string;
  brandId: string;
  articleId: string;
  title: string;
  url: string;
  keywords: string[];
}

export interface StoredGEOMonitor extends RecordGEOMonitorDto {
  id: string;
  createdAt: Date;
}

/**
 * Repositório Enterprise de Dados para o Motor GEO e Ecossistema Ciclo de Excelência.
 * Suporta isolamento multi-tenant por Organization, User e Brand,
 * com persistência relacional direta via Prisma PostgreSQL e criptografia AES-256-GCM.
 */
export class EnterpriseRepository {
  private storageFile = path.resolve(process.cwd(), 'data', 'db.json');
  private persistTimer: NodeJS.Timeout | null = null;

  private organizations: Map<string, StoredOrganization> = new Map();
  private users: Map<string, StoredUser> = new Map();
  private subscriptions: Map<string, StoredSubscription> = new Map();
  private brands: Map<string, StoredBrand> = new Map();
  private cmsIntegrations: Map<string, StoredCMSIntegration> = new Map();
  private topicQueues: Map<string, StoredTopicQueue> = new Map();
  private articles: Map<string, StoredArticle> = new Map();
  private internalLinks: Map<string, StoredInternalLink> = new Map();
  private geoMonitors: StoredGEOMonitor[] = [];
  private scans: Map<string, StoredScanReport> = new Map();
  private whatsappConfig: WhatsAppCloudConfig = {
    verifyToken: process.env.META_WA_VERIFY_TOKEN || 'geopulse-dev-verify-token-local',
    accessToken: process.env.META_WA_TOKEN || '',
    phoneNumberId: process.env.META_WA_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.META_WA_BUSINESS_ACCOUNT_ID || '',
    templateName: 'dossie_executivo_geo',
    isEnabled: true,
    testMode: !process.env.META_WA_TOKEN,
  };
  private whatsappMessages: Map<string, StoredWhatsAppMessage> = new Map();
  private publicAuditLogs: StoredPublicAuditLog[] = [];

  constructor() {
    if (process.env.NODE_ENV !== 'production') {
      this.loadFromDisk();
    }
    this.hydrateFromPrisma().catch((err) => {
      console.warn('ℹ️ [DB] Inicialização de hidratação Prisma completada com aviso:', err?.message);
    });
  }

  /**
   * Hidrata os repositórios em memória a partir do banco relacional PostgreSQL (Prisma)
   * garantindo sincronização e persistência duradoura.
   */
  private async hydrateFromPrisma(): Promise<void> {
    try {
      const [dbScans, dbUsers, dbOrgs, dbBrands, dbSubs, dbWaConfig, dbWaMessages, dbAuditLogs] = await Promise.all([
        prisma.scanReport.findMany({ take: 100, orderBy: { createdAt: 'desc' } }).catch(() => []),
        prisma.user.findMany().catch(() => []),
        prisma.organization.findMany().catch(() => []),
        prisma.brand.findMany().catch(() => []),
        prisma.subscription.findMany().catch(() => []),
        prisma.whatsAppConfig.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null),
        prisma.whatsAppMessage.findMany({ take: 50, orderBy: { createdAt: 'desc' } }).catch(() => []),
        prisma.publicAuditLog.findMany({ take: 500, orderBy: { createdAt: 'desc' } }).catch(() => []),
      ]);

      for (const s of dbScans) {
        const stored: StoredScanReport = {
          id: s.id,
          slug: s.slug,
          domain: s.domain,
          brandName: s.brandName,
          niche: s.niche,
          scanData: s.scanData,
          createdAt: s.createdAt,
          viewCount: s.viewCount,
        };
        this.scans.set(stored.id, stored);
        this.scans.set(stored.slug, stored);
      }

      for (const u of dbUsers) {
        this.users.set(u.id, {
          id: u.id,
          organizationId: u.organizationId,
          name: u.name,
          email: u.email,
          passwordHash: u.passwordHash || '',
          companyName: u.companyName || '',
          phone: u.phone || undefined,
          role: (u.role as any) || 'EDITOR',
          planTier: (u.planTier as any) || 'STARTER',
          subscriptionStatus: (u.subscriptionStatus as any) || 'ACTIVE',
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        });
      }

      for (const o of dbOrgs) {
        this.organizations.set(o.id, {
          id: o.id,
          name: o.name,
          slug: o.slug,
          createdAt: o.createdAt,
        });
      }

      for (const b of dbBrands) {
        this.brands.set(b.id, {
          id: b.id,
          organizationId: b.organizationId,
          name: b.name,
          websiteUrl: b.websiteUrl,
          productDescription: b.productDescription || '',
          targetAudience: b.targetAudience || '',
          toneOfVoice: b.toneOfVoice || '',
          ctaTargetUrl: b.ctaTargetUrl || '',
          ctaText: b.ctaText || '',
          autoPublish: b.autoPublish,
          isActive: b.isActive,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        });
      }

      for (const sub of dbSubs) {
        this.subscriptions.set(sub.id, {
          id: sub.id,
          userId: sub.userId,
          organizationId: sub.organizationId,
          planTier: (sub.planTier as any) || 'STARTER',
          planName: sub.planName,
          status: (sub.status as any) || 'ACTIVE',
          amount: sub.amount,
          currency: sub.currency,
          billingCycle: (sub.billingCycle as any) || 'MONTHLY',
          paymentMethod: (sub.paymentMethod as any) || 'PIX',
          paymentId: sub.paymentId || undefined,
          createdAt: sub.createdAt,
          updatedAt: sub.updatedAt,
        });
      }

      if (dbWaConfig) {
        this.whatsappConfig = {
          accessToken: dbWaConfig.accessToken || '',
          phoneNumberId: dbWaConfig.phoneNumberId || '',
          businessAccountId: dbWaConfig.businessAccountId || '',
          verifyToken: dbWaConfig.verifyToken,
          templateName: dbWaConfig.templateName || 'dossie_executivo_geo',
          isEnabled: dbWaConfig.isEnabled,
          testMode: dbWaConfig.testMode,
        };
      }

      for (const msg of dbWaMessages) {
        const stored: StoredWhatsAppMessage = {
          id: msg.id,
          to: msg.to,
          formattedTo: msg.formattedTo,
          type: msg.type as any,
          templateName: msg.templateName || undefined,
          status: msg.status as any,
          metaMessageId: msg.metaMessageId || undefined,
          clientName: msg.clientName || undefined,
          companyName: msg.companyName || undefined,
          reportSlug: msg.reportSlug || undefined,
          dossierUrl: msg.dossierUrl || undefined,
          errorMessage: msg.errorMessage || undefined,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
        };
        this.whatsappMessages.set(stored.id, stored);
        if (stored.metaMessageId) {
          this.whatsappMessages.set(stored.metaMessageId, stored);
        }
      }

      for (const log of dbAuditLogs) {
        this.publicAuditLogs.push({
          id: log.id,
          clientIp: log.clientIp,
          domain: log.domain,
          createdAt: log.createdAt,
        });
      }

      console.log('✅ [DB] Prisma PostgreSQL sincronizado com sucesso.');
    } catch (err: any) {
      console.warn('ℹ️ [DB] Hidratação Prisma concluída com aviso:', err?.message);
    }
  }

  // ---------------------------------------------------------------------------
  // PERSISTÊNCIA EM DISCO LOCAL (DESENVOLVIMENTO APENAS)
  // ---------------------------------------------------------------------------
  private loadFromDisk(): void {
    if (process.env.NODE_ENV === 'production') return;

    try {
      if (!fs.existsSync(this.storageFile)) return;
      const raw = fs.readFileSync(this.storageFile, 'utf-8');
      if (!raw || !raw.trim()) return;
      const data = JSON.parse(raw);

      if (data.organizations) {
        this.organizations = new Map(data.organizations.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt) }]));
      }
      if (data.users) {
        this.users = new Map(data.users.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }]));
      }
      if (data.subscriptions) {
        this.subscriptions = new Map(data.subscriptions.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }]));
      }
      if (data.brands) {
        this.brands = new Map(data.brands.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }]));
      }
      if (data.cmsIntegrations) {
        this.cmsIntegrations = new Map(data.cmsIntegrations.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt) }]));
      }
      if (data.topicQueues) {
        this.topicQueues = new Map(data.topicQueues.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }]));
      }
      if (data.articles) {
        this.articles = new Map(data.articles.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt), publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined }]));
      }
      if (data.geoMonitors) {
        this.geoMonitors = data.geoMonitors.map((item: any) => ({ ...item, createdAt: new Date(item.createdAt) }));
      }
      if (data.scans) {
        this.scans = new Map(data.scans.map((item: any) => [item.id, { ...item, createdAt: new Date(item.createdAt) }]));
        for (const scan of Array.from(this.scans.values())) {
          if (scan.slug) this.scans.set(scan.slug, scan);
        }
      }
      if (data.whatsappConfig) {
        this.whatsappConfig = { ...this.whatsappConfig, ...data.whatsappConfig };
      }
      if (data.whatsappMessages) {
        this.whatsappMessages = new Map(data.whatsappMessages.map((item: any) => [
          item.id,
          { ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }
        ]));
      }
      if (data.publicAuditLogs && Array.isArray(data.publicAuditLogs)) {
        this.publicAuditLogs = data.publicAuditLogs.map((item: any) => ({
          ...item,
          createdAt: new Date(item.createdAt),
        }));
      }
    } catch {
      // Ignora erro em dev
    }
  }

  private persist(): void {
    if (process.env.NODE_ENV === 'production') return;

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.storageFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const snapshot = {
          organizations: Array.from(this.organizations.values()),
          users: Array.from(this.users.values()),
          subscriptions: Array.from(this.subscriptions.values()),
          brands: Array.from(this.brands.values()),
          cmsIntegrations: Array.from(this.cmsIntegrations.values()),
          topicQueues: Array.from(this.topicQueues.values()),
          articles: Array.from(this.articles.values()),
          geoMonitors: this.geoMonitors,
          scans: Array.from(new Set(this.scans.values())),
          whatsappConfig: this.whatsappConfig,
          whatsappMessages: Array.from(this.whatsappMessages.values()),
          publicAuditLogs: this.publicAuditLogs,
        };
        fs.writeFileSync(this.storageFile, JSON.stringify(snapshot, null, 2), 'utf-8');
      } catch (err) {
        console.error('❌ [DB] Erro ao persistir dados locais:', err);
      }
    }, 150);
  }

  // ---------------------------------------------------------------------------
  // ORGANIZAÇÕES (Tenants)
  // ---------------------------------------------------------------------------
  async createOrganization(name: string, slug: string): Promise<StoredOrganization> {
    const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let finalSlug = slug;
    try {
      let counter = 1;
      while (await prisma.organization.findUnique({ where: { slug: finalSlug } })) {
        counter++;
        finalSlug = `${slug}-${counter}`;
      }
      const record = await prisma.organization.create({
        data: { id: orgId, name, slug: finalSlug },
      });
      const org: StoredOrganization = {
        id: record.id,
        name: record.name,
        slug: record.slug,
        createdAt: record.createdAt,
      };
      this.organizations.set(org.id, org);
      this.persist();
      return org;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar organização no PostgreSQL: ${err?.message}`);
      }
      let memSlug = slug;
      let counter = 1;
      const existingSlugs = new Set(Array.from(this.organizations.values()).map(o => o.slug));
      while (existingSlugs.has(memSlug)) {
        counter++;
        memSlug = `${slug}-${counter}`;
      }
      const org: StoredOrganization = { id: orgId, name, slug: memSlug, createdAt: new Date() };
      this.organizations.set(org.id, org);
      this.persist();
      return org;
    }
  }

  async getOrganization(id: string): Promise<StoredOrganization | undefined> {
    try {
      const record = await prisma.organization.findUnique({ where: { id } });
      if (record) {
        return { id: record.id, name: record.name, slug: record.slug, createdAt: record.createdAt };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar organização: ${err?.message}`);
      }
    }
    return this.organizations.get(id);
  }

  async listOrganizations(): Promise<StoredOrganization[]> {
    try {
      const records = await prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
      return records.map(r => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.createdAt }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar organizações: ${err?.message}`);
      }
      return Array.from(this.organizations.values());
    }
  }

  // ---------------------------------------------------------------------------
  // USUÁRIOS (Authentication & Access Control)
  // ---------------------------------------------------------------------------
  async createUser(dto: Omit<StoredUser, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoredUser> {
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.user.upsert({
        where: { email: dto.email.toLowerCase().trim() },
        update: {
          name: dto.name,
          organizationId: dto.organizationId,
          role: (dto.role as any) || 'EDITOR',
          companyName: dto.companyName,
          phone: dto.phone,
          planTier: dto.planTier,
          subscriptionStatus: dto.subscriptionStatus,
        },
        create: {
          id: userId,
          organizationId: dto.organizationId,
          email: dto.email.toLowerCase().trim(),
          name: dto.name,
          passwordHash: dto.passwordHash,
          role: (dto.role as any) || 'EDITOR',
          companyName: dto.companyName,
          phone: dto.phone,
          planTier: dto.planTier,
          subscriptionStatus: dto.subscriptionStatus,
        },
      });
      const user: StoredUser = {
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        email: record.email,
        passwordHash: record.passwordHash || '',
        companyName: record.companyName || '',
        phone: record.phone || undefined,
        role: record.role as any,
        planTier: (record.planTier as any) || 'FREE_TRIAL',
        subscriptionStatus: (record.subscriptionStatus as any) || 'TRIAL',
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.users.set(user.id, user);
      this.persist();
      return user;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar usuário no PostgreSQL: ${err?.message}`);
      }
      const user: StoredUser = {
        ...dto,
        id: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.set(user.id, user);
      this.persist();
      return user;
    }
  }

  async getUserByEmail(email: string): Promise<StoredUser | undefined> {
    const normalized = email.toLowerCase().trim();
    try {
      const record = await prisma.user.findUnique({ where: { email: normalized } });
      if (record) {
        const user: StoredUser = {
          id: record.id,
          organizationId: record.organizationId,
          name: record.name,
          email: record.email,
          passwordHash: record.passwordHash || '',
          companyName: record.companyName || '',
          phone: record.phone || undefined,
          role: record.role as any,
          planTier: (record.planTier as any) || 'FREE_TRIAL',
          subscriptionStatus: (record.subscriptionStatus as any) || 'TRIAL',
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
        this.users.set(user.id, user);
        return user;
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar usuário no PostgreSQL: ${err?.message}`);
      }
    }
    for (const u of this.users.values()) {
      if (u.email.toLowerCase().trim() === normalized) return u;
    }
    return undefined;
  }

  async getUserById(id: string): Promise<StoredUser | undefined> {
    try {
      const record = await prisma.user.findUnique({ where: { id } });
      if (record) {
        const user: StoredUser = {
          id: record.id,
          organizationId: record.organizationId,
          name: record.name,
          email: record.email,
          passwordHash: record.passwordHash || '',
          companyName: record.companyName || '',
          phone: record.phone || undefined,
          role: record.role as any,
          planTier: (record.planTier as any) || 'FREE_TRIAL',
          subscriptionStatus: (record.subscriptionStatus as any) || 'TRIAL',
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
        this.users.set(user.id, user);
        return user;
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar usuário no PostgreSQL: ${err?.message}`);
      }
    }
    return this.users.get(id);
  }

  async updateUser(id: string, updates: Partial<StoredUser>): Promise<StoredUser | undefined> {
    try {
      const dataToUpdate: any = {
        name: updates.name,
        companyName: updates.companyName,
        phone: updates.phone,
        planTier: updates.planTier,
        subscriptionStatus: updates.subscriptionStatus,
      };
      if (updates.role !== undefined) dataToUpdate.role = updates.role;
      if (updates.passwordHash !== undefined) dataToUpdate.passwordHash = updates.passwordHash;

      const record = await prisma.user.update({
        where: { id },
        data: dataToUpdate,
      });
      const user: StoredUser = {
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        email: record.email,
        passwordHash: record.passwordHash || '',
        companyName: record.companyName || '',
        phone: record.phone || undefined,
        role: record.role as any,
        planTier: (record.planTier as any) || 'FREE_TRIAL',
        subscriptionStatus: (record.subscriptionStatus as any) || 'TRIAL',
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.users.set(user.id, user);
      this.persist();
      return user;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao atualizar usuário no PostgreSQL: ${err?.message}`);
      }
      const existing = this.users.get(id);
      if (!existing) return undefined;
      const updated: StoredUser = { ...existing, ...updates, updatedAt: new Date() };
      this.users.set(id, updated);
      this.persist();
      return updated;
    }
  }

  async listUsers(): Promise<StoredUser[]> {
    try {
      const records = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
      return records.map(record => ({
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        email: record.email,
        passwordHash: record.passwordHash || '',
        companyName: record.companyName || '',
        phone: record.phone || undefined,
        role: record.role as any,
        planTier: (record.planTier as any) || 'FREE_TRIAL',
        subscriptionStatus: (record.subscriptionStatus as any) || 'TRIAL',
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar usuários no PostgreSQL: ${err?.message}`);
      }
      return Array.from(this.users.values());
    }
  }

  // ---------------------------------------------------------------------------
  // ASSINATURAS & CHECKOUT (Billing & Plans)
  // ---------------------------------------------------------------------------
  async createSubscription(dto: Omit<StoredSubscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoredSubscription> {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.subscription.create({
        data: {
          id: subId,
          userId: dto.userId,
          organizationId: dto.organizationId,
          planTier: dto.planTier,
          planName: dto.planName,
          status: dto.status,
          amount: dto.amount,
          currency: dto.currency || 'BRL',
          billingCycle: dto.billingCycle,
          paymentMethod: dto.paymentMethod,
          paymentId: dto.paymentId,
        },
      });
      await prisma.user.update({
        where: { id: dto.userId },
        data: { planTier: dto.planTier, subscriptionStatus: dto.status },
      }).catch(() => {});

      const sub: StoredSubscription = {
        ...dto,
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.subscriptions.set(sub.id, sub);
      this.persist();
      return sub;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao registrar assinatura no PostgreSQL: ${err?.message}`);
      }
      const sub: StoredSubscription = {
        ...dto,
        id: subId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.subscriptions.set(sub.id, sub);
      this.persist();
      return sub;
    }
  }

  async getSubscriptionByUserId(userId: string): Promise<StoredSubscription | undefined> {
    try {
      const record = await prisma.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (record) {
        return {
          id: record.id,
          userId: record.userId,
          organizationId: record.organizationId,
          planTier: record.planTier as any,
          planName: record.planName,
          status: record.status as any,
          amount: record.amount,
          currency: record.currency,
          billingCycle: record.billingCycle as any,
          paymentMethod: record.paymentMethod as any,
          paymentId: record.paymentId || undefined,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar assinatura: ${err?.message}`);
      }
    }
    for (const s of this.subscriptions.values()) {
      if (s.userId === userId) return s;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // MARCAS / CLIENTES ATENDIDOS (Brand Brain & Multi-tenant)
  // ---------------------------------------------------------------------------
  async createBrand(dto: CreateBrandDto): Promise<StoredBrand> {
    const brandId = `brd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.brand.create({
        data: {
          id: brandId,
          organizationId: dto.organizationId,
          name: dto.name,
          websiteUrl: dto.websiteUrl,
          productDescription: dto.productDescription || '',
          targetAudience: dto.targetAudience || '',
          toneOfVoice: dto.toneOfVoice || '',
          ctaTargetUrl: dto.ctaTargetUrl || '',
          ctaText: dto.ctaText,
          forbiddenTerms: dto.forbiddenTerms || [],
          targetLanguage: dto.targetLanguage || 'pt-BR',
          autoPublish: dto.autoPublish ?? false,
          publishingSchedule: dto.publishingSchedule,
          isActive: dto.isActive ?? true,
        },
      });
      const brand: StoredBrand = {
        ...dto,
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.brands.set(brand.id, brand);
      this.persist();
      return brand;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar marca no PostgreSQL: ${err?.message}`);
      }
      const brand: StoredBrand = {
        ...dto,
        id: brandId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.brands.set(brand.id, brand);
      this.persist();
      return brand;
    }
  }

  async getBrand(id: string): Promise<StoredBrand | undefined> {
    try {
      const record = await prisma.brand.findUnique({ where: { id } });
      if (record) {
        return {
          id: record.id,
          organizationId: record.organizationId,
          name: record.name,
          websiteUrl: record.websiteUrl,
          productDescription: record.productDescription,
          targetAudience: record.targetAudience,
          toneOfVoice: record.toneOfVoice,
          ctaTargetUrl: record.ctaTargetUrl,
          ctaText: record.ctaText || undefined,
          forbiddenTerms: record.forbiddenTerms,
          targetLanguage: record.targetLanguage,
          autoPublish: record.autoPublish,
          publishingSchedule: record.publishingSchedule || undefined,
          isActive: record.isActive,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar marca no PostgreSQL: ${err?.message}`);
      }
    }
    return this.brands.get(id);
  }

  async updateBrand(id: string, updates: Partial<CreateBrandDto>): Promise<StoredBrand | undefined> {
    try {
      const record = await prisma.brand.update({
        where: { id },
        data: updates,
      });
      const brand: StoredBrand = {
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        websiteUrl: record.websiteUrl,
        productDescription: record.productDescription,
        targetAudience: record.targetAudience,
        toneOfVoice: record.toneOfVoice,
        ctaTargetUrl: record.ctaTargetUrl,
        ctaText: record.ctaText || undefined,
        forbiddenTerms: record.forbiddenTerms,
        targetLanguage: record.targetLanguage,
        autoPublish: record.autoPublish,
        publishingSchedule: record.publishingSchedule || undefined,
        isActive: record.isActive,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.brands.set(id, brand);
      this.persist();
      return brand;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao atualizar marca no PostgreSQL: ${err?.message}`);
      }
      const existing = this.brands.get(id);
      if (!existing) return undefined;
      const updated: StoredBrand = { ...existing, ...updates, updatedAt: new Date() };
      this.brands.set(id, updated);
      this.persist();
      return updated;
    }
  }

  async listBrandsByOrg(organizationId: string): Promise<StoredBrand[]> {
    try {
      const records = await prisma.brand.findMany({
        where: { organizationId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(record => ({
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        websiteUrl: record.websiteUrl,
        productDescription: record.productDescription,
        targetAudience: record.targetAudience,
        toneOfVoice: record.toneOfVoice,
        ctaTargetUrl: record.ctaTargetUrl,
        ctaText: record.ctaText || undefined,
        forbiddenTerms: record.forbiddenTerms,
        targetLanguage: record.targetLanguage,
        autoPublish: record.autoPublish,
        publishingSchedule: record.publishingSchedule || undefined,
        isActive: record.isActive,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar marcas no PostgreSQL: ${err?.message}`);
      }
      return Array.from(this.brands.values()).filter(b => b.organizationId === organizationId && b.isActive !== false);
    }
  }

  async listAllActiveBrands(): Promise<StoredBrand[]> {
    try {
      const records = await prisma.brand.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(record => ({
        id: record.id,
        organizationId: record.organizationId,
        name: record.name,
        websiteUrl: record.websiteUrl,
        productDescription: record.productDescription,
        targetAudience: record.targetAudience,
        toneOfVoice: record.toneOfVoice,
        ctaTargetUrl: record.ctaTargetUrl,
        ctaText: record.ctaText || undefined,
        forbiddenTerms: record.forbiddenTerms,
        targetLanguage: record.targetLanguage,
        autoPublish: record.autoPublish,
        publishingSchedule: record.publishingSchedule || undefined,
        isActive: record.isActive,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar marcas no PostgreSQL: ${err?.message}`);
      }
      return Array.from(this.brands.values()).filter(b => b.isActive !== false);
    }
  }

  // ---------------------------------------------------------------------------
  // INTEGRAÇÕES COM CMS (Criptografia AES-256-GCM em Repouso)
  // ---------------------------------------------------------------------------
  async saveCMSIntegration(dto: SaveCMSIntegrationDto): Promise<StoredCMSIntegration> {
    const encryptedCredentials = encryptJsonCredential(dto.credentials);
    const id = `cms_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.cMSIntegration.create({
        data: {
          id,
          brandId: dto.brandId,
          platform: dto.platform.toUpperCase() as any,
          siteUrl: dto.siteUrl,
          encryptedCredentials,
          defaultPostStatus: (dto.defaultPostStatus as any) || 'DRAFT',
        },
      });
      const item: StoredCMSIntegration = {
        id: record.id,
        brandId: record.brandId,
        platform: record.platform.toLowerCase() as any,
        siteUrl: record.siteUrl || undefined,
        encryptedCredentials: record.encryptedCredentials,
        defaultPostStatus: record.defaultPostStatus as any,
        createdAt: record.createdAt,
      };
      this.cmsIntegrations.set(item.id, item);
      this.persist();
      return item;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar integração CMS no PostgreSQL: ${err?.message}`);
      }
      const item: StoredCMSIntegration = {
        id,
        brandId: dto.brandId,
        platform: dto.platform,
        siteUrl: dto.siteUrl,
        encryptedCredentials,
        defaultPostStatus: dto.defaultPostStatus || 'DRAFT',
        createdAt: new Date(),
      };
      this.cmsIntegrations.set(item.id, item);
      this.persist();
      return item;
    }
  }

  async listCMSByBrand(brandId: string): Promise<StoredCMSIntegration[]> {
    try {
      const records = await prisma.cMSIntegration.findMany({
        where: { brandId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(r => ({
        id: r.id,
        brandId: r.brandId,
        platform: r.platform.toLowerCase() as any,
        siteUrl: r.siteUrl || undefined,
        encryptedCredentials: r.encryptedCredentials,
        defaultPostStatus: r.defaultPostStatus as any,
        createdAt: r.createdAt,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar integrações CMS: ${err?.message}`);
      }
      return Array.from(this.cmsIntegrations.values()).filter(c => c.brandId === brandId);
    }
  }

  async getDecryptedCMSIntegration<T = Record<string, any>>(id: string): Promise<{ integration: StoredCMSIntegration; credentials: T } | null> {
    try {
      const record = await prisma.cMSIntegration.findUnique({ where: { id } });
      if (record) {
        const credentials = decryptJsonCredential<T>(record.encryptedCredentials);
        const integration: StoredCMSIntegration = {
          id: record.id,
          brandId: record.brandId,
          platform: record.platform.toLowerCase() as any,
          siteUrl: record.siteUrl || undefined,
          encryptedCredentials: record.encryptedCredentials,
          defaultPostStatus: record.defaultPostStatus as any,
          createdAt: record.createdAt,
        };
        return { integration, credentials };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao descriptografar CMS: ${err?.message}`);
      }
    }
    const item = this.cmsIntegrations.get(id);
    if (!item) return null;
    const credentials = decryptJsonCredential<T>(item.encryptedCredentials);
    return { integration: item, credentials };
  }

  // ---------------------------------------------------------------------------
  // FILA DE PAUTAS (Queue)
  // ---------------------------------------------------------------------------
  async addTopicToQueue(dto: CreateTopicDto): Promise<StoredTopicQueue> {
    const id = `top_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.topicQueue.create({
        data: {
          id,
          brandId: dto.brandId,
          topic: dto.topic,
          primaryKeyword: dto.primaryKeyword,
          searchIntent: (dto.searchIntent as any) || 'INFORMATIONAL',
          priority: dto.priority || 1,
          status: 'BACKLOG',
          scheduledFor: dto.scheduledFor,
        },
      });
      const topic: StoredTopicQueue = {
        ...dto,
        id: record.id,
        status: record.status as any,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.topicQueues.set(topic.id, topic);
      this.persist();
      return topic;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar pauta no PostgreSQL: ${err?.message}`);
      }
      const topic: StoredTopicQueue = {
        ...dto,
        id,
        status: 'BACKLOG',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.topicQueues.set(topic.id, topic);
      this.persist();
      return topic;
    }
  }

  async listPendingTopics(brandId: string): Promise<StoredTopicQueue[]> {
    try {
      const records = await prisma.topicQueue.findMany({
        where: { brandId, status: { in: ['BACKLOG', 'SCHEDULED', 'READY_FOR_REVIEW'] } },
        orderBy: { priority: 'desc' },
      });
      return records.map(r => ({
        id: r.id,
        brandId: r.brandId,
        topic: r.topic,
        primaryKeyword: r.primaryKeyword,
        searchIntent: r.searchIntent as any,
        priority: r.priority,
        status: r.status as any,
        scheduledFor: r.scheduledFor || undefined,
        errorMessage: r.errorMessage || undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar pautas: ${err?.message}`);
      }
      return Array.from(this.topicQueues.values()).filter(
        t => t.brandId === brandId && ['BACKLOG', 'SCHEDULED', 'READY_FOR_REVIEW'].includes(t.status)
      );
    }
  }

  async updateTopicStatus(id: string, status: QueueStatus, errorMessage?: string): Promise<StoredTopicQueue | undefined> {
    try {
      const record = await prisma.topicQueue.update({
        where: { id },
        data: { status: status as any, errorMessage },
      });
      const topic: StoredTopicQueue = {
        id: record.id,
        brandId: record.brandId,
        topic: record.topic,
        primaryKeyword: record.primaryKeyword,
        searchIntent: record.searchIntent as any,
        priority: record.priority,
        status: record.status as any,
        errorMessage: record.errorMessage || undefined,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      this.topicQueues.set(id, topic);
      this.persist();
      return topic;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao atualizar pauta: ${err?.message}`);
      }
      const item = this.topicQueues.get(id);
      if (!item) return undefined;
      item.status = status;
      item.updatedAt = new Date();
      if (errorMessage) item.errorMessage = errorMessage;
      this.persist();
      return item;
    }
  }

  // ---------------------------------------------------------------------------
  // ARTIGOS
  // ---------------------------------------------------------------------------
  async saveArticle(dto: SaveArticleDto): Promise<StoredArticle> {
    const id = `art_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.article.upsert({
        where: { brandId_slug: { brandId: dto.brandId, slug: dto.slug } },
        update: {
          title: dto.title,
          metaDescription: dto.metaDescription,
          contentMarkdown: dto.contentMarkdown,
          contentHtml: dto.contentHtml,
          schemaJsonLd: dto.schemaJsonLd as any,
          faqItems: dto.faqItems as any,
          metrics: dto.metrics as any,
          status: dto.status as any,
          cmsPlatform: dto.cmsPlatform ? (dto.cmsPlatform.toUpperCase() as any) : null,
          remotePostId: dto.remotePostId,
          publishedUrl: dto.publishedUrl,
          indexNowNotified: dto.indexNowNotified ?? false,
          publishedAt: dto.status === 'PUBLISHED' ? new Date() : undefined,
        },
        create: {
          id,
          brandId: dto.brandId,
          topicQueueId: dto.topicQueueId,
          title: dto.title,
          slug: dto.slug,
          metaDescription: dto.metaDescription,
          contentMarkdown: dto.contentMarkdown,
          contentHtml: dto.contentHtml,
          schemaJsonLd: dto.schemaJsonLd as any,
          faqItems: dto.faqItems as any,
          metrics: dto.metrics as any,
          status: dto.status as any,
          cmsPlatform: dto.cmsPlatform ? (dto.cmsPlatform.toUpperCase() as any) : null,
          remotePostId: dto.remotePostId,
          publishedUrl: dto.publishedUrl,
          indexNowNotified: dto.indexNowNotified ?? false,
          publishedAt: dto.status === 'PUBLISHED' ? new Date() : undefined,
        },
      });
      const art: StoredArticle = {
        ...dto,
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        publishedAt: record.publishedAt || undefined,
      };
      this.articles.set(art.id, art);
      this.persist();
      return art;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao gravar artigo no PostgreSQL: ${err?.message}`);
      }
      const art: StoredArticle = {
        ...dto,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        publishedAt: dto.status === 'PUBLISHED' ? new Date() : undefined,
      };
      this.articles.set(art.id, art);
      this.persist();
      return art;
    }
  }

  async listArticlesByBrand(brandId: string): Promise<StoredArticle[]> {
    try {
      const records = await prisma.article.findMany({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
      });
      return records.map(r => ({
        id: r.id,
        brandId: r.brandId,
        topicQueueId: r.topicQueueId || undefined,
        title: r.title,
        slug: r.slug,
        metaDescription: r.metaDescription,
        contentMarkdown: r.contentMarkdown,
        contentHtml: r.contentHtml,
        schemaJsonLd: r.schemaJsonLd as any,
        faqItems: r.faqItems as any,
        metrics: r.metrics as any,
        status: r.status as any,
        cmsPlatform: r.cmsPlatform ? (r.cmsPlatform.toLowerCase() as any) : undefined,
        remotePostId: r.remotePostId || undefined,
        publishedUrl: r.publishedUrl || undefined,
        indexNowNotified: r.indexNowNotified,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        publishedAt: r.publishedAt || undefined,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar artigos: ${err?.message}`);
      }
      return Array.from(this.articles.values()).filter(a => a.brandId === brandId);
    }
  }

  async listInternalLinksByBrand(brandId: string): Promise<Array<{ title: string; url: string; keywords: string[] }>> {
    try {
      const records = await prisma.article.findMany({
        where: { brandId, status: 'PUBLISHED' },
        take: 20,
      });
      return records.map(r => ({
        title: r.title,
        url: r.publishedUrl || `/blog/${r.slug}`,
        keywords: [r.title.toLowerCase()],
      }));
    } catch {
      return Array.from(this.articles.values())
        .filter(a => a.brandId === brandId && a.status === 'PUBLISHED')
        .map(a => ({
          title: a.title,
          url: a.publishedUrl || `/blog/${a.slug}`,
          keywords: [a.title.toLowerCase()],
        }));
    }
  }

  // ---------------------------------------------------------------------------
  // GEO MONITOR (Share of Voice & IA Citations)
  // ---------------------------------------------------------------------------
  async recordGEOMonitor(dto: RecordGEOMonitorDto): Promise<StoredGEOMonitor> {
    const id = `geo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      const record = await prisma.gEOMonitorRun.create({
        data: {
          id,
          brandId: dto.brandId,
          queryPrompt: dto.queryPrompt,
          targetEngine: dto.targetEngine as any,
          isBrandMentioned: dto.isBrandMentioned,
          mentionRank: dto.mentionRank,
          sentiment: dto.sentiment as any,
          citedUrls: dto.citedUrls || [],
          rawAnswerText: dto.rawAnswerText,
        },
      });
      const mon: StoredGEOMonitor = {
        ...dto,
        id: record.id,
        createdAt: record.createdAt,
      };
      this.geoMonitors.unshift(mon);
      this.persist();
      return mon;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao registrar monitoramento GEO: ${err?.message}`);
      }
      const mon: StoredGEOMonitor = { ...dto, id, createdAt: new Date() };
      this.geoMonitors.unshift(mon);
      this.persist();
      return mon;
    }
  }

  async getLatestBrandMonitor(brandId: string): Promise<StoredGEOMonitor | undefined> {
    try {
      const record = await prisma.gEOMonitorRun.findFirst({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
      });
      if (record) {
        return {
          id: record.id,
          brandId: record.brandId,
          queryPrompt: record.queryPrompt,
          targetEngine: record.targetEngine as any,
          isBrandMentioned: record.isBrandMentioned,
          mentionRank: record.mentionRank ?? undefined,
          sentiment: record.sentiment as any,
          citedUrls: record.citedUrls,
          rawAnswerText: record.rawAnswerText || '',
          createdAt: record.createdAt,
        };
      }
    } catch {
      // Fallback em memória para ambientes de teste
    }
    return this.geoMonitors.find((m) => m.brandId === brandId);
  }

  async getBrandShareOfVoice(brandId: string) {
    try {
      const runs = await prisma.gEOMonitorRun.findMany({
        where: { brandId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      if (runs.length > 0) {
        const total = runs.length;
        const mentioned = runs.filter(r => r.isBrandMentioned).length;
        return {
          totalAudits: total,
          mentionedCount: mentioned,
          shareOfModelPercentage: Math.round((mentioned / total) * 100),
          lastAuditAt: runs[0].createdAt,
        };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao consultar Share of Voice: ${err?.message}`);
      }
    }
    const runs = this.geoMonitors.filter(m => m.brandId === brandId);
    const total = runs.length;
    const mentioned = runs.filter(r => r.isBrandMentioned).length;
    return {
      totalAudits: total,
      mentionedCount: mentioned,
      shareOfModelPercentage: total > 0 ? Math.round((mentioned / total) * 100) : 0,
      lastAuditAt: runs[0]?.createdAt || null,
    };
  }

  // ---------------------------------------------------------------------------
  // SCAN REPORTS (Auditorias Públicas)
  // ---------------------------------------------------------------------------
  async saveScan(scanData: any): Promise<StoredScanReport> {
    const id = `scn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const slug = scanData.domain.replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36);
    const geoScore = scanData.geoScore || 0;
    try {
      const record = await prisma.scanReport.create({
        data: {
          id,
          slug,
          domain: scanData.domain,
          brandName: scanData.brandName,
          niche: scanData.niche,
          geoScore,
          scanData,
        },
      });
      const report: StoredScanReport = {
        id: record.id,
        slug: record.slug,
        domain: record.domain,
        brandName: record.brandName,
        niche: record.niche,
        scanData: record.scanData,
        createdAt: record.createdAt,
        viewCount: record.viewCount,
      };
      this.scans.set(report.id, report);
      this.scans.set(report.slug, report);
      this.persist();
      return report;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao salvar relatório de auditoria: ${err?.message}`);
      }
      const report: StoredScanReport = {
        id,
        slug,
        domain: scanData.domain,
        brandName: scanData.brandName,
        niche: scanData.niche,
        scanData,
        createdAt: new Date(),
        viewCount: 0,
      };
      this.scans.set(report.id, report);
      this.scans.set(report.slug, report);
      this.persist();
      return report;
    }
  }

  async getScan(idOrSlug: string): Promise<StoredScanReport | undefined> {
    if (!idOrSlug) return undefined;
    try {
      const record = await prisma.scanReport.findFirst({
        where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      });
      if (record) {
        await prisma.scanReport.update({
          where: { id: record.id },
          data: { viewCount: { increment: 1 } },
        }).catch(() => {});
        return {
          id: record.id,
          slug: record.slug,
          domain: record.domain,
          brandName: record.brandName,
          niche: record.niche,
          scanData: record.scanData,
          createdAt: record.createdAt,
          viewCount: record.viewCount + 1,
        };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao buscar relatório de auditoria: ${err?.message}`);
      }
    }
    return this.scans.get(idOrSlug);
  }

  async listRecentScans(limit: number = 10): Promise<StoredScanReport[]> {
    try {
      const records = await prisma.scanReport.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
      return records.map(r => ({
        id: r.id,
        slug: r.slug,
        domain: r.domain,
        brandName: r.brandName,
        niche: r.niche,
        scanData: r.scanData,
        createdAt: r.createdAt,
        viewCount: r.viewCount,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao listar relatórios: ${err?.message}`);
      }
      const unique = Array.from(new Set(this.scans.values()));
      return unique
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }
  }

  // ---------------------------------------------------------------------------
  // WHATSAPP CLOUD API (Meta Oficial)
  // ---------------------------------------------------------------------------
  getWhatsAppConfig(): WhatsAppCloudConfig {
    return { ...this.whatsappConfig };
  }

  async getWhatsAppConfigAsync(): Promise<WhatsAppCloudConfig> {
    try {
      const record = await prisma.whatsAppConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
      if (record) {
        this.whatsappConfig = {
          accessToken: record.accessToken || '',
          phoneNumberId: record.phoneNumberId || '',
          businessAccountId: record.businessAccountId || '',
          verifyToken: record.verifyToken,
          templateName: record.templateName || 'dossie_executivo_geo',
          isEnabled: record.isEnabled,
          testMode: record.testMode,
        };
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Falha ao ler configuração WhatsApp: ${err?.message}`);
      }
    }
    return { ...this.whatsappConfig };
  }

  saveWhatsAppConfig(updates: Partial<WhatsAppCloudConfig>): WhatsAppCloudConfig {
    this.whatsappConfig = {
      ...this.whatsappConfig,
      ...updates,
    };
    prisma.whatsAppConfig.findFirst().then(existing => {
      if (existing) {
        return prisma.whatsAppConfig.update({
          where: { id: existing.id },
          data: updates,
        });
      } else {
        return prisma.whatsAppConfig.create({
          data: {
            accessToken: updates.accessToken || this.whatsappConfig.accessToken,
            phoneNumberId: updates.phoneNumberId || this.whatsappConfig.phoneNumberId,
            businessAccountId: updates.businessAccountId || this.whatsappConfig.businessAccountId,
            verifyToken: updates.verifyToken || this.whatsappConfig.verifyToken,
            templateName: updates.templateName || this.whatsappConfig.templateName,
            isEnabled: updates.isEnabled ?? this.whatsappConfig.isEnabled,
            testMode: updates.testMode ?? this.whatsappConfig.testMode,
          },
        });
      }
    }).catch(err => {
      console.warn('⚠️ [DB] Erro ao sincronizar WhatsAppConfig no Prisma:', err?.message);
    });
    this.persist();
    return this.whatsappConfig;
  }

  saveWhatsAppMessage(msg: Omit<StoredWhatsAppMessage, 'id' | 'createdAt' | 'updatedAt'>): StoredWhatsAppMessage {
    const id = `wam_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const record: StoredWhatsAppMessage = {
      ...msg,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.whatsappMessages.set(id, record);
    if (record.metaMessageId) {
      this.whatsappMessages.set(record.metaMessageId, record);
    }
    prisma.whatsAppMessage.create({
      data: {
        id: record.id,
        to: record.to,
        formattedTo: record.formattedTo,
        type: record.type,
        templateName: record.templateName,
        status: record.status,
        metaMessageId: record.metaMessageId,
        clientName: record.clientName,
        companyName: record.companyName,
        reportSlug: record.reportSlug,
        dossierUrl: record.dossierUrl,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
      },
    }).catch(err => {
      console.warn('⚠️ [DB] Erro ao salvar WhatsAppMessage no Prisma:', err?.message);
    });
    this.persist();
    return record;
  }

  updateWhatsAppMessageStatus(idOrMetaId: string, status: StoredWhatsAppMessage['status'], errorMessage?: string): boolean {
    const record = this.whatsappMessages.get(idOrMetaId);
    if (record) {
      record.status = status;
      record.updatedAt = new Date();
      if (errorMessage) record.errorMessage = errorMessage;
    }
    prisma.whatsAppMessage.updateMany({
      where: { OR: [{ id: idOrMetaId }, { metaMessageId: idOrMetaId }] },
      data: { status, errorMessage, updatedAt: new Date() },
    }).catch(err => {
      console.warn('⚠️ [DB] Erro ao atualizar WhatsAppMessage no Prisma:', err?.message);
    });
    this.persist();
    return true;
  }

  listWhatsAppMessages(limit: number = 20): StoredWhatsAppMessage[] {
    const unique = Array.from(new Set(this.whatsappMessages.values()));
    return unique
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // ECOSSISTEMA: STATUS DOS 5 PILARES
  // ---------------------------------------------------------------------------
  getEcosystemStatus(organizationId: string): EcosystemPillarsStatus {
    return {
      organizationId,
      googleMyBusiness: {
        name: 'Pilar 01: Atração Local',
        status: 'ACTIVE',
        details: 'Perfil local monitorado para termos de busca regional',
        actionLabel: 'Verificar Ficha',
      },
      modernWebsite: {
        name: 'Pilar 02: Atendimento e Site',
        status: 'ACTIVE',
        details: 'Site veloz com estrutura semântica Schema.org',
        actionLabel: 'Ver Detalhes',
      },
      aiAgent: {
        name: 'Pilar 03: Gestão & Atendimento IA',
        status: 'ACTIVE',
        details: 'Agente conversacional treinado para captação 24/7',
        actionLabel: 'Abrir Painel',
      },
      crm: {
        name: 'Pilar 04: Reputação & CRM',
        status: 'ACTIVE',
        details: 'Funil de vendas integrado com gestão de leads',
        actionLabel: 'Abrir Pipeline',
      },
      geoEngine: {
        name: 'Pilar 05: Autoridade em IA (GeoPulse)',
        status: 'DOMINATING',
        details: 'Motor autônomo monitorando citações em LLMs',
        actionLabel: 'Gerenciar Pautas',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // AUDITORIAS PÚBLICAS (Rate Limiting Persistente & Anti-Drenagem de IA)
  // ---------------------------------------------------------------------------
  async recordPublicAudit(clientIp: string, domain: string): Promise<StoredPublicAuditLog> {
    const record: StoredPublicAuditLog = {
      id: crypto.randomUUID(),
      clientIp,
      domain,
      createdAt: new Date(),
    };
    this.publicAuditLogs.push(record);
    this.persist();

    try {
      await prisma.publicAuditLog.create({
        data: {
          id: record.id,
          clientIp: record.clientIp,
          domain: record.domain,
          createdAt: record.createdAt,
        },
      });
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        console.error('🚨 [DB] Falha crítica ao persistir PublicAuditLog no Prisma:', err?.message);
      } else {
        console.warn('⚠️ [DB] Aviso ao persistir PublicAuditLog no Prisma:', err?.message);
      }
    }

    return record;
  }

  async countDailyPublicAudits(since: Date): Promise<number> {
    try {
      return await prisma.publicAuditLog.count({
        where: {
          createdAt: { gte: since },
        },
      });
    } catch {
      return this.publicAuditLogs.filter((log) => new Date(log.createdAt).getTime() >= since.getTime()).length;
    }
  }

  async countDailyPublicAuditsByIp(clientIp: string, since: Date): Promise<number> {
    try {
      return await prisma.publicAuditLog.count({
        where: {
          clientIp,
          createdAt: { gte: since },
        },
      });
    } catch {
      return this.publicAuditLogs.filter(
        (log) => log.clientIp === clientIp && new Date(log.createdAt).getTime() >= since.getTime()
      ).length;
    }
  }
}

export const db = new EnterpriseRepository();
