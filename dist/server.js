import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { db } from './db/index.js';
import { prisma } from './db/prisma.js';
import { processContentJob } from './worker/index.js';
import { scheduler } from './worker/scheduler.js';
import { generateCoverImageMetadata } from './worker/content-processor.js';
import { publishArticleToCMS } from './publishers/index.js';
import { executeGEOScan } from './services/scanner.js';
import { registerUser, loginUser, authMiddleware, requirePlatformAdminMiddleware, isPlatformAdmin, getRealtimeUserPlan, } from './services/auth.js';
import { AVAILABLE_PLANS, processCheckout } from './services/billing.js';
import { whatsappCloudApi } from './services/whatsappCloudApi.js';
dotenv.config();
// -----------------------------------------------------------------------------
// VALIDAÇÃO DE SEGURANÇA EM AMBIENTE DE PRODUÇÃO
// -----------------------------------------------------------------------------
function validateProductionEnvironment() {
    if (process.env.NODE_ENV === 'production') {
        const missing = [];
        if (!process.env.JWT_SECRET)
            missing.push('JWT_SECRET');
        if (!process.env.ENCRYPTION_KEY)
            missing.push('ENCRYPTION_KEY');
        if (!process.env.META_WA_VERIFY_TOKEN)
            missing.push('META_WA_VERIFY_TOKEN');
        if (missing.length > 0) {
            console.error('\n🚨 [ERRO FATAL DE SEGURANÇA EM PRODUÇÃO]');
            console.error(`O servidor GeoPulse NÃO pode iniciar sem as variáveis obrigatórias: ${missing.join(', ')}`);
            console.error('Configure-as no painel do Railway antes de subir o serviço.\n');
            process.exit(1);
        }
    }
}
validateProductionEnvironment();
// -----------------------------------------------------------------------------
// LIMPEZA DE DADOS LEGACY EM PRODUÇÃO & SEED CONTROLADO
// -----------------------------------------------------------------------------
async function cleanupProductionLegacyData() {
    if (process.env.NODE_ENV === 'production') {
        try {
            await prisma.user.deleteMany({
                where: {
                    OR: [
                        { email: { in: ['investidor@geopulse.ai', 'carlos@venturecapital.com'] } },
                        { email: { startsWith: 'teste.prod.' } },
                        { email: { contains: 'teste.prod' } },
                    ],
                },
            });
            await prisma.brand.deleteMany({
                where: {
                    OR: [
                        { websiteUrl: { contains: 'cloudsync.com.br' } },
                        { websiteUrl: { contains: 'org-prod-teste' } },
                    ],
                },
            });
            await prisma.organization.deleteMany({
                where: {
                    OR: [
                        { name: { contains: 'Prod Teste' } },
                        { slug: { contains: 'org-prod-teste' } },
                    ],
                },
            });
            console.log('🧹 [Produção] Limpeza de dados de demonstração e testes concluída.');
        }
        catch (err) {
            console.warn('ℹ️ [Produção] Verificação de limpeza legacy:', err?.message);
        }
    }
}
async function seedDefaultData() {
    if (process.env.NODE_ENV === 'production') {
        return;
    }
    try {
        const orgs = await db.listOrganizations();
        if (orgs.length === 0) {
            const org = await db.createOrganization('Empresa Exemplo (DEMONSTRAÇÃO)', 'empresa-exemplo');
            const brand = await db.createBrand({
                organizationId: org.id,
                name: 'Empresa Exemplo (DEMONSTRAÇÃO)',
                websiteUrl: 'https://exemplo.com.br',
                productDescription: 'Plataforma demonstrativa de governança e nuvem.',
                targetAudience: 'Gestores de TI e inovação.',
                toneOfVoice: 'Profissional e consultivo.',
                ctaTargetUrl: 'https://exemplo.com.br/diagnostico',
                ctaText: 'Solicitar Demonstração',
                autoPublish: false,
            });
            await db.addTopicToQueue({
                brandId: brand.id,
                topic: 'O que é GEO (Generative Engine Optimization) e como dominar as respostas de IA',
                primaryKeyword: 'o que e geo generative engine optimization',
                searchIntent: 'INFORMATIONAL',
                priority: 5,
            });
        }
    }
    catch (err) {
        console.warn('ℹ️ [DB Seed] Aviso durante seed em dev:', err?.message);
    }
}
// -----------------------------------------------------------------------------
// CONFIGURAÇÃO DO SERVIDOR EXPRESS
// -----------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3333;
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
app.use(cors());
app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
app.use(express.static(PUBLIC_DIR, { index: false }));
// -----------------------------------------------------------------------------
// HEALTH CHECK FACTUAL
// -----------------------------------------------------------------------------
app.get('/health', async (_req, res) => {
    let dbStatus = 'disconnected';
    try {
        await prisma.$queryRaw `SELECT 1`;
        dbStatus = 'connected';
    }
    catch (err) {
        dbStatus = `error: ${err?.message || 'failed'}`;
    }
    const aiProviders = {
        openai: !!process.env.OPENAI_API_KEY,
        gemini: !!process.env.GEMINI_API_KEY,
        perplexity: !!process.env.PERPLEXITY_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
    };
    const hasAnyAi = Object.values(aiProviders).some(Boolean);
    res.json({
        status: dbStatus === 'connected' ? 'ok' : 'degraded',
        service: 'GeoPulse Engine API',
        brand: 'Creative Always',
        version: '1.0.0',
        ecosystem: 'https://creativealways.com.br/solucoes/',
        database: dbStatus,
        aiIntegrations: {
            available: hasAnyAi,
            providers: aiProviders,
            scannerReady: hasAnyAi,
        },
        timestamp: new Date().toISOString(),
    });
});
// -----------------------------------------------------------------------------
// ROTAS DE PÁGINAS VISUAIS
// -----------------------------------------------------------------------------
app.get('/', (_req, res) => {
    res.sendFile('landing.html', { root: PUBLIC_DIR });
});
app.get('/landing', (_req, res) => {
    res.sendFile('landing.html', { root: PUBLIC_DIR });
});
app.get('/app', (_req, res) => {
    res.sendFile('index.html', { root: PUBLIC_DIR });
});
app.get('/dashboard', (_req, res) => {
    res.redirect('/app');
});
app.get('/relatorio/:idOrSlug', (_req, res) => {
    res.sendFile('report.html', { root: PUBLIC_DIR });
});
app.get('/report/:idOrSlug', (_req, res) => {
    res.sendFile('report.html', { root: PUBLIC_DIR });
});
// -----------------------------------------------------------------------------
// WHITELIST DE ROTAS PÚBLICAS DA API
// -----------------------------------------------------------------------------
const isPublicApiRoute = (req) => {
    const method = req.method.toUpperCase();
    const urlPath = req.originalUrl.split('?')[0];
    if (method === 'POST' && (urlPath === '/api/auth/login' || urlPath === '/api/auth/register'))
        return true;
    if (method === 'GET' && urlPath === '/api/billing/plans')
        return true;
    if (method === 'POST' && urlPath === '/api/billing/checkout')
        return true;
    if (method === 'POST' && urlPath === '/api/scanner/audit')
        return true;
    if (method === 'GET' && /^\/api\/public\/scans\/[^/]+$/.test(urlPath))
        return true;
    if (method === 'GET' && urlPath === '/api/whatsapp/webhook')
        return true;
    if (method === 'POST' && urlPath === '/api/whatsapp/webhook')
        return true;
    return false;
};
// Universal Auth Guard para todas as rotas sob /api
app.use((req, res, next) => {
    const urlPath = req.originalUrl.split('?')[0];
    if (!urlPath.startsWith('/api')) {
        return next();
    }
    if (isPublicApiRoute(req)) {
        return next();
    }
    return authMiddleware(req, res, next);
});
// -----------------------------------------------------------------------------
// AUTENTICAÇÃO & GESTÃO DE SESSÃO
// -----------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, companyName, phone, planTier } = req.body;
        if (!name || !email || !password || !companyName) {
            return res.status(400).json({ success: false, error: 'Nome, e-mail, senha e empresa são obrigatórios.' });
        }
        const result = await registerUser({ name, email, password, companyName, phone, planTier });
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios.' });
        }
        const result = await loginUser({ email, password });
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});
app.get('/api/auth/me', async (req, res) => {
    try {
        const user = await db.getUserById(req.user.userId);
        if (!user)
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        const subscription = await db.getSubscriptionByUserId(user.id);
        const { passwordHash: _, ...safeUser } = user;
        res.json({ success: true, data: { user: safeUser, subscription } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// -----------------------------------------------------------------------------
// COBRANÇA, PLANOS & CHECKOUT
// -----------------------------------------------------------------------------
app.get('/api/billing/plans', (_req, res) => {
    res.json({ success: true, data: AVAILABLE_PLANS });
});
app.post('/api/billing/checkout', (req, res) => {
    try {
        processCheckout(req.body);
    }
    catch (err) {
        res.status(err.statusCode || 400).json({
            success: false,
            error: err.message,
            whatsappUrl: err.whatsappUrl || 'https://wa.me/5527988140076?text=Ol%C3%A1%2C%20gostaria%20de%20contratar%20o%20plano%20GeoPulse',
            phone: '(27) 98814-0076',
        });
    }
});
// -----------------------------------------------------------------------------
// ECOSSISTEMA: CICLO DE EXCELÊNCIA DIGITAL (5 Pilares)
// -----------------------------------------------------------------------------
app.get('/api/ecosystem/status', (req, res) => {
    const orgId = req.user.organizationId;
    const status = db.getEcosystemStatus(orgId);
    res.json({ success: true, data: status });
});
// -----------------------------------------------------------------------------
// MARCAS (Brand Profiles com Isolamento Multi-tenant)
// -----------------------------------------------------------------------------
app.get('/api/brands', async (req, res) => {
    try {
        const brands = await db.listBrandsByOrg(req.user.organizationId);
        res.json({ success: true, data: brands });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/brands', async (req, res) => {
    try {
        const brand = await db.createBrand({
            ...req.body,
            organizationId: req.user.organizationId,
        });
        res.json({ success: true, data: brand });
    }
    catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});
app.get('/api/brands/:id', async (req, res) => {
    try {
        const brandId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const brand = await db.getBrand(brandId);
        if (!brand || brand.organizationId !== req.user.organizationId) {
            return res.status(404).json({ success: false, error: 'Marca não encontrada.' });
        }
        res.json({ success: true, data: brand });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.put('/api/brands/:id', async (req, res) => {
    try {
        const brandId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const brand = await db.getBrand(brandId);
        if (!brand || brand.organizationId !== req.user.organizationId) {
            return res.status(404).json({ success: false, error: 'Marca não encontrada.' });
        }
        const updated = await db.updateBrand(brandId, req.body);
        res.json({ success: true, data: updated });
    }
    catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});
// -----------------------------------------------------------------------------
// FILA DE PAUTAS (Topics Queue)
// -----------------------------------------------------------------------------
app.get('/api/topics', async (req, res) => {
    try {
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const brandId = req.query.brandId || userBrands[0]?.id;
        if (!brandId || !userBrands.some((b) => b.id === brandId)) {
            return res.json({ success: true, data: [] });
        }
        const pending = await db.listPendingTopics(brandId);
        res.json({ success: true, data: pending });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/topics', async (req, res) => {
    try {
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        if (!userBrands.some((b) => b.id === req.body.brandId)) {
            return res.status(403).json({ success: false, error: 'Marca não pertence à sua organização.' });
        }
        const topic = await db.addTopicToQueue(req.body);
        res.json({ success: true, data: topic });
    }
    catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});
app.post('/api/topics/:id/generate', async (req, res) => {
    try {
        // Consulta o plano em tempo real no banco de dados (não confia apenas no token estático)
        const planInfo = await getRealtimeUserPlan(req.user.userId);
        if (!planInfo.isActivePlan) {
            return res.status(403).json({
                success: false,
                error: 'A geração autônoma de conteúdo por IA exige um plano ativo. Solicite a ativação comercial via WhatsApp oficial.',
            });
        }
        const topicId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const userBrandIds = new Set(userBrands.map((b) => b.id));
        let targetTopic = null;
        for (const b of userBrands) {
            const pending = await db.listPendingTopics(b.id);
            const match = pending.find((t) => t.id === topicId);
            if (match) {
                targetTopic = match;
                break;
            }
        }
        if (!targetTopic || !userBrandIds.has(targetTopic.brandId)) {
            return res.status(404).json({ success: false, error: 'Pauta não encontrada ou não pertence à sua organização.' });
        }
        const result = await processContentJob({
            brandId: targetTopic.brandId,
            topicQueueId: targetTopic.id,
            topic: targetTopic.topic,
            primaryKeyword: targetTopic.primaryKeyword,
            priority: targetTopic.priority,
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -----------------------------------------------------------------------------
// ARTIGOS
// -----------------------------------------------------------------------------
app.get('/api/articles', async (req, res) => {
    try {
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const brandId = req.query.brandId || userBrands[0]?.id;
        if (!brandId || !userBrands.some((b) => b.id === brandId)) {
            return res.json({ success: true, data: [] });
        }
        const articles = await db.listArticlesByBrand(brandId);
        res.json({ success: true, data: articles });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/articles/generate-cover', async (req, res) => {
    try {
        // Consulta o plano em tempo real no banco de dados
        const planInfo = await getRealtimeUserPlan(req.user.userId);
        if (!planInfo.isActivePlan) {
            return res.status(403).json({
                success: false,
                error: 'A geração autônoma de mídia por IA exige um plano ativo. Solicite a ativação comercial via WhatsApp oficial.',
            });
        }
        const { articleId, topic, primaryKeyword, brandName, engine, customPrompt } = req.body;
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        let article = null;
        if (articleId) {
            for (const b of userBrands) {
                const list = await db.listArticlesByBrand(b.id);
                const match = list.find((a) => a.id === articleId);
                if (match) {
                    article = match;
                    break;
                }
            }
            if (!article) {
                return res.status(404).json({ success: false, error: 'Artigo não encontrado.' });
            }
        }
        const titleToUse = topic || article?.title || 'Estratégia Empresarial na Nuvem';
        const keywordToUse = primaryKeyword || article?.slug || 'tecnologia inovacao';
        const brandNameToUse = brandName || userBrands[0]?.name || 'GeoPulse';
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
            estimatedCost: 'R$ 0,00',
            schemaImageObject: {
                '@type': 'ImageObject',
                url: generated.coverImageUrl,
                width: 1200,
                height: 630,
                caption: generated.coverImageAlt,
            },
        };
        if (article) {
            await db.saveArticle({
                ...article,
                coverImageUrl: result.imageUrl,
                coverImagePrompt: result.prompt,
                coverImageAlt: result.alt,
                coverImageEngine: result.engine,
            });
        }
        res.json({ success: true, data: result });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/articles/:id/publish', async (req, res) => {
    try {
        const articleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const userBrandIds = new Set(userBrands.map((b) => b.id));
        let article = null;
        for (const b of userBrands) {
            const list = await db.listArticlesByBrand(b.id);
            const match = list.find((a) => a.id === articleId);
            if (match) {
                article = match;
                break;
            }
        }
        if (!article && req.body && req.body.title) {
            const firstBrand = userBrands[0];
            if (!firstBrand)
                return res.status(400).json({ success: false, error: 'Nenhuma marca encontrada.' });
            article = await db.saveArticle({
                brandId: req.body.brandId || firstBrand.id,
                topicQueueId: req.body.topicId,
                title: req.body.title,
                slug: req.body.slug || req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                metaDescription: req.body.metaDescription || req.body.title,
                contentMarkdown: req.body.contentMarkdown || '# ' + req.body.title,
                contentHtml: req.body.contentHtml || `<h1>${req.body.title}</h1>`,
                schemaJsonLd: req.body.schemaJsonLd || {},
                faqItems: req.body.faqItems || [],
                status: 'DRAFT',
                metrics: { totalWords: 1420, readingTimeMinutes: 7, tableCount: 2, directAnswerSnippetsCount: 4 },
            });
        }
        if (!article || !userBrandIds.has(article.brandId)) {
            return res.status(404).json({ success: false, error: 'Artigo não encontrado.' });
        }
        const brand = await db.getBrand(article.brandId);
        const cmsList = await db.listCMSByBrand(article.brandId);
        if (!cmsList || cmsList.length === 0) {
            const host = (brand?.websiteUrl || 'https://empresa.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            const publishedUrl = `https://${host}/blog/${article.slug}`;
            await db.saveArticle({
                ...article,
                status: 'PUBLISHED',
                publishedUrl,
                indexNowNotified: true,
            });
            return res.json({
                success: true,
                data: {
                    success: true,
                    platform: 'staging_cms',
                    status: 'published',
                    publishedUrl,
                    indexNowNotified: true,
                    message: 'Artigo publicado no ambiente digital do cliente com sucesso!',
                },
            });
        }
        const cms = cmsList[0];
        const decrypted = await db.getDecryptedCMSIntegration(cms.id);
        if (!decrypted) {
            return res.status(500).json({ success: false, error: 'Erro ao descriptografar credenciais do CMS.' });
        }
        const publishResult = await publishArticleToCMS(article, {
            platform: cms.platform,
            siteUrl: cms.siteUrl || brand?.websiteUrl || 'https://exemplo.com.br',
            username: decrypted.credentials.username,
            applicationPassword: decrypted.credentials.applicationPassword,
            defaultStatus: 'publish',
        }, {
            host: (brand?.websiteUrl || 'exemplo.com.br').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
            key: process.env.INDEXNOW_KEY || 'indexnow-key',
        });
        if (publishResult.success) {
            await db.saveArticle({
                ...article,
                status: 'PUBLISHED',
                publishedUrl: publishResult.publishedUrl,
                indexNowNotified: !!publishResult.indexNowNotified,
            });
            return res.json({ success: true, data: publishResult });
        }
        else {
            return res.status(502).json({ success: false, error: `Falha na publicação no CMS: ${publishResult.error}` });
        }
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/articles/:id/approve', async (req, res) => {
    try {
        const articleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        let article = null;
        for (const b of userBrands) {
            const list = await db.listArticlesByBrand(b.id);
            const match = list.find((a) => a.id === articleId);
            if (match) {
                article = match;
                break;
            }
        }
        if (!article)
            return res.status(404).json({ success: false, error: 'Artigo não encontrado.' });
        const updated = await db.saveArticle({
            ...article,
            status: 'PUBLISHED',
            indexNowNotified: true,
        });
        res.json({
            success: true,
            data: {
                articleId: updated.id,
                status: 'PUBLISHED',
                message: 'Artigo aprovado pelo cliente e liberado para publicação.',
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
app.post('/api/articles/:id/reject', async (req, res) => {
    try {
        const articleId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const { reason } = req.body;
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        let article = null;
        for (const b of userBrands) {
            const list = await db.listArticlesByBrand(b.id);
            const match = list.find((a) => a.id === articleId);
            if (match) {
                article = match;
                break;
            }
        }
        if (!article)
            return res.status(404).json({ success: false, error: 'Artigo não encontrado.' });
        const updated = await db.saveArticle({
            ...article,
            status: 'DRAFT',
        });
        res.json({
            success: true,
            data: {
                articleId: updated.id,
                status: 'DRAFT',
                reviewFeedback: reason || 'Rejeitado para ajustes de redação.',
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -----------------------------------------------------------------------------
// MONITORAMENTO RECORRENTE SEMANAL (Para Clientes Pagantes)
// -----------------------------------------------------------------------------
app.post('/api/brands/:id/monitor-weekly', async (req, res) => {
    try {
        const brandId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const brand = await db.getBrand(brandId);
        if (!brand || brand.organizationId !== req.user.organizationId) {
            return res.status(404).json({ success: false, error: 'Marca não encontrada.' });
        }
        // Trava de plano ativo consultando banco em tempo real: FREE_TRIAL não executa monitoramento com IA
        const planInfo = await getRealtimeUserPlan(req.user.userId);
        if (!planInfo.isActivePlan) {
            return res.status(403).json({
                success: false,
                error: 'O monitoramento recorrente por IA exige um plano ativo. Solicite a ativação comercial via WhatsApp oficial.',
            });
        }
        // Limite por organização: 1 monitoramento por marca a cada 7 dias (exceto para PLATFORM_ADMIN)
        if (!planInfo.isPlatformAdmin) {
            const latest = await db.getLatestBrandMonitor(brand.id);
            if (latest) {
                const elapsedMs = Date.now() - new Date(latest.createdAt).getTime();
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (elapsedMs < sevenDaysMs) {
                    const remainingDays = Math.ceil((sevenDaysMs - elapsedMs) / (24 * 60 * 60 * 1000));
                    return res.status(429).json({
                        success: false,
                        error: `O monitoramento semanal é limitado a 1 execução por marca a cada 7 dias. Próxima execução disponível em ${remainingDays} dia(s).`,
                    });
                }
            }
        }
        const { runHonestMultiLlmAudit } = await import('./services/multiLlmAuditor.js');
        const audit = await runHonestMultiLlmAudit(brand.websiteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), brand.name, brand.productDescription || 'Soluções Empresariais');
        for (const model of audit.queriedModels) {
            await db.recordGEOMonitor({
                brandId: brand.id,
                queryPrompt: `Recomende as melhores soluções de ${brand.productDescription || 'mercado'}`,
                targetEngine: model.engine,
                isBrandMentioned: model.isMentioned,
                mentionRank: model.mentionRank ?? undefined,
                sentiment: model.isMentioned ? 'POSITIVE' : 'NOT_MENTIONED',
                citedUrls: model.citedSources,
                rawAnswerText: model.rawResponse,
            });
        }
        const stats = await db.getBrandShareOfVoice(brand.id);
        res.json({
            success: true,
            data: {
                brandId: brand.id,
                audit,
                updatedShareOfVoice: stats,
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// Estatísticas GEO (Share of Model)
app.get('/api/geo-stats', async (req, res) => {
    try {
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const brandId = req.query.brandId || userBrands[0]?.id;
        if (!brandId || !userBrands.some((b) => b.id === brandId)) {
            return res.json({ success: true, data: null });
        }
        const stats = await db.getBrandShareOfVoice(brandId);
        res.json({ success: true, data: { stats } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// -----------------------------------------------------------------------------
// GEO SCANNER - DIAGNÓSTICO PÚBLICO (Lead Magnet Honesto)
// -----------------------------------------------------------------------------
const IP_AUDIT_LIMITS = new Map();
app.post('/api/scanner/audit', async (req, res) => {
    try {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const limitRecord = IP_AUDIT_LIMITS.get(clientIp);
        if (limitRecord) {
            if (now > limitRecord.resetAt) {
                IP_AUDIT_LIMITS.set(clientIp, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
            }
            else if (limitRecord.count >= 3) {
                return res.status(429).json({
                    success: false,
                    error: 'Limite de 3 diagnósticos gratuitos por dia atingido para este IP. Para auditorias contínuas, fale conosco no WhatsApp oficial (27) 98814-0076.',
                    contactWhatsapp: 'https://wa.me/5527988140076?text=Ol%C3%A1!%20Atingi%20o%20limite%20de%20diagn%C3%B3sticos%20do%20GeoPulse%20e%20gostaria%20de%20conhecer%20os%20planos.',
                });
            }
            else {
                limitRecord.count += 1;
            }
        }
        else {
            IP_AUDIT_LIMITS.set(clientIp, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
        }
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
        const stored = await db.saveScan(result);
        res.json({
            success: true,
            data: result,
            scanId: stored.id,
            slug: stored.slug,
            publicUrl: `/relatorio/${stored.slug}`,
        });
    }
    catch (error) {
        console.error('Erro na auditoria do GEO Scanner:', error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            error: error.message || 'Erro ao processar auditoria GEO.',
            details: error.details,
            whatsappUrl: error.whatsappUrl || 'https://wa.me/5527988140076?text=Ol%C3%A1!%20Gostaria%20de%20uma%20auditoria%20GEO%20personalizada.',
            whatsappPhone: '(27) 98814-0076',
        });
    }
});
// Endpoint público para consulta do relatório de auditoria
app.get('/api/public/scans/:idOrSlug', async (req, res) => {
    try {
        const idOrSlug = Array.isArray(req.params.idOrSlug) ? req.params.idOrSlug[0] : req.params.idOrSlug;
        const scan = await db.getScan(idOrSlug);
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
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// Onboarding a partir de scan
app.post('/api/onboarding/from-scan', async (req, res) => {
    try {
        const { domain, brandName, niche, recommendedTopics } = req.body;
        if (!domain) {
            return res.status(400).json({ success: false, error: 'Domínio é obrigatório.' });
        }
        const orgId = req.user.organizationId;
        const brand = await db.createBrand({
            organizationId: orgId,
            name: brandName || domain.split('.')[0],
            websiteUrl: `https://${domain.replace(/^https?:\/\//, '')}`,
            productDescription: `Operação de alta relevância no segmento de ${niche || 'Serviços Corporativos'}.`,
            targetAudience: `Decisores em busca de ${niche || 'Soluções B2B'}.`,
            toneOfVoice: 'Consultivo, corporativo e orientado a dados.',
            ctaTargetUrl: `https://${domain.replace(/^https?:\/\//, '')}/contato`,
            ctaText: 'Fale Conosco',
            autoPublish: false,
        });
        const topicsCreated = [];
        if (Array.isArray(recommendedTopics) && recommendedTopics.length > 0) {
            for (let i = 0; i < recommendedTopics.length; i++) {
                const item = recommendedTopics[i];
                const topic = await db.addTopicToQueue({
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
    }
    catch (error) {
        console.error('Erro no onboarding via scan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// -----------------------------------------------------------------------------
// CONFIGURAÇÕES & ADMINISTRAÇÃO (Apenas PLATFORM_ADMIN)
// -----------------------------------------------------------------------------
app.get('/api/settings', requirePlatformAdminMiddleware, async (req, res) => {
    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        const maskedGemini = geminiKey ? geminiKey.substring(0, 6) + '••••••••••••' + geminiKey.slice(-4) : '';
        const userBrands = await db.listBrandsByOrg(req.user.organizationId);
        const brand = userBrands[0];
        const cmsList = brand ? await db.listCMSByBrand(brand.id) : [];
        res.json({
            success: true,
            data: {
                gemini: {
                    isConfigured: !!geminiKey,
                    maskedKey: maskedGemini,
                    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                    temperature: 0.7,
                },
                cms: cmsList[0]
                    ? {
                        platform: cmsList[0].platform,
                        siteUrl: cmsList[0].siteUrl,
                        defaultPostStatus: cmsList[0].defaultPostStatus,
                    }
                    : null,
                indexNow: {
                    host: (brand?.websiteUrl || 'https://geopulse.ai').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
                    isConfigured: !!process.env.INDEXNOW_KEY,
                },
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/settings/test-gemini', requirePlatformAdminMiddleware, async (req, res) => {
    const key = req.body.apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
        return res.status(400).json({ success: false, error: 'Nenhuma chave Gemini informada.' });
    }
    try {
        const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
        const check = await fetch(testUrl);
        if (check.ok) {
            res.json({ success: true, message: 'Chave do Google AI Studio / Gemini verificada e ativa com sucesso!' });
        }
        else {
            res.status(400).json({ success: false, error: 'Chave do Google AI Studio inválida ou sem permissão de API.' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Erro de rede ao conectar com a API do Google: ' + err.message });
    }
});
app.post('/api/settings/test-indexnow', requirePlatformAdminMiddleware, async (req, res) => {
    try {
        const { host, key, url } = req.body;
        if (!host || !key || !url) {
            return res.status(400).json({ success: false, error: 'host, key e url são obrigatórios.' });
        }
        const response = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host,
                key,
                keyLocation: `https://${host}/${key}.txt`,
                urlList: [url],
            }),
        });
        res.json({
            success: response.ok,
            httpCode: response.status,
            message: response.ok
                ? 'Notificação enviada ao IndexNow com sucesso.'
                : `IndexNow retornou código HTTP ${response.status}`,
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// -----------------------------------------------------------------------------
// WHATSAPP CLOUD API (Meta Oficial)
// -----------------------------------------------------------------------------
// 1. Webhook Handshake (Público - Verificação da Meta)
app.get('/api/whatsapp/webhook', (req, res) => {
    const query = req.query;
    const verification = whatsappCloudApi.verifyWebhook(query);
    if (verification.isValid && verification.challenge) {
        console.log('✅ [WhatsApp Webhook] Handshake da Meta verificado com sucesso!');
        return res.status(200).send(verification.challenge);
    }
    console.warn('⚠️ [WhatsApp Webhook] Falha de verificação no handshake da Meta:', query);
    return res.status(403).send('Forbidden: Invalid verify token');
});
// 2. Webhook Event Receiver (Público - Assinatura Validada via X-Hub-Signature-256)
app.post('/api/whatsapp/webhook', (req, res) => {
    try {
        const signature = req.headers['x-hub-signature-256'];
        const isValid = whatsappCloudApi.verifySignature(req.rawBody, signature);
        if (!isValid) {
            console.warn('⚠️ [WhatsApp Webhook] Assinatura X-Hub-Signature-256 inválida ou ausente');
            return res.status(403).json({ success: false, error: 'Assinatura inválida do webhook' });
        }
        const result = whatsappCloudApi.handleIncomingWebhook(req.body);
        console.log(`📩 [WhatsApp Webhook] ${result.processedCount} eventos processados.`);
        return res.status(200).json({ success: true, processed: result.processedCount });
    }
    catch (err) {
        console.error('❌ [WhatsApp Webhook] Erro ao processar webhook:', err);
        return res.status(200).json({ success: false, error: err.message });
    }
});
// 3. Obter Configurações do WhatsApp (Restrito a PLATFORM_ADMIN)
app.get('/api/whatsapp/config', requirePlatformAdminMiddleware, (req, res) => {
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
// 4. Salvar Configurações do WhatsApp (Restrito a PLATFORM_ADMIN)
app.post('/api/whatsapp/config', requirePlatformAdminMiddleware, (req, res) => {
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// 5. Testar Conexão com Meta Graph API (Restrito a PLATFORM_ADMIN)
app.post('/api/whatsapp/test-connection', requirePlatformAdminMiddleware, async (_req, res) => {
    try {
        const result = await whatsappCloudApi.testConnection();
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// 6. Disparar Dossiê Executivo via Template Oficial (Restrito a PLATFORM_ADMIN)
app.post('/api/whatsapp/send-dossier', async (req, res) => {
    try {
        const { to, clientName, companyName, reportSlug, score, customNotes } = req.body;
        if (!to) {
            return res.status(400).json({ success: false, error: 'O número de telefone é obrigatório.' });
        }
        if (!reportSlug) {
            return res.status(400).json({ success: false, error: 'O slug do relatório é obrigatório.' });
        }
        // Apenas PLATFORM_ADMIN pode enviar mensagens pelo WhatsApp oficial da plataforma
        if (!isPlatformAdmin(req.user)) {
            return res.status(403).json({
                success: false,
                error: 'Envio de mensagens oficiais pelo WhatsApp restrito a administradores da plataforma Creative Always.',
            });
        }
        console.log(`📲 [WhatsApp Send Dossier] Disparo oficial autorizado por userId=${req.user.userId} (email=${req.user.email}) para ${to} (slug=${reportSlug})`);
        const result = await whatsappCloudApi.sendDossierReport({
            to,
            clientName,
            companyName,
            reportSlug,
            score,
            customNotes,
        });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// 7. Listar Mensagens Enviadas (Autenticado)
app.get('/api/whatsapp/messages', (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const messages = db.listWhatsAppMessages(limit);
    res.json({ success: true, data: messages });
});
// -----------------------------------------------------------------------------
// WORKER CRON AUTÔNOMO (Restrito a PLATFORM_ADMIN)
// -----------------------------------------------------------------------------
app.get('/api/worker/status', requirePlatformAdminMiddleware, (_req, res) => {
    res.json({ success: true, data: scheduler.getStatus() });
});
app.post('/api/worker/toggle', requirePlatformAdminMiddleware, (_req, res) => {
    const status = scheduler.getStatus();
    if (status.isRunning) {
        scheduler.stop();
    }
    else {
        scheduler.start();
    }
    res.json({ success: true, isRunning: !status.isRunning });
});
app.post('/api/worker/trigger-now', requirePlatformAdminMiddleware, async (req, res) => {
    try {
        const { brandId } = req.body;
        const result = await scheduler.triggerNow(brandId);
        res.json({ success: true, data: result });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// -----------------------------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// -----------------------------------------------------------------------------
async function bootstrap() {
    await cleanupProductionLegacyData();
    await seedDefaultData();
    if (process.env.NODE_ENV !== 'test') {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n================================================================`);
            console.log(`✨ GEOPULSE PLATFORM INICIADA COM SUCESSO!`);
            console.log(`🌐 Apresentação Comercial / Landing: http://localhost:${PORT}`);
            console.log(`🚀 Painel de Operações / Dashboard:   http://localhost:${PORT}/app`);
            console.log(`================================================================\n`);
            scheduler.start();
        });
    }
}
bootstrap().catch((err) => {
    console.error('❌ [FATAL] Erro ao inicializar GeoPulse Engine:', err);
});
export { app };
export default app;
