/**
 * Publicador para Webflow via CMS API v2.
 * Cria o item na collection do blog e suporta tanto rascunho quanto publicação direta.
 */
export async function publishToWebflow(article, config) {
    const isDraft = config.isDraft ?? false;
    // Se for rascunho, vai para /items. Se for para publicar ao vivo, vai para /items/live
    const endpoint = isDraft
        ? `https://api.webflow.com/v2/collections/${config.collectionId}/items`
        : `https://api.webflow.com/v2/collections/${config.collectionId}/items/live`;
    console.log(`📡 [PUBLISHER WEBFLOW] Publicando item na Collection ${config.collectionId}...`);
    const schemaScript = `\n<script type="application/ld+json">\n${JSON.stringify(article.schemaJsonLd, null, 2)}\n</script>\n`;
    const finalBodyHtml = `${article.contentHtml}\n${schemaScript}`;
    const payload = {
        isArchived: false,
        isDraft: isDraft,
        fieldData: {
            name: article.title,
            slug: article.slug,
            'post-body': finalBodyHtml,
            'post-summary': article.metaDescription,
        },
    };
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiToken}`,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                platform: 'webflow',
                status: isDraft ? 'draft' : 'published',
                error: `HTTP ${response.status} - ${errorText}`,
            };
        }
        const data = (await response.json());
        console.log(`   ✓ Artigo publicado com sucesso no Webflow! Item ID: ${data.id}`);
        return {
            success: true,
            platform: 'webflow',
            remoteId: data.id,
            publishedUrl: data.fieldData?.slug ? `https://seu-site.webflow.io/post/${data.fieldData.slug}` : undefined,
            status: isDraft ? 'draft' : 'published',
        };
    }
    catch (error) {
        return {
            success: false,
            platform: 'webflow',
            status: 'draft',
            error: error.message || String(error),
        };
    }
}
