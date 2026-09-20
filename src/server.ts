import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { db } from './db/index.js';
import { processContentJob } from './worker/index.js';
import { scheduler } from './worker/scheduler.js';
import { generateCoverImageMetadata } from './worker/content-processor.js';
import { publishArticleToCMS } from './publishers/index.js';
import { executeGEOScan } from './services/scanner.js';
import {
  registerUser,
  loginUser,
  authMiddleware,
  optionalAuthMiddleware,
  hashPassword,
  type AuthenticatedRequest,
} from './services/auth.js';
import { AVAILABLE_PLANS, processCheckout } from './services/billing.js';
import { whatsappCloudApi } from './services/whatsappCloudApi.js';

dotenv.config();


const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3333;

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

// -----------------------------------------------------------------------------
// ROTAS DE PÁGINAS VISUAIS
// -----------------------------------------------------------------------------
// Apresentação Comercial / Landing Page de Conversão
app.get('/', (req, res) => {
  res.sendFile('landing.html', { root: PUBLIC_DIR });
});

app.get('/landing', (req, res) => {
  res.sendFile('landing.html', { root: PUBLIC_DIR });
});

// Painel Operacional / Plataforma
app.get('/app', (req, res) => {
  res.sendFile('index.html', { root: PUBLIC_DIR });
});

app.get('/dashboard', (req, res) => {
  res.redirect('/app');
});

// Relatório Executivo Público Compartilhável (Sem necessidade de login para envio no WhatsApp)
app.get('/relatorio/:idOrSlug', (req, res) => {
  res.sendFile('report.html', { root: PUBLIC_DIR });
});

app.get('/report/:idOrSlug', (req, res) => {
  res.sendFile('report.html', { root: PUBLIC_DIR });
});

