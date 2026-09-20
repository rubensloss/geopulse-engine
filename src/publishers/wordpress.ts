import { ArticleOutput } from '../types/index.js';
import { PublishResult, WordPressConfig } from './types.js';

/**
 * Publicador nativo para WordPress via REST API oficial.
 * Utiliza o recurso nativo de Application Passwords do WordPress (WP 5.6+).
 * Não exige nenhum plugin instalado no WordPress do cliente.
 */
export async function publishToWordPress(
  article: ArticleOutput,
  config: WordPressConfig
): Promise<PublishResult> {
  const baseUrl = config.siteUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/wp-json/wp/v2/posts`;

  console.log(`📡 [PUBLISHER WP] Conectando ao WordPress em: ${baseUrl}...`);

  // Limpa espaços na senha de aplicativo (o WordPress gera com espaços para facilitar leitura)
  const cleanPassword = config.applicationPassword.replace(/\s+/g, '');
  const authHeader = `Basic ${Buffer.from(`${config.username}:${cleanPassword}`).toString('base64')}`;

  // Injeta o Schema JSON-LD diretamente no corpo do HTML para garantir indexação por IA e Google
  const schemaScript = `\n<script type="application/ld+json">\n${JSON.stringify(
    article.schemaJsonLd,
    null,
    2
  )}\n</script>\n`;

  const finalContentHtml = `${article.contentHtml}\n${schemaScript}`;

  const payload: Record<string, any> = {
    title: article.title,
    slug: article.slug,
    content: finalContentHtml,
    excerpt: article.metaDescription,
    status: config.defaultStatus || 'publish',
  };

  if (config.authorId) payload.author = config.authorId;
  if (config.categories) payload.categories = config.categories;
  if (config.tags) payload.tags = config.tags;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = JSON.parse(errorText);
        errorMsg += ` - ${errJson.message || errorText}`;
      } catch {
        errorMsg += ` - ${errorText}`;
      }
      return {
        success: false,
        platform: 'wordpress',
        status: config.defaultStatus === 'publish' ? 'published' : 'draft',
        error: errorMsg,
      };
    }

    const postData = (await response.json()) as { id: number; link: string; status: string };

    console.log(`   ✓ Artigo publicado com sucesso no WordPress! ID: ${postData.id}`);
    console.log(`   ✓ URL no ar: ${postData.link}`);

    return {
      success: true,
      platform: 'wordpress',
      remoteId: postData.id,
      publishedUrl: postData.link,
      status: postData.status === 'publish' ? 'published' : 'draft',
    };
  } catch (error: any) {
    return {
      success: false,
      platform: 'wordpress',
      status: 'draft',
      error: error.message || String(error),
    };
  }
}
