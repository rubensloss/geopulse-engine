/**
 * Publicador Universal via Webhook.
 * Permite entregar o artigo completo (HTML, Markdown, Schemas, FAQs) para qualquer sistema externo
 * como Shopify, Ghost, Strapi, Next.js ou automações em Make/Zapier.
 */
export async function publishToWebhook(article, config) {
    console.log(`📡 [PUBLISHER WEBHOOK] Enviando payload para: ${config.endpointUrl}...`);
    const headers = {
        'Content-Type': 'application/json',
        ...(config.customHeaders || {}),
    };
    if (config.secretKey) {
        headers['X-Webhook-Secret'] = config.secretKey;
    }
    const payload = {
        event: 'article.published',
        timestamp: new Date().toISOString(),
        article: {
            title: article.title,
            slug: article.slug,
            metaDescription: article.metaDescription,
            contentHtml: article.contentHtml,
            contentMarkdown: article.contentMarkdown,
            schemaJsonLd: article.schemaJsonLd,
            faqItems: article.faqItems,
            metrics: article.metrics,
        },
    };
    try {
        const response = await fetch(config.endpointUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                platform: 'webhook',
                status: 'draft',
                error: `HTTP ${response.status} - ${errorText}`,
            };
        }
        console.log(`   ✓ Webhook entregue com sucesso! Status HTTP: ${response.status}`);
        return {
            success: true,
            platform: 'webhook',
            status: 'published',
        };
    }
    catch (error) {
        return {
            success: false,
            platform: 'webhook',
            status: 'draft',
            error: error.message || String(error),
        };
    }
}
