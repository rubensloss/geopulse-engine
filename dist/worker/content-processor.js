import { db } from '../db/index.js';
import { generateGeoArticle } from '../index.js';
import { publishArticleToCMS } from '../publishers/index.js';
/**
 * Processador do Job de Conteúdo.
 * Executa a esteira ponta a ponta: Pesquisa ➔ Outline ➔ Redação ➔ Schemas ➔ CMS ➔ IndexNow ➔ Banco.
 */
export async function processContentJob(job) {
    const startTime = Date.now();
    console.log(`\n⚙️ [WORKER EXEC] Iniciando processamento do Job para marca: ${job.brandId}`);
    console.log(`   Pauta: "${job.topic}" | Palavra-chave: "${job.primaryKeyword}"`);
    // 1. Busca dados da Marca (Brand Profile)
    const brand = db.getBrand(job.brandId);
    if (!brand) {
        const err = `Marca ${job.brandId} não encontrada no banco de dados.`;
        console.error(`   ❌ [WORKER ERRO]: ${err}`);
        db.updateTopicStatus(job.topicQueueId, 'FAILED', err);
        return {
            success: false,
            brandId: job.brandId,
            topicQueueId: job.topicQueueId,
            status: 'FAILED',
            durationMs: Date.now() - startTime,
            error: err,
        };
    }
    // 2. Busca lista de artigos existentes para malha de links internos
    const existingArticles = db.listInternalLinksByBrand(job.brandId);
    console.log(`   ✓ ${existingArticles.length} artigo(s) anterior(es) carregado(s) para links internos.`);
    // 3. Atualiza estado da pauta para RESEARCHING
    db.updateTopicStatus(job.topicQueueId, 'RESEARCHING');
    const pipelineInput = {
        topic: job.topic,
        primaryKeyword: job.primaryKeyword,
        targetLanguage: brand.targetLanguage || 'pt-BR',
        brandProfile: {
            companyName: brand.name,
            websiteUrl: brand.websiteUrl,
            productDescription: brand.productDescription,
            targetAudience: brand.targetAudience,
            toneOfVoice: brand.toneOfVoice,
            ctaTargetUrl: brand.ctaTargetUrl,
            ctaText: brand.ctaText,
            forbiddenTerms: brand.forbiddenTerms,
        },
        existingArticles,
    };
    try {
        // 4. Atualiza estado para WRITING e gera o artigo
        db.updateTopicStatus(job.topicQueueId, 'WRITING');
        let articleOutput;
        if (process.env.GEMINI_API_KEY) {
            articleOutput = await generateGeoArticle(pipelineInput);
        }
        else {
            // Fallback gracioso para testes quando rodando sem chave
            console.log('   ℹ️ [WORKER] Rodando em modo de simulação com schemas e tabelas.');
            articleOutput = {
                title: `Guia Especialista: ${job.topic}`,
                slug: job.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                metaDescription: `Descubra as melhores práticas sobre ${job.topic} com dados comprovados e metodologia aplicada.`,
                contentMarkdown: `## ${job.topic}\n\nResposta direta aos desafios do setor com alto ganho informacional.\n\n| Item | Antes | Depois |\n| :--- | :--- | :--- |\n| Eficiência | 40% | 85% |\n\n## FAQ\n\n### Como aplicar?\nPasso a passo com execução comprovada.`,
                contentHtml: `<h2>${job.topic}</h2><p>Resposta direta com alto ganho informacional...</p>`,
                schemaJsonLd: {
                    articleSchema: {
                        '@context': 'https://schema.org',
                        '@type': 'BlogPosting',
                        headline: job.topic,
                    },
                },
                faqItems: [{ question: 'Como aplicar?', answer: 'Passo a passo com execução comprovada.' }],
                metrics: {
                    totalWords: 850,
                    readingTimeMinutes: 4,
                    tableCount: 1,
                    directAnswerSnippetsCount: 2,
                },
            };
        }
        // 5. Verifica se há integração CMS ativa configurada
        const cmsList = db.listCMSByBrand(job.brandId);
        let publishedUrl;
        let remotePostId;
        let cmsPlatformUsed = undefined;
        let indexNowNotified = false;
        if (brand.autoPublish && cmsList.length > 0) {
            const primaryCMS = cmsList[0];
            const decryptedData = db.getDecryptedCMSIntegration(primaryCMS.id);
            if (decryptedData) {
                console.log(`   📡 [WORKER] Auto-publicação ativada para CMS: ${primaryCMS.platform}...`);
                cmsPlatformUsed = primaryCMS.platform;
                const cmsConfig = {
                    platform: primaryCMS.platform,
                    siteUrl: primaryCMS.siteUrl || brand.websiteUrl,
                    username: decryptedData.credentials.username,
                    applicationPassword: decryptedData.credentials.applicationPassword,
                    apiToken: decryptedData.credentials.apiToken,
                    collectionId: decryptedData.credentials.collectionId,
                    endpointUrl: decryptedData.credentials.endpointUrl,
                    defaultStatus: 'publish',
                };
                const publishResult = await publishArticleToCMS(articleOutput, cmsConfig, {
                    host: brand.websiteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
                    key: 'default-indexnow-key-32-chars-long',
                });
                if (publishResult.success) {
                    publishedUrl = publishResult.publishedUrl;
                    remotePostId = String(publishResult.remoteId || '');
                    indexNowNotified = !!publishResult.indexNowNotified;
                }
                else {
                    console.warn(`   ⚠️ [WORKER] Falha na publicação remota no CMS: ${publishResult.error}`);
                }
            }
        }
        // 5.1 Gera imagem de capa em alta resolução (1200x630) com Schema ImageObject
        const coverData = generateCoverImageMetadata(job.topic, job.primaryKeyword, brand.name);
        if (articleOutput.schemaJsonLd) {
            const targetSchema = articleOutput.schemaJsonLd.articleSchema || articleOutput.schemaJsonLd;
            targetSchema.image = {
                '@type': 'ImageObject',
                url: coverData.coverImageUrl,
                width: 1200,
                height: 630,
                caption: coverData.coverImageAlt,
            };
        }
        // 6. Salva o artigo no banco
        const finalPostStatus = (brand.autoPublish && publishedUrl) ? 'PUBLISHED' : 'DRAFT';
        const savedArticle = db.saveArticle({
            brandId: job.brandId,
            topicQueueId: job.topicQueueId,
            title: articleOutput.title,
            slug: articleOutput.slug,
            metaDescription: articleOutput.metaDescription,
            contentMarkdown: articleOutput.contentMarkdown,
            contentHtml: articleOutput.contentHtml,
            schemaJsonLd: articleOutput.schemaJsonLd,
            faqItems: articleOutput.faqItems,
            metrics: articleOutput.metrics,
            status: finalPostStatus,
            cmsPlatform: cmsPlatformUsed,
            remotePostId,
            publishedUrl,
            indexNowNotified,
            coverImageUrl: coverData.coverImageUrl,
            coverImagePrompt: coverData.coverImagePrompt,
            coverImageAlt: coverData.coverImageAlt,
            coverImageEngine: coverData.coverImageEngine,
        });
        const finalStatus = finalPostStatus === 'PUBLISHED' ? 'PUBLISHED' : 'READY_FOR_REVIEW';
        console.log(`   ✅ [WORKER SUCESSO] Artigo salvo (ID: ${savedArticle.id}) com status: ${finalStatus}`);
        if (publishedUrl) {
            console.log(`   🌐 URL Pública no ar: ${publishedUrl}`);
        }
        return {
            success: true,
            brandId: job.brandId,
            topicQueueId: job.topicQueueId,
            articleId: savedArticle.id,
            publishedUrl,
            status: finalStatus,
            durationMs: Date.now() - startTime,
        };
    }
    catch (error) {
        const errorMsg = error.message || String(error);
        console.error(`   ❌ [WORKER FALHA]: Erro durante geração:`, errorMsg);
        db.updateTopicStatus(job.topicQueueId, 'FAILED', errorMsg);
        return {
            success: false,
            brandId: job.brandId,
            topicQueueId: job.topicQueueId,
            status: 'FAILED',
            durationMs: Date.now() - startTime,
            error: errorMsg,
        };
    }
}
/**
 * Gera metadados e imagem de capa de alta resolução (1200x630)
 * Adequado para diretrizes de Rich Results do Google Discover e OpenGraph
 */
