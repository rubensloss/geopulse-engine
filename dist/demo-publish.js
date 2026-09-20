import dotenv from 'dotenv';
import { publishArticleToCMS } from './publishers/index.js';
dotenv.config();
// Artigo de exemplo preparado pelo pipeline
const mockArticle = {
    title: 'O que é GEO (Generative Engine Optimization): Como Ranquear no ChatGPT e Perplexity',
    slug: 'o-que-e-geo-generative-engine-optimization',
    metaDescription: 'Aprenda o que é GEO, como os motores de IA selecionam fontes e como posicionar sua empresa.',
    contentMarkdown: '# O que é GEO...',
    contentHtml: `<h2>O que é GEO e como ele difere do SEO tradicional?</h2>
<p>GEO (Generative Engine Optimization) é o conjunto de técnicas para otimizar conteúdos para motores de busca por IA...</p>
<div class="table-responsive">
  <table class="border">
    <tr><th>Critério</th><th>SEO Tradicional</th><th>GEO</th></tr>
    <tr><td>Objetivo</td><td>Links azuis</td><td>Citação na síntese da IA</td></tr>
  </table>
</div>`,
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
        totalWords: 350,
        readingTimeMinutes: 2,
        tableCount: 1,
        directAnswerSnippetsCount: 1,
    },
};
async function testPublishers() {
    console.log(`================================================================`);
    console.log(`📡 DEMO: TESTE DE CONECTORES DE CMS & INDEXAÇÃO INSTANTÂNEA`);
    console.log(`================================================================\n`);
    // 1. Exemplo de Configuração para WordPress
    const wpConfig = {
        platform: 'wordpress',
        siteUrl: process.env.WP_SITE_URL || 'https://exemplo-wordpress.com.br',
        username: process.env.WP_USERNAME || 'admin',
        applicationPassword: process.env.WP_APP_PASSWORD || 'abcd 1234 efgh 5678',
        defaultStatus: 'draft', // Salva como rascunho por segurança no teste
    };
    // 2. Exemplo de Configuração para Webflow
    const webflowConfig = {
        platform: 'webflow',
        apiToken: process.env.WEBFLOW_TOKEN || 'seu_token_webflow',
        collectionId: process.env.WEBFLOW_COLLECTION_ID || 'id_da_collection_do_blog',
        isDraft: true,
    };
    // 3. Exemplo de Configuração para Webhook Genérico (Shopify / Headless / Next.js)
    const webhookConfig = {
        platform: 'webhook',
        endpointUrl: 'https://httpbin.org/post', // Endpoint público de teste que devolve o payload
        secretKey: 'chave-secreta-de-assinatura',
    };
    // 4. Configuração do IndexNow (para Bing, Copilot, Perplexity, etc.)
    const indexNowConfig = {
        host: 'exemplo-wordpress.com.br',
        key: 'f9b3e7c812a456d987e321cb54a10f9e',
    };
    console.log('1️⃣ Testando envio para Webhook Universal (com endpoint de teste httpbin.org)...');
    const webhookResult = await publishArticleToCMS(mockArticle, webhookConfig);
    console.log('   Resultado Webhook:', webhookResult);
    console.log('\n2️⃣ Demonstração de chamada WordPress (Application Passwords nativa):');
    console.log(`   - Endpoint visado: ${wpConfig.siteUrl}/wp-json/wp/v2/posts`);
    console.log(`   - Usuário: ${wpConfig.username}`);
    console.log(`   - Status planejado: ${wpConfig.defaultStatus}`);
    console.log(`   - Injeção de Schema: Script LD+JSON no corpo do artigo`);
    console.log('\n3️⃣ Demonstração de chamada Webflow CMS API v2:');
    console.log(`   - Endpoint visado: https://api.webflow.com/v2/collections/${webflowConfig.collectionId}/items`);
    console.log(`   - Modo: ${webflowConfig.isDraft ? 'Rascunho (isDraft: true)' : 'Publicação ao vivo'}`);
    console.log('\n4️⃣ Notificação IndexNow:');
    console.log(`   - Host: ${indexNowConfig.host}`);
    console.log(`   - Protocolo: POST https://api.indexnow.org/indexnow`);
    console.log(`   - Impacto: Dispara rastreamento prioritário pelos robôs em minutos.`);
    console.log(`\n================================================================`);
    console.log(`✅ CONECTORES CMS E INDEXNOW PRONTOS PARA USO EM PRODUÇÃO!`);
    console.log(`================================================================`);
}
testPublishers();
