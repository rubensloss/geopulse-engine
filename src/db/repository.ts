import fs from 'fs';
import path from 'path';
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
} from './types.js';
import { decryptJsonCredential, encryptJsonCredential } from '../security/encryption.js';

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
 * com persistência em disco (data/db.json) e criptografia AES-256-GCM em repouso.
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

  constructor() {
    this.loadFromDisk();
  }

  // ---------------------------------------------------------------------------
  // PERSISTÊNCIA EM DISCO (JSON STORAGE)
  // ---------------------------------------------------------------------------
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storageFile)) {
        return;
      }
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
      if (data.internalLinks) {
        this.internalLinks = new Map(data.internalLinks.map((item: any) => [item.id, item]));
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
    } catch (err) {
      console.warn('⚠️ [DB] Não foi possível carregar base persistente anterior:', err);
    }
  }

  private persist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.storageFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const snapshot = {
          organizations: Array.from(this.organizations.values()),
          users: Array.from(this.users.values()),
          subscriptions: Array.from(this.subscriptions.values()),
          brands: Array.from(this.brands.values()),
          cmsIntegrations: Array.from(this.cmsIntegrations.values()),
          topicQueues: Array.from(this.topicQueues.values()),
          articles: Array.from(this.articles.values()),
          internalLinks: Array.from(this.internalLinks.values()),
          geoMonitors: this.geoMonitors,
          scans: Array.from(new Set(this.scans.values())),
        };
        fs.writeFileSync(this.storageFile, JSON.stringify(snapshot, null, 2), 'utf-8');
      } catch (err) {
        console.error('❌ [DB] Erro ao persistir dados no disco:', err);
      }
    }, 150);
  }

  // ---------------------------------------------------------------------------
  // ORGANIZAÇÕES (Tenants)
  // ---------------------------------------------------------------------------
  createOrganization(name: string, slug: string): StoredOrganization {
    const org: StoredOrganization = {
      id: `org_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      slug,
      createdAt: new Date(),
    };
    this.organizations.set(org.id, org);
    this.persist();
    return org;
  }

  getOrganization(id: string): StoredOrganization | undefined {
    return this.organizations.get(id);
  }

  listOrganizations(): StoredOrganization[] {
    return Array.from(this.organizations.values());
  }

  // ---------------------------------------------------------------------------
  // USUÁRIOS (Authentication & Access Control)
  // ---------------------------------------------------------------------------
  createUser(dto: Omit<StoredUser, 'id' | 'createdAt' | 'updatedAt'>): StoredUser {
    const user: StoredUser = {
      ...dto,
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    this.persist();
    return user;
  }

  getUserByEmail(email: string): StoredUser | undefined {
    const normalized = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase().trim() === normalized) {
        return u;
      }
    }
    return undefined;
  }

  getUserById(id: string): StoredUser | undefined {
    return this.users.get(id);
  }

  updateUser(id: string, updates: Partial<StoredUser>): StoredUser | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated: StoredUser = {
      ...user,
      ...updates,
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    this.persist();
    return updated;
  }

  listUsers(): StoredUser[] {
    return Array.from(this.users.values());
  }

  // ---------------------------------------------------------------------------
  // ASSINATURAS & CHECKOUT (Billing & Plans)
  // ---------------------------------------------------------------------------
  createSubscription(dto: Omit<StoredSubscription, 'id' | 'createdAt' | 'updatedAt'>): StoredSubscription {
    const sub: StoredSubscription = {
      ...dto,
      id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.subscriptions.set(sub.id, sub);

    // Atualiza o plano do usuário correspondente
    const user = this.users.get(dto.userId);
    if (user) {
      user.planTier = dto.planTier;
      user.subscriptionStatus = dto.status;
      user.updatedAt = new Date();
      this.users.set(user.id, user);
    }

    this.persist();
    return sub;
  }

  getSubscriptionByUserId(userId: string): StoredSubscription | undefined {
    const subs = Array.from(this.subscriptions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return subs[0];
  }

  updateSubscription(id: string, updates: Partial<StoredSubscription>): StoredSubscription | undefined {
    const sub = this.subscriptions.get(id);
    if (!sub) return undefined;
    const updated: StoredSubscription = {
      ...sub,
      ...updates,
      updatedAt: new Date(),
    };
    this.subscriptions.set(id, updated);
    this.persist();
    return updated;
  }

  // ---------------------------------------------------------------------------
  // MARCAS / CLIENTES (Brand Profiles)
  // ---------------------------------------------------------------------------
  createBrand(dto: CreateBrandDto): StoredBrand {
    const brand: StoredBrand = {
      ...dto,
      id: `brand_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.brands.set(brand.id, brand);
    this.persist();
    return brand;
  }

  getBrand(id: string): StoredBrand | undefined {
    return this.brands.get(id);
  }

  listBrandsByOrg(organizationId: string): StoredBrand[] {
    return Array.from(this.brands.values()).filter((b) => b.organizationId === organizationId);
  }

  listAllActiveBrands(): StoredBrand[] {
    return Array.from(this.brands.values()).filter((b) => b.isActive !== false);
  }

  updateBrand(id: string, updates: Partial<StoredBrand>): StoredBrand | undefined {
    const brand = this.brands.get(id);
    if (!brand) return undefined;
    const updated: StoredBrand = {
      ...brand,
      ...updates,
      updatedAt: new Date(),
    };
    this.brands.set(id, updated);
    this.persist();
    return updated;
  }

  // ---------------------------------------------------------------------------
  // CMS & CRIPTOGRAFIA (AES-256-GCM)
  // ---------------------------------------------------------------------------
  saveCMSIntegration(dto: SaveCMSIntegrationDto): StoredCMSIntegration {
    const encrypted = encryptJsonCredential(dto.credentials);

    const integration: StoredCMSIntegration = {
      id: `cms_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      brandId: dto.brandId,
      platform: dto.platform,
      siteUrl: dto.siteUrl,
      encryptedCredentials: encrypted,
      defaultPostStatus: dto.defaultPostStatus || 'DRAFT',
      createdAt: new Date(),
    };

    this.cmsIntegrations.set(integration.id, integration);
    this.persist();
    return integration;
  }

  getDecryptedCMSIntegration<T>(integrationId: string): {
    integration: StoredCMSIntegration;
    credentials: T;
  } | undefined {
    const integration = this.cmsIntegrations.get(integrationId);
    if (!integration) return undefined;

    const decryptedCredentials = decryptJsonCredential<T>(integration.encryptedCredentials);
    return {
      integration,
      credentials: decryptedCredentials,
    };
  }

  listCMSByBrand(brandId: string): StoredCMSIntegration[] {
    return Array.from(this.cmsIntegrations.values()).filter((c) => c.brandId === brandId);
  }

  // ---------------------------------------------------------------------------
  // FILA DE PAUTAS (Topic Queue State Machine)
  // ---------------------------------------------------------------------------
  addTopicToQueue(dto: CreateTopicDto): StoredTopicQueue {
    const topic: StoredTopicQueue = {
      ...dto,
      id: `topic_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'BACKLOG',
      priority: dto.priority ?? 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.topicQueues.set(topic.id, topic);
    this.persist();
    return topic;
  }

  updateTopicStatus(topicId: string, status: QueueStatus, errorMessage?: string): StoredTopicQueue {
    const topic = this.topicQueues.get(topicId);
    if (!topic) throw new Error(`Tópico ${topicId} não encontrado.`);

    topic.status = status;
    topic.updatedAt = new Date();
    if (errorMessage) topic.errorMessage = errorMessage;

    this.persist();
    return topic;
  }

  listPendingTopics(brandId: string): StoredTopicQueue[] {
    return Array.from(this.topicQueues.values())
      .filter((t) => t.brandId === brandId && (t.status === 'BACKLOG' || t.status === 'SCHEDULED'))
      .sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  }

  // ---------------------------------------------------------------------------
  // ARTIGOS & LINKS INTERNOS
  // ---------------------------------------------------------------------------
  saveArticle(dto: SaveArticleDto): StoredArticle {
    const article: StoredArticle = {
      ...dto,
      id: `art_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: dto.status === 'PUBLISHED' ? new Date() : undefined,
    };
    this.articles.set(article.id, article);

    if (article.publishedUrl) {
      const linkIndex: StoredInternalLink = {
        id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        brandId: article.brandId,
        articleId: article.id,
        title: article.title,
        url: article.publishedUrl,
        keywords: [article.title],
      };
      this.internalLinks.set(linkIndex.id, linkIndex);
    }

    if (dto.topicQueueId) {
      this.updateTopicStatus(dto.topicQueueId, dto.status === 'PUBLISHED' ? 'PUBLISHED' : 'READY_FOR_REVIEW');
    }

    this.persist();
    return article;
  }

  listArticlesByBrand(brandId: string): StoredArticle[] {
    return Array.from(this.articles.values()).filter((a) => a.brandId === brandId);
  }

  listInternalLinksByBrand(brandId: string): Array<{ title: string; url: string }> {
    return Array.from(this.internalLinks.values())
      .filter((l) => l.brandId === brandId)
      .map((l) => ({ title: l.title, url: l.url }));
  }

  // ---------------------------------------------------------------------------
  // MONITOR GEO (Share of Model)
  // ---------------------------------------------------------------------------
  recordGEOMonitor(dto: RecordGEOMonitorDto): StoredGEOMonitor {
    const entry: StoredGEOMonitor = {
      ...dto,
      id: `geo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: new Date(),
    };
    this.geoMonitors.push(entry);
    this.persist();
    return entry;
  }

  getBrandShareOfVoice(brandId: string) {
    const brandRuns = this.geoMonitors.filter((m) => m.brandId === brandId);
    if (brandRuns.length === 0) {
      return { totalChecks: 0, mentionRate: '0%', byEngine: {} };
    }

    const mentions = brandRuns.filter((m) => m.isBrandMentioned);
    const mentionRate = `${Math.round((mentions.length / brandRuns.length) * 100)}%`;

    const byEngine: Record<string, { checks: number; mentions: number; percentage: string }> = {};
    for (const run of brandRuns) {
      if (!byEngine[run.targetEngine]) {
        byEngine[run.targetEngine] = { checks: 0, mentions: 0, percentage: '0%' };
      }
      byEngine[run.targetEngine].checks++;
      if (run.isBrandMentioned) {
        byEngine[run.targetEngine].mentions++;
      }
    }

    for (const engine in byEngine) {
      const stats = byEngine[engine];
      stats.percentage = `${Math.round((stats.mentions / stats.checks) * 100)}%`;
    }

    return {
      totalChecks: brandRuns.length,
      totalMentions: mentions.length,
      mentionRate,
      byEngine,
    };
  }

  // ---------------------------------------------------------------------------
  // ECOSSISTEMA: CICLO DE EXCELÊNCIA DIGITAL (5 Pilares)
  // ---------------------------------------------------------------------------
  getEcosystemStatus(organizationId: string): EcosystemPillarsStatus {
    const user = Array.from(this.users.values()).find(u => u.organizationId === organizationId);
    const isExcellenceCycle = user?.planTier === 'EXCELLENCE_CYCLE';

    return {
      organizationId,
      googleMyBusiness: {
        name: 'Pilar 1: Google Meu Negócio & Maps',
        status: isExcellenceCycle ? 'ACTIVE' : 'ACTION_REQUIRED',
        rating: 4.8,
        reviewsCount: isExcellenceCycle ? 142 : 12,
        details: isExcellenceCycle
          ? 'Ficha oficial verificada, fotos 360°, postagens semanais e gestão ativa de avaliações 5 estrelas.'
          : 'Ficha necessita de verificação, alinhamento de categorias comerciais e padronização de NAP.',
        actionLabel: isExcellenceCycle ? 'Ver Ficha no Google Maps' : 'Ativar Gestão no Ciclo de Excelência',
      },
      modernWebsite: {
        name: 'Pilar 2: Site Moderno & Imersivo',
        status: isExcellenceCycle ? 'ACTIVE' : 'UPGRADE_RECOMMENDED',
        speedScore: isExcellenceCycle ? 98 : 64,
        details: isExcellenceCycle
          ? 'Arquitetura ultra-rápida, mobile-first, schemas JSON-LD injetados e taxa de rejeição reduzida em 45%.'
          : 'Site legado com perda de velocidade móvel e sem dados estruturados para captura de Zero-Click.',
        actionLabel: isExcellenceCycle ? 'Inspecionar Métricas Web' : 'Modernizar Site no Ciclo de Excelência',
      },
      aiAgent: {
        name: 'Pilar 3: Agente de IA 24/7',
        status: isExcellenceCycle ? 'ACTIVE' : 'STANDBY',
        conversationsHandled: isExcellenceCycle ? 438 : 0,
        details: isExcellenceCycle
          ? 'Agente conversacional treinado nos produtos da empresa, atendendo clientes no WhatsApp e site sem espera.'
          : 'Atendimento manual em horário comercial com perda estimada de 38% dos leads noturnos e de fim de semana.',
        actionLabel: isExcellenceCycle ? 'Painel de Diálogos do Agente' : 'Implantar Agente de IA',
      },
      crm: {
        name: 'Pilar 4: CRM & Gestão de Funil',
        status: isExcellenceCycle ? 'ACTIVE' : 'READY_TO_SYNC',
        activeDealsCount: isExcellenceCycle ? 29 : 4,
        details: isExcellenceCycle
          ? 'Funil de vendas sincronizado com automação de follow-up, histórico de negociação e previsibilidade de caixa.'
          : 'Contatos e oportunidades dispersos em planilhas ou WhatsApp pessoal dos vendedores.',
        actionLabel: isExcellenceCycle ? 'Acessar Pipeline de Vendas' : 'Conectar CRM ao Ecossistema',
      },
      geoEngine: {
        name: '👑 Joia da Coroa: Motor GEO & Citações nas IAs',
        status: isExcellenceCycle ? 'DOMINATING' : 'ACTIVE',
        shareOfModel: isExcellenceCycle ? '78% das consultas' : '24% das consultas',
        details: 'Motor autônomo gerando conteúdos com Information Gain e indexação em tempo real no Google, ChatGPT e Perplexity.',
        actionLabel: 'Ver Pautas e Monitoramento',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // RELATÓRIOS PÚBLICOS DE AUDITORIA GEO (LEAD MAGNET & COMPARTILHAMENTO)
  // ---------------------------------------------------------------------------
  saveScan(scanData: any): StoredScanReport {
    const rawDomain = (scanData.domain || 'empresa.com.br').toLowerCase().trim();
    const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/[^a-z0-9]/g, '-');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const id = `scan_${Date.now().toString(36)}_${randomSuffix}`;
    const slug = `${cleanDomain}-${randomSuffix}`;

    const report: StoredScanReport = {
      id,
      slug,
      domain: rawDomain,
      brandName: scanData.brandName || scanData.domain,
      niche: scanData.niche || 'Geral',
      scanData,
      createdAt: new Date(),
      viewCount: 0,
    };

    this.scans.set(report.id, report);
    this.scans.set(report.slug, report);
    this.persist();
    return report;
  }

  getScan(idOrSlug: string): StoredScanReport | undefined {
    if (!idOrSlug) return undefined;
    const report = this.scans.get(idOrSlug);
    if (report) {
      report.viewCount = (report.viewCount || 0) + 1;
      this.persist();
    }
    return report;
  }

  listRecentScans(limit: number = 10): StoredScanReport[] {
    const unique = Array.from(new Set(this.scans.values()));
    return unique
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

// Instância singleton exportada
export const db = new EnterpriseRepository();