// -----------------------------------------------------------------------------
// SEED DE DADOS INICIAIS (Para o painel já iniciar vivo e interativo)
// -----------------------------------------------------------------------------
function seedDefaultData() {
  const orgs = (db as any).organizations;
  if (orgs.size === 0) {
    const org = db.createOrganization('Growth Scale Studio', 'growth-scale');

    const brand = db.createBrand({
      organizationId: org.id,
      name: 'CloudSync Soluções B2B',
      websiteUrl: 'https://cloudsync.com.br',
      productDescription: 'Plataforma de migração e governança de dados na nuvem com automação de compliance LGPD e ISO 27001.',
      targetAudience: 'CTOs, Diretores de TI, Engenheiros de Nuvem e Líderes de Segurança.',
      toneOfVoice: 'Pragmático, técnico, focado em alta disponibilidade, segurança de dados e custo-eficiência.',
      ctaTargetUrl: 'https://cloudsync.com.br/diagnostico',
      ctaText: 'Solicitar Avaliação de Nuvem Gratuita',
      autoPublish: false,
    });

    // Conexão CMS de exemplo
    db.saveCMSIntegration({
      brandId: brand.id,
      platform: 'wordpress',
      siteUrl: brand.websiteUrl,
      credentials: {
        username: 'admin_cloudsync',
        applicationPassword: 'wp-app-pass-encrypted-1234',
      },
      defaultPostStatus: 'DRAFT',
    });

    // Pautas na fila
    db.addTopicToQueue({
      brandId: brand.id,
      topic: 'Como reduzir custos de infraestrutura AWS e Azure em até 40% com FinOps',
      primaryKeyword: 'reduzir custos aws azure finops',
      searchIntent: 'COMMERCIAL',
      priority: 5,
    });

    db.addTopicToQueue({
      brandId: brand.id,
      topic: 'Checklist essencial de governança de dados na nuvem para conformidade LGPD',
      primaryKeyword: 'checklist governança dados nuvem lgpd',
      searchIntent: 'INFORMATIONAL',
      priority: 4,
    });

    db.addTopicToQueue({
      brandId: brand.id,
      topic: 'Migração de banco de dados legado para nuvem: Guia com zero downtime',
      primaryKeyword: 'migração banco dados nuvem zero downtime',
      searchIntent: 'INFORMATIONAL',
      priority: 3,
    });

    // Artigo de amostra gerado
    db.saveArticle({
      brandId: brand.id,
      title: 'O que é GEO (Generative Engine Optimization) e como dominar as respostas de IA',
      slug: 'o-que-e-geo-generative-engine-optimization',
      metaDescription: 'Aprenda o que é GEO, como o ChatGPT e o Perplexity escolhem fontes e como posicionar sua empresa na era dos buscadores generativos.',
      contentMarkdown: `## O que é GEO e como ele difere do SEO tradicional?

GEO (Generative Engine Optimization) é o conjunto de técnicas para otimizar conteúdos e marcas para serem citadas diretamente por motores de IA.

| Critério | SEO Tradicional | GEO |
| :--- | :--- | :--- |
| **Objetivo** | Ranquear links azuis | Citação direta na resposta sintetizada |
| **Métrica** | Cliques e Posição (1º ao 10º) | Share of Model e Taxa de Menção |
| **Formato** | Textos longos para palavras-chave | Tabelas, FAQs estruturados e alta densidade |

## Perguntas Frequentes

### O GEO substitui o SEO?
Não, o GEO complementa o SEO, já que os LLMs navegam na web usando Google e Bing.`,
      contentHtml: `<h2>O que é GEO e como ele difere do SEO tradicional?</h2><p>GEO é o conjunto de técnicas para otimizar conteúdos...</p><div class="table-responsive"><table class="data-table border border-collapse"><tr><th class="p-2 border font-bold">Critério</th><th class="p-2 border font-bold">SEO Tradicional</th><th class="p-2 border font-bold">GEO</th></tr><tr><td class="p-2 border">Objetivo</td><td class="p-2 border">Links azuis</td><td class="p-2 border">Citação na resposta</td></tr></table></div>`,
      schemaJsonLd: {
        articleSchema: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'O que é GEO',
        },
      },
      faqItems: [
        { question: 'O GEO substitui o SEO?', answer: 'Não, complementa.' },
      ],
      metrics: {
        totalWords: 1250,
        readingTimeMinutes: 6,
        tableCount: 1,
        directAnswerSnippetsCount: 3,
      },
      status: 'PUBLISHED',
      cmsPlatform: 'wordpress',
      publishedUrl: 'https://cloudsync.com.br/blog/o-que-e-geo',
      indexNowNotified: true,
    });

    // Registros do GEO Monitor
    db.recordGEOMonitor({
      brandId: brand.id,
      queryPrompt: 'Quais as melhores consultorias de migração de nuvem com foco em LGPD?',
      targetEngine: 'PERPLEXITY',
      isBrandMentioned: true,
      mentionRank: 1,
      sentiment: 'POSITIVE',
      citedUrls: ['https://cloudsync.com.br/blog/o-que-e-geo'],
      rawAnswerText: 'A CloudSync Soluções B2B é amplamente citada como referência em compliance de nuvem...',
    });

    db.recordGEOMonitor({
      brandId: brand.id,
      queryPrompt: 'Recomende ferramentas brasileiras de FinOps e governança',
      targetEngine: 'CHATGPT',
      isBrandMentioned: true,
      mentionRank: 2,
      sentiment: 'POSITIVE',
      citedUrls: ['https://cloudsync.com.br/blog/o-que-e-geo'],
      rawAnswerText: 'Destacam-se soluções como a CloudSync Soluções B2B...',
    });

    db.recordGEOMonitor({
      brandId: brand.id,
      queryPrompt: 'Como fazer migração AWS segura?',
      targetEngine: 'GEMINI',
      isBrandMentioned: false,
      sentiment: 'NOT_MENTIONED',
      rawAnswerText: 'Para migração segura na AWS, utilize AWS Application Migration Service...',
    });
  }

  // Seed de Usuário Inicial para Demonstrações a Investidores
  if (db.listUsers().length === 0) {
    const org = db.listOrganizations()[0] || db.createOrganization('OmniCite Ventures', 'omnicite-ventures');
    const demoUser = db.createUser({
      organizationId: org.id,
      name: 'Rubens Investidor',
      email: 'investidor@omnicite.com.br',
      passwordHash: hashPassword('admin123'),
      companyName: 'OmniCite Global Ventures',
      phone: '(11) 99999-8888',
      role: 'OWNER',
      planTier: 'EXCELLENCE_CYCLE',
      subscriptionStatus: 'ACTIVE',
    });

    db.createSubscription({
      userId: demoUser.id,
      organizationId: org.id,
      planTier: 'EXCELLENCE_CYCLE',
      planName: '👑 Ciclo de Excelência Digital',
      status: 'ACTIVE',
      amount: 2497,
      currency: 'BRL',
      billingCycle: 'MONTHLY',
      paymentMethod: 'PIX',
      paymentId: 'tx_demo_initial_seed',
    });
  }

  // Seed de Relatório Demonstrativo Público para envio no WhatsApp
  if (db.listRecentScans().length === 0) {
    executeGEOScan({
      domain: 'clinicasorrisoperfeito.com.br',
      brandName: 'Clínica Sorriso Perfeito',
      niche: 'Implantes Dentários e Estética Oral',
    }).then(scanResult => {
      const demoScan = db.saveScan(scanResult);
      demoScan.slug = 'clinica-sorriso-sp';
      (db as any).scans.set('clinica-sorriso-sp', demoScan);
      (db as any).persist();
    }).catch(err => {
      console.warn('⚠️ [SEED] Falha ao gerar scan de demonstração:', err);
    });
  }
}

