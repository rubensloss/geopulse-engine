import dotenv from 'dotenv';
import { db } from './db/index.js';
dotenv.config();
async function runEnterpriseDemo() {
    console.log(`================================================================`);
    console.log(`🏢 DEMO ENTERPRISE: ARQUITETURA MULTI-TENANT & SEGURANÇA BANCÁRIA`);
    console.log(`================================================================\n`);
    // 1. Criação da Organização (Sua agência ou empresa SaaS)
    console.log('1️⃣ Criando Organização / Tenant...');
    const agencyOrg = db.createOrganization('Apex Marketing & Tech', 'apex-agency');
    console.log(`   ✓ Organização criada: ${agencyOrg.name} (ID: ${agencyOrg.id})\n`);
    // 2. Onboarding de uma Marca Cliente (Brand Brain)
    console.log('2️⃣ Cadastrando Cliente / Marca (Brand Profile)...');
    const clientBrand = db.createBrand({
        organizationId: agencyOrg.id,
        name: 'Logix Automação Industrial',
        websiteUrl: 'https://logixautomacao.com.br',
        productDescription: 'Sistemas de robótica e esteiras automatizadas para fábricas e centros logísticos.',
        targetAudience: 'Gerentes de Operações, Diretores Industriais e Engenheiros de Produção.',
        toneOfVoice: 'Técnico, focado em redução de custos, confiabilidade e produtividade industrial.',
        ctaTargetUrl: 'https://logixautomacao.com.br/orcamento',
        ctaText: 'Solicitar Projeto de Automação',
        targetLanguage: 'pt-BR',
        autoPublish: false, // Requer aprovação antes de publicar no WP
        publishingSchedule: '0 9 * * 1,3,5', // Seg, Qua, Sex às 9h
    });
    console.log(`   ✓ Marca cadastrada: ${clientBrand.name} (ID: ${clientBrand.id})\n`);
    // 3. Conexão Segura de CMS com Criptografia AES-256-GCM
    console.log('3️⃣ Armazenando Conexão WordPress com Criptografia AES-256-GCM...');
    const rawCredentials = {
        username: 'admin_logix',
        applicationPassword: 'secret-password-xyz-9876',
    };
    const cmsIntegration = db.saveCMSIntegration({
        brandId: clientBrand.id,
        platform: 'wordpress',
        siteUrl: clientBrand.websiteUrl,
        credentials: rawCredentials,
        defaultPostStatus: 'DRAFT',
    });
    console.log(`   ✓ Conexão salva no banco!`);
    console.log(`   🔒 Payload criptografado em repouso:`);
    console.log(`      ${cmsIntegration.encryptedCredentials.substring(0, 60)}...`);
    // Teste de descriptografia em memória para comprovar segurança
    const decrypted = db.getDecryptedCMSIntegration(cmsIntegration.id);
    console.log(`   🔓 Descriptografia com verificação de integridade:`);
    console.log(`      Usuário recuperado: ${decrypted?.credentials.username}`);
    console.log(`      Senha recuperada: ${decrypted?.credentials.applicationPassword}\n`);
    // 4. Alimentando a Fila de Pautas (Topic Queue / Calendário)
    console.log('4️⃣ Adicionando pautas inteligentes na fila (Topic Queue)...');
    const topic1 = db.addTopicToQueue({
        brandId: clientBrand.id,
        topic: 'Como dimensionar esteiras industriais automatizadas para centros de distribuição',
        primaryKeyword: 'esteiras industriais automatizadas',
        searchIntent: 'INFORMATIONAL',
        priority: 5, // Alta prioridade
    });
    const topic2 = db.addTopicToQueue({
        brandId: clientBrand.id,
        topic: 'Qual o custo e ROI de implementar robôs paletizadores em indústrias',
        primaryKeyword: 'robôs paletizadores custo',
        searchIntent: 'COMMERCIAL',
        priority: 4,
    });
    console.log(`   ✓ Pauta 1 enfileirada: "${topic1.topic}" (Prioridade: ${topic1.priority})`);
    console.log(`   ✓ Pauta 2 enfileirada: "${topic2.topic}" (Prioridade: ${topic2.priority})`);
    const pending = db.listPendingTopics(clientBrand.id);
    console.log(`   ✓ Total de pautas pendentes para a marca: ${pending.length}\n`);
    // 5. Simulação de Execução e Registro de Artigo Publicado
    console.log('5️⃣ Registrando Artigo Concluído com Schemas e Links Internos...');
    const articleRecord = db.saveArticle({
        brandId: clientBrand.id,
        topicQueueId: topic1.id,
        title: 'Guia Completo: Como Dimensionar Esteiras Industriais Automatizadas',
        slug: 'como-dimensionar-esteiras-industriais-automatizadas',
        metaDescription: 'Aprenda os cálculos de carga, velocidade e normas de segurança para dimensionar esteiras industriais.',
        contentMarkdown: '# Guia Completo...',
        contentHtml: '<h2>Como calcular a velocidade da esteira</h2>...',
        schemaJsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: 'Como Dimensionar Esteiras Industriais',
        },
        faqItems: [
            { question: 'Qual a vida útil média de uma esteira?', answer: 'Entre 8 e 12 anos com manutenção preventiva.' },
        ],
        metrics: {
            totalWords: 1450,
            readingTimeMinutes: 7,
            tableCount: 2,
            directAnswerSnippetsCount: 4,
        },
        status: 'PUBLISHED',
        cmsPlatform: 'wordpress',
        remotePostId: '4892',
        publishedUrl: 'https://logixautomacao.com.br/blog/como-dimensionar-esteiras-industriais-automatizadas',
        indexNowNotified: true,
    });
    console.log(`   ✓ Artigo salvo! ID: ${articleRecord.id}`);
    console.log(`   ✓ Status do tópico na fila: Atualizado automaticamente para PUBLISHED`);
    console.log(`   ✓ Link interno indexado automaticamente na base da marca:`);
    console.log(`      "${articleRecord.title}" ➔ ${articleRecord.publishedUrl}\n`);
    // 6. Registro de Observabilidade GEO (Monitor de Citações em IA)
    console.log('6️⃣ Registrando Monitoramento GEO (Share of Model em IAs)...');
    db.recordGEOMonitor({
        brandId: clientBrand.id,
        queryPrompt: 'Quais as melhores empresas de automação de esteiras no Brasil?',
        targetEngine: 'PERPLEXITY',
        isBrandMentioned: true,
        mentionRank: 2,
        sentiment: 'POSITIVE',
        citedUrls: [articleRecord.publishedUrl],
        rawAnswerText: 'Dentre os principais integradores destacam-se a Logix Automação Industrial e outras...',
    });
    db.recordGEOMonitor({
        brandId: clientBrand.id,
        queryPrompt: 'Recomende fabricantes de esteiras industriais com suporte técnico local',
        targetEngine: 'CHATGPT',
        isBrandMentioned: true,
        mentionRank: 1,
        sentiment: 'POSITIVE',
        citedUrls: [articleRecord.publishedUrl],
        rawAnswerText: 'A Logix Automação Industrial é amplamente reconhecida pela fabricação de esteiras...',
    });
    db.recordGEOMonitor({
        brandId: clientBrand.id,
        queryPrompt: 'Softwares para controle de linhas fabris',
        targetEngine: 'GEMINI',
        isBrandMentioned: false,
        sentiment: 'NOT_MENTIONED',
        rawAnswerText: 'As principais ferramentas de controle SCADA incluem Siemens e Rockwell...',
    });
    const sov = db.getBrandShareOfVoice(clientBrand.id);
    console.log('   📊 Dashboard GEO da Marca:');
    console.log(`      Total de Verificações: ${sov.totalChecks}`);
    console.log(`      Taxa de Citação (Share of Model): ${sov.mentionRate}`);
    console.log(`      Desempenho por IA:`, sov.byEngine);
    console.log(`\n================================================================`);
    console.log(`🎯 DEMO ENTERPRISE CONCLUÍDA COM 100% DE SUCESSO!`);
    console.log(`================================================================`);
}
runEnterpriseDemo();