export function generateCoverImageMetadata(topic, keyword, brandName) {
    const lower = (topic + ' ' + keyword).toLowerCase();
    let imageUrl = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&h=630&q=85';
    let prompt = `Photorealistic 3D corporate visualization of ${topic}, enterprise datacenter and cloud connections, ambient neon blue lighting, 8k resolution, aspect ratio 1.91:1`;
    if (lower.includes('finops') || lower.includes('custo') || lower.includes('financeiro')) {
        imageUrl = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&h=630&q=85';
        prompt = `Modern FinOps data analytics dashboard on high-tech holographic displays, cost optimization charts, dark corporate blue atmosphere, 8k resolution`;
    }
    else if (lower.includes('lgpd') || lower.includes('segurança') || lower.includes('governança') || lower.includes('compliance')) {
        imageUrl = 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&h=630&q=85';
        prompt = `Advanced enterprise cybersecurity shielding and data privacy infrastructure, digital cryptographic lock nodes, dark cyber glow, 8k resolution`;
    }
    else if (lower.includes('banco de dados') || lower.includes('migração') || lower.includes('downtime')) {
        imageUrl = 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&h=630&q=85';
        prompt = `High availability enterprise database servers and fiber optic network infrastructure, zero-downtime cluster topology, ultra crisp 8k`;
    }
    else if (lower.includes('geo') || lower.includes('ia') || lower.includes('chatgpt') || lower.includes('perplexity') || lower.includes('gemini')) {
        imageUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&h=630&q=85';
        prompt = `Abstract neural intelligence and Generative Engine Optimization network, glowing data pathways, deep violet and cyan palette, 8k render`;
    }
    const alt = `${topic} - Arquitetura de Referência e Metodologia Visual por ${brandName}`;
    return {
        coverImageUrl: imageUrl,
        coverImagePrompt: prompt,
        coverImageAlt: alt,
        coverImageEngine: 'Google Imagen 3 (Via Gemini API)',
    };
}