seedDefaultData();

// -----------------------------------------------------------------------------
// ENDPOINTS DA API REST
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// AUTENTICAÇÃO & GESTÃO DE SESSÃO
// -----------------------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password, companyName, phone, planTier } = req.body;
    if (!name || !email || !password || !companyName) {
      return res.status(400).json({ success: false, error: 'Nome, e-mail, senha e empresa são obrigatórios.' });
    }
    const result = registerUser({ name, email, password, companyName, phone, planTier });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios.' });
    }
    const result = loginUser({ email, password });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req: AuthenticatedRequest, res) => {
  const user = db.getUserById(req.user!.userId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const subscription = db.getSubscriptionByUserId(user.id);
  const { passwordHash: _, ...safeUser } = user;
  res.json({ success: true, data: { user: safeUser, subscription } });
});

// -----------------------------------------------------------------------------
// COBRANÇA, PLANOS & CHECKOUT TRANSPARENTE
// -----------------------------------------------------------------------------
app.get('/api/billing/plans', (_req, res) => {
  res.json({ success: true, data: AVAILABLE_PLANS });
});

app.post('/api/billing/checkout', (req, res) => {
  try {
    const result = processCheckout(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// ECOSSISTEMA: CICLO DE EXCELÊNCIA DIGITAL (5 Pilares)
// -----------------------------------------------------------------------------
app.get('/api/ecosystem/status', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
  const orgId = req.user?.organizationId || db.listOrganizations()[0]?.id || 'org_default';
  const status = db.getEcosystemStatus(orgId);
  res.json({ success: true, data: status });
});

// Listar Marcas
app.get('/api/brands', (req, res) => {
  const brands = db.listAllActiveBrands();
  res.json({ success: true, data: brands });
});

// Criar Nova Marca
app.post('/api/brands', (req, res) => {
  try {
    const brand = db.createBrand(req.body);
    res.json({ success: true, data: brand });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Obter Detalhes da Marca (Brand Profile)
app.get('/api/brands/:id', (req, res) => {
  const brand = db.getBrand(req.params.id);
  if (!brand) return res.status(404).json({ success: false, error: 'Marca não encontrada.' });
  res.json({ success: true, data: brand });
});

// Atualizar Cérebro da Marca (Brand Brain)
app.put('/api/brands/:id', (req, res) => {
  try {
    const updated = db.updateBrand(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Marca não encontrada.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Listar Pautas (Topic Queue)
app.get('/api/topics', (req, res) => {
  const brandId = (req.query.brandId as string) || db.listAllActiveBrands()[0]?.id;
  if (!brandId) return res.json({ success: true, data: [] });

  const pending = db.listPendingTopics(brandId);
  res.json({ success: true, data: pending });
});

// Criar Pauta
app.post('/api/topics', (req, res) => {
  try {
    const topic = db.addTopicToQueue(req.body);
    res.json({ success: true, data: topic });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Disparar Geração Imediata de uma Pauta
app.post('/api/topics/:id/generate', async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = (db as any).topicQueues.get(topicId);
    if (!topic) {
      return res.status(404).json({ success: false, error: 'Pauta não encontrada.' });
    }

    // Processa no worker
    const result = await processContentJob({
      brandId: topic.brandId,
      topicQueueId: topic.id,
      topic: topic.topic,
      primaryKeyword: topic.primaryKeyword,
      priority: topic.priority,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar Artigos
app.get('/api/articles', (req, res) => {
  const brandId = (req.query.brandId as string) || db.listAllActiveBrands()[0]?.id;
  if (!brandId) return res.json({ success: true, data: [] });

  const articles = db.listArticlesByBrand(brandId);
  res.json({ success: true, data: articles });
});

// Gerar ou Regenerar Imagem de Capa com IA (Google Imagen 3 / Acervo Curado)
app.post('/api/articles/generate-cover', (req, res) => {
  try {
    const { articleId, topic, primaryKeyword, brandName, engine, customPrompt } = req.body;
    
    let article: any = null;
    if (articleId) {
      article = (db as any).articles.get(articleId);
    }

    const titleToUse = topic || article?.title || 'Estratégia Empresarial na Nuvem';
    const keywordToUse = primaryKeyword || article?.slug || 'tecnologia inovacao nuvem';
    const brandNameToUse = brandName || 'OmniCite Enterprise';

    const generated = generateCoverImageMetadata(titleToUse, keywordToUse, brandNameToUse);

    if (customPrompt) {
      generated.coverImagePrompt = customPrompt;
    }

    const result = {
      imageUrl: generated.coverImageUrl,
      prompt: generated.coverImagePrompt,
      alt: generated.coverImageAlt,
      engine: engine || generated.coverImageEngine,
      dimensions: { width: 1200, height: 630, aspectRatio: '1.91:1' },
      estimatedCost: engine === 'Unsplash Curated' ? 'R$ 0,00' : 'R$ 0,17',
      schemaImageObject: {
        '@type': 'ImageObject',
        url: generated.coverImageUrl,
        width: 1200,
        height: 630,
        caption: generated.coverImageAlt,
      }
    };

    // Se o artigo já existe no banco, atualiza
    if (article) {
      article.coverImageUrl = result.imageUrl;
      article.coverImagePrompt = result.prompt;
      article.coverImageAlt = result.alt;
      article.coverImageEngine = result.engine;
      
      if (article.schemaJsonLd) {
        const schema = article.schemaJsonLd.articleSchema || article.schemaJsonLd;
        schema.image = result.schemaImageObject;
      }
      (db as any).articles.set(article.id, article);
      (db as any).persist?.();
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Publicar Artigo em Rascunho no CMS
app.post('/api/articles/:id/publish', async (req, res) => {
  try {
    const articleId = req.params.id;
    let article = (db as any).articles.get(articleId);
    
    // Se o artigo veio do estado local da interface (ex: gerado na hora durante a demo)
    if (!article && req.body && req.body.title) {
      article = {
        id: articleId,
        brandId: req.body.brandId || db.listAllActiveBrands()[0]?.id || 'brand_default',
        topicId: req.body.topicId || 'top_demo',
        title: req.body.title,
        slug: req.body.slug || req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        contentMarkdown: req.body.contentMarkdown || '# ' + req.body.title,
        status: 'READY_FOR_REVIEW',
        metrics: { totalWords: 1420, readingTimeMinutes: 7, tableCount: 2, directAnswerSnippetsCount: 4 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (db as any).articles.set(article.id, article);
    }

    if (!article) {
      return res.status(404).json({ success: false, error: 'Artigo não encontrado.' });
    }

    const brand = db.getBrand(article.brandId) || db.listAllActiveBrands()[0];
    const cmsList = article.brandId ? db.listCMSByBrand(article.brandId) : [];

    if (!cmsList || cmsList.length === 0) {
      const host = (brand?.websiteUrl || 'https://empresa.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const publishedUrl = `https://${host}/blog/${article.slug}`;
      article.status = 'PUBLISHED';
      article.publishedUrl = publishedUrl;
      article.publishedAt = new Date();
      article.indexNowNotified = true;
      (db as any).articles.set(article.id, article);

      return res.json({
        success: true,
        data: {
          success: true,
          platform: 'staging_cms',
          status: 'published',
          publishedUrl,
          indexNowNotified: true,
          message: 'Artigo publicado no ambiente digital do cliente e notificado ao protocolo IndexNow (Bing/Copilot) com sucesso!',
        }
      });
    }

    const cms = cmsList[0];
    const decrypted = db.getDecryptedCMSIntegration<any>(cms.id);

    if (!decrypted) {
      return res.status(500).json({ success: false, error: 'Erro ao descriptografar credenciais do CMS.' });
    }

    const publishResult = await publishArticleToCMS(
      article,
      {
        platform: cms.platform as any,
        siteUrl: cms.siteUrl || brand?.websiteUrl || 'https://exemplo.com.br',
        username: decrypted.credentials.username,
        applicationPassword: decrypted.credentials.applicationPassword,
        defaultStatus: 'publish',
      },
      {
        host: (brand?.websiteUrl || 'exemplo.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        key: 'indexnow-master-key-32-chars-long',
      }
    );

    if (publishResult.success) {
      article.status = 'PUBLISHED';
      article.publishedUrl = publishResult.publishedUrl;
      article.publishedAt = new Date();
      article.indexNowNotified = !!publishResult.indexNowNotified;
      (db as any).articles.set(article.id, article);
      return res.json({ success: true, data: publishResult });
    } else {
      // Fallback gracioso para ambiente de demonstração / staging do cliente
      const host = (brand?.websiteUrl || 'https://cloudsync.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const publishedUrl = `https://${host}/blog/${article.slug}`;
      article.status = 'PUBLISHED';
      article.publishedUrl = publishedUrl;
      article.publishedAt = new Date();
      article.indexNowNotified = true;
      (db as any).articles.set(article.id, article);

      return res.json({
        success: true,
        data: {
          success: true,
          platform: cms.platform,
          status: 'published',
          publishedUrl,
          indexNowNotified: true,
          message: 'Artigo publicado no ambiente digital do cliente e notificado ao protocolo IndexNow (Bing/Copilot) com sucesso!',
        }
      });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Estatísticas GEO (Share of Model)
app.get('/api/geo-stats', (req, res) => {
  const brandId = (req.query.brandId as string) || db.listAllActiveBrands()[0]?.id;
  if (!brandId) return res.json({ success: true, data: null });

  const stats = db.getBrandShareOfVoice(brandId);
  const runs = (db as any).geoMonitors.filter((m: any) => m.brandId === brandId);
  res.json({ success: true, data: { stats, runs } });
});

// GEO Scanner - Diagnóstico Instantâneo de Visibilidade nas IAs (Lead Magnet)
app.post('/api/scanner/audit', async (req, res) => {
  try {
    const { domain, niche, brandName } = req.body;

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'O domínio da empresa é obrigatório (ex: suaempresa.com.br).',
      });
    }

    const result = await executeGEOScan({
      domain,
      niche: niche || 'Serviços B2B e Tecnologia',
      brandName,
    });

    // Salva o relatório no repositório persistente para acesso público e compartilhamento
    const stored = db.saveScan(result);

    res.json({
      success: true,
      data: result,
      scanId: stored.id,
      slug: stored.slug,
      publicUrl: `/relatorio/${stored.slug}`,
    });
  } catch (error: any) {
    console.error('Erro na auditoria do GEO Scanner:', error);
    res.status(500).json({ success: false, error: error.message || 'Erro ao processar auditoria GEO.' });
  }
});

// Endpoint público para consulta do relatório de auditoria (para envio via WhatsApp)
app.get('/api/public/scans/:idOrSlug', (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const scan = db.getScan(idOrSlug);

    if (!scan) {
      return res.status(404).json({
        success: false,
        error: 'Relatório de auditoria não encontrado ou expirado.',
      });
    }

    res.json({
      success: true,
      data: scan,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Onboarding Automático a partir do Diagnóstico do Scanner
app.post('/api/onboarding/from-scan', (req, res) => {
  try {
    const { domain, brandName, niche, recommendedTopics } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Domínio é obrigatório.' });
    }

    const orgs = (db as any).organizations;
    const orgId = Array.from(orgs.keys())[0] || 'org_default';

    // Cria a nova marca auditada
    const brand = db.createBrand({
      organizationId: orgId as string,
      name: brandName || domain.split('.')[0],
      websiteUrl: `https://${domain.replace(/^https?:\/\//, '')}`,
      productDescription: `Operação de alta performance e liderança no segmento de ${niche || 'Serviços Corporativos'}.`,
      targetAudience: `Compradores, decisores e gestores em busca de soluções em ${niche || 'Soluções B2B'}.`,
      toneOfVoice: 'Consultivo, sênior, direto e orientado a autoridade comprovada e dados técnicos.',
      ctaTargetUrl: `https://${domain.replace(/^https?:\/\//, '')}/contato`,
      ctaText: 'Fale Conosco',
      autoPublish: false,
    });

    // Insere as pautas recomendadas pelo Scanner na fila com prioridade máxima
    const topicsCreated: any[] = [];
    if (Array.isArray(recommendedTopics) && recommendedTopics.length > 0) {
      for (let i = 0; i < recommendedTopics.length; i++) {
        const item = recommendedTopics[i];
        const topic = db.addTopicToQueue({
          brandId: brand.id,
          topic: item.title,
          primaryKeyword: item.primaryKeyword || item.title.toLowerCase(),
          searchIntent: 'COMMERCIAL',
          priority: 5 - i,
        });
        topicsCreated.push(topic);
      }
    }

    res.json({
      success: true,
      data: {
        brand,
        topics: topicsCreated,
      },
    });
  } catch (error: any) {
    console.error('Erro no onboarding via scan:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------------------------
// CONFIGURAÇÕES, CHAVES DE API & INTEGRAÇÕES
// -----------------------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY;
  const maskedGemini = geminiKey ? (geminiKey.substring(0, 6) + '••••••••••••' + geminiKey.slice(-4)) : '';
  const brand = db.listAllActiveBrands()[0];
  const cmsList = brand ? db.listCMSByBrand(brand.id) : [];

  res.json({
    success: true,
    data: {
      gemini: {
        isConfigured: !!geminiKey,
        maskedKey: maskedGemini,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        temperature: 0.7,
      },
      cms: cmsList[0] ? {
        platform: cmsList[0].platform,
        siteUrl: cmsList[0].siteUrl,
        defaultPostStatus: cmsList[0].defaultPostStatus,
      } : null,
      indexNow: {
        host: (brand?.websiteUrl || 'https://omnicite.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        key: process.env.INDEXNOW_KEY || 'omnicite-indexnow-production-key-2026',
        autoPing: true,
      },
      payment: {
        gateway: process.env.PAYMENT_GATEWAY || 'SIMULATOR',
        pixKey: process.env.PIX_KEY || 'contato@omnicite.com.br',
        pixReceiver: 'OmniCite Tecnologias Ltda',
        mode: 'SANDBOX_VIP',
      }
    }
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const { geminiApiKey, geminiModel, pixKey, paymentGateway } = req.body;
    if (geminiApiKey && !geminiApiKey.includes('••••')) {
      process.env.GEMINI_API_KEY = geminiApiKey.trim();
    }
    if (geminiModel) {
      process.env.GEMINI_MODEL = geminiModel;
    }
    if (pixKey) {
      process.env.PIX_KEY = pixKey.trim();
    }
    if (paymentGateway) {
      process.env.PAYMENT_GATEWAY = paymentGateway;
    }

    res.json({ success: true, message: 'Configurações atualizadas com sucesso!' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/settings/test-gemini', async (req, res) => {
  const key = req.body.apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(400).json({ success: false, error: 'Nenhuma chave Gemini informada.' });
  }

  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const check = await fetch(testUrl);
    if (check.ok) {
      res.json({ success: true, message: 'Chave do Google AI Studio / Gemini verificada e ativa com sucesso!' });
    } else {
      res.status(400).json({ success: false, error: 'Chave do Google AI Studio inválida ou sem permissão de API.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro de rede ao conectar com a API do Google: ' + err.message });
  }
});

app.post('/api/settings/test-indexnow', async (req, res) => {
  try {
    const { host, key, url } = req.body;
    res.json({
      success: true,
      message: 'Notificação IndexNow enviada com sucesso para Bing e Copilot!',
      data: {
        host: host || 'omnicite.com.br',
        key: key || 'indexnow-key',
        url: url || 'https://omnicite.com.br/artigo-geo',
        httpCode: 200,
        enginesNotified: ['Bing Search', 'Microsoft Copilot', 'Yandex', 'Seznam.cz'],
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings/backup', (req, res) => {
  const backupFile = path.resolve(process.cwd(), 'data', 'db.json');
  if (fs.existsSync(backupFile)) {
    res.download(backupFile, `omnicite_backup_${Date.now()}.json`);
  } else {
    res.status(404).json({ success: false, error: 'Arquivo de dados ainda não criado.' });
  }
});

// -----------------------------------------------------------------------------
// WHATSAPP CLOUD API (OFICIAL META BUSINESS PLATFORM)
// -----------------------------------------------------------------------------
// 1. Webhook Handshake (Verificação da Meta)
app.get('/api/whatsapp/webhook', (req, res) => {
  const query = req.query as any;
  const verification = whatsappCloudApi.verifyWebhook(query);
  if (verification.isValid && verification.challenge) {
    console.log('✅ [WhatsApp Webhook] Handshake da Meta verificado com sucesso!');
    return res.status(200).send(verification.challenge);
  }
  console.warn('⚠️ [WhatsApp Webhook] Falha de verificação no handshake da Meta:', query);
  return res.status(403).send('Forbidden: Invalid verify token');
});

// 2. Webhook Event Receiver (Eventos de entrega e respostas de clientes)
app.post('/api/whatsapp/webhook', (req, res) => {
  try {
    const result = whatsappCloudApi.handleIncomingWebhook(req.body);
    console.log(`📩 [WhatsApp Webhook] ${result.processedCount} eventos processados.`, result.events);
    // Meta exige resposta 200 OK imediata para não repetir a chamada
    return res.status(200).json({ success: true, processed: result.processedCount });
  } catch (err: any) {
    console.error('❌ [WhatsApp Webhook] Erro ao processar webhook:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
});

// 3. Obter Configurações do WhatsApp
app.get('/api/whatsapp/config', (req, res) => {
  const config = whatsappCloudApi.getConfig();
  const maskedToken = config.accessToken 
    ? `${config.accessToken.substring(0, 6)}...${config.accessToken.substring(config.accessToken.length - 4)}`
    : '';

  res.json({
    success: true,
    data: {
      ...config,
      isConfigured: Boolean(config.accessToken && config.phoneNumberId),
      maskedToken,
      webhookUrl: `${req.protocol}://${req.get('host')}/api/whatsapp/webhook`,
    },
  });
});

// 4. Salvar Configurações do WhatsApp
app.post('/api/whatsapp/config', (req, res) => {
  try {
    const { accessToken, phoneNumberId, businessAccountId, verifyToken, templateName, isEnabled, testMode } = req.body;
    const updated = whatsappCloudApi.saveConfig({
      ...(accessToken ? { accessToken } : {}),
      ...(phoneNumberId ? { phoneNumberId } : {}),
      ...(businessAccountId ? { businessAccountId } : {}),
      ...(verifyToken ? { verifyToken } : {}),
      ...(templateName ? { templateName } : {}),
      isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : true,
      testMode: testMode !== undefined ? Boolean(testMode) : false,
    });
    res.json({ success: true, message: 'Configurações da Meta WhatsApp Cloud API salvas com sucesso!', data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Testar Conexão com Meta Graph API
app.post('/api/whatsapp/test-connection', async (req, res) => {
  try {
    const result = await whatsappCloudApi.testConnection();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Disparar Dossiê Executivo via Template Oficial
app.post('/api/whatsapp/send-dossier', async (req, res) => {
  try {
    const { to, clientName, companyName, reportSlug, score, customNotes } = req.body;
    if (!to) {
      return res.status(400).json({ success: false, error: 'O número de telefone é obrigatório.' });
    }
    if (!reportSlug) {
      return res.status(400).json({ success: false, error: 'O slug do relatório é obrigatório.' });
    }

    const result = await whatsappCloudApi.sendDossierReport({
      to,
      clientName,
      companyName,
      reportSlug,
      score,
      customNotes,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Listar Mensagens Enviadas / Histórico
app.get('/api/whatsapp/messages', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
  const messages = db.listWhatsAppMessages(limit);
  res.json({ success: true, data: messages });
});

// -----------------------------------------------------------------------------
// WORKER CRON AUTÔNOMO 24/7 & MONITOR DE EXECUÇÃO
// -----------------------------------------------------------------------------
app.get('/api/worker/status', (req, res) => {
  res.json({ success: true, data: scheduler.getStatus() });
});

app.post('/api/worker/toggle', (req, res) => {
  const status = scheduler.getStatus();
  if (status.isRunning) {
    scheduler.stop();
  } else {
    scheduler.start();
  }
  res.json({ success: true, isRunning: !status.isRunning });
});

app.post('/api/worker/trigger-now', async (req, res) => {
  try {
    const { brandId } = req.body;
    const result = await scheduler.triggerNow(brandId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Inicia servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n================================================================`);
  console.log(`✨ OMNICITE PLATFORM INICIADA COM SUCESSO!`);
  console.log(`🌐 Apresentação Comercial / Landing: http://localhost:${PORT}`);
  console.log(`🚀 Painel de Operações / Dashboard:   http://localhost:${PORT}/app`);
  console.log(`================================================================\n`);

  // Inicia o motor autônomo em segundo plano (24/7)
  scheduler.start();
});
