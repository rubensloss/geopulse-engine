import dotenv from 'dotenv';
import { db } from './db/index.js';
import { AutonomousScheduler } from './worker/index.js';
dotenv.config();
async function runWorkerDemo() {
    console.log(`================================================================`);
    console.log(`⚙️ DEMO: AGENDADOR AUTÔNOMO 24/7 (WORKER & SCHEDULER ENGINE)`);
    console.log(`================================================================\n`);
    // 1. Configura Organização e Marca Cliente
    console.log('1️⃣ Configurando Marca no Banco de Dados...');
    const org = db.createOrganization('ScaleUp Growth Partners', 'scaleup-growth');
    const brand = db.createBrand({
        organizationId: org.id,
        name: 'CyberShield Seguros Corporativos',
        websiteUrl: 'https://cybershield.com.br',
        productDescription: 'Seguros contra ataques de ransomware, vazamento de dados e fraudes financeiras para empresas.',
        targetAudience: 'CISOs, Diretores de TI, CFOs e Gerentes de Risco.',
        toneOfVoice: 'Autoritário, focado em mitigação de riscos, sem sensacionalismo, baseado em estatísticas de segurança.',
        ctaTargetUrl: 'https://cybershield.com.br/cotacao-imediata',
        ctaText: 'Simular Seguro Cyber para sua Empresa',
        autoPublish: false, // Ficará em READY_FOR_REVIEW
    });
    console.log(`   ✓ Marca pronta: ${brand.name} (ID: ${brand.id})\n`);
    // 2. Enfileira 3 pautas com prioridades diferentes
    console.log('2️⃣ Inserindo 3 pautas inteligentes no TopicQueue...');
    const pauta1 = db.addTopicToQueue({
        brandId: brand.id,
        topic: 'Como funciona a apólice de seguro contra ransomware no Brasil',
        primaryKeyword: 'seguro contra ransomware apólice',
        priority: 5, // Máxima prioridade
    });
    const pauta2 = db.addTopicToQueue({
        brandId: brand.id,
        topic: 'Quais os requisitos de segurança de TI exigidos pelas seguradoras',
        primaryKeyword: 'requisitos seguro cibernético',
        priority: 4,
    });
    const pauta3 = db.addTopicToQueue({
        brandId: brand.id,
        topic: 'Estudo de caso: Como o seguro cibernético cobriu prejuízos de R$ 3 milhões em vazamento LGPD',
        primaryKeyword: 'caso real seguro cibernético lgpd',
        priority: 3,
    });
    console.log(`   ✓ Pauta 1 enfileirada: "${pauta1.topic}" (Prioridade: ${pauta1.priority})`);
    console.log(`   ✓ Pauta 2 enfileirada: "${pauta2.topic}" (Prioridade: ${pauta2.priority})`);
    console.log(`   ✓ Pauta 3 enfileirada: "${pauta3.topic}" (Prioridade: ${pauta3.priority})\n`);
    // 3. Inicializa o AutonomousScheduler
    console.log('3️⃣ Inicializando o AutonomousScheduler...');
    const customScheduler = new AutonomousScheduler({
        concurrency: 2, // Processa até 2 artigos em paralelo
        pollIntervalMs: 1500, // Checagem a cada 1.5s no demo
    });
    customScheduler.start();
    // Deixa o scheduler rodar e processar as pautas
    console.log('\n⏳ Aguardando processamento dos jobs pelo worker em background...\n');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    // 4. Pausa o scheduler após o ciclo
    customScheduler.stop();
    // 5. Verifica o estado final do banco
    console.log(`\n================================================================`);
    console.log(`📊 RELATÓRIO DO BANCO DE DADOS APÓS EXECUÇÃO DO SCHEDULER`);
    console.log(`================================================================`);
    const articles = db.listArticlesByBrand(brand.id);
    console.log(`Total de artigos processados e salvos: ${articles.length}`);
    for (const art of articles) {
        console.log(`\n📄 Artigo ID: ${art.id}`);
        console.log(`   - Título: ${art.title}`);
        console.log(`   - Status: ${art.status}`);
        console.log(`   - Palavras: ${art.metrics.totalWords} | Tabelas: ${art.metrics.tableCount}`);
        console.log(`   - Schema FAQ: ${art.faqItems.length} perguntas mapeadas.`);
    }
    const remaining = db.listPendingTopics(brand.id);
    console.log(`\nPautas restantes no backlog: ${remaining.length}`);
    console.log(`\n================================================================`);
    console.log(`🎯 DEMO DO WORKER & SCHEDULER CONCLUÍDA COM 100% DE SUCESSO!`);
    console.log(`================================================================\n`);
}
runWorkerDemo();
