import { publishToWordPress } from './wordpress.js';
import { publishToWebflow } from './webflow.js';
import { publishToWebhook } from './webhook.js';
import { notifyIndexNow } from './indexnow.js';
export * from './types.js';
export * from './wordpress.js';
export * from './webflow.js';
export * from './webhook.js';
export * from './indexnow.js';
/**
 * Roteador central de publicação multi-CMS e indexação instantânea.
 */
export async function publishArticleToCMS(article, cmsConfig, indexNowConfig) {
    let result;
    switch (cmsConfig.platform) {
        case 'wordpress':
            result = await publishToWordPress(article, cmsConfig);
            break;
        case 'webflow':
            result = await publishToWebflow(article, cmsConfig);
            break;
        case 'webhook':
            result = await publishToWebhook(article, cmsConfig);
            break;
        default:
            return {
                success: false,
                platform: cmsConfig.platform,
                status: 'draft',
                error: `Plataforma de CMS não suportada: ${cmsConfig.platform}`,
            };
    }
    // Se a publicação ocorreu com sucesso, e temos URL pública e config do IndexNow, dispara notificação
    if (result.success && result.status === 'published' && result.publishedUrl && indexNowConfig) {
        const notified = await notifyIndexNow([result.publishedUrl], indexNowConfig);
        result.indexNowNotified = notified;
    }
    return result;
}
