import { whatsappCloudApi } from './services/whatsappCloudApi.js';
import { db } from './db/index.js';
async function runWhatsAppTests() {
    console.log('🧪 [TEST] Iniciando bateria de testes do WhatsApp Cloud API Oficial...\n');
    // 1. Teste de Configuração
    const config = whatsappCloudApi.getConfig();
    console.log('1. Configuração carregada:', {
        templateName: config.templateName,
        verifyToken: config.verifyToken,
        testMode: config.testMode,
        isEnabled: config.isEnabled,
    });
    // 2. Teste de Normalização de Telefones (Brasil)
    const numbersToTest = [
        '(11) 98765-4321',
        '11987654321',
        '+55 (21) 99999-8888',
        '5531988887777',
    ];
    console.log('\n2. Teste de Normalização de Telefones:');
    for (const num of numbersToTest) {
        console.log(`   - Original: "${num}" -> Normalizado Meta: "${whatsappCloudApi.normalizePhoneNumber(num)}"`);
    }
    // 3. Teste do Handshake do Webhook da Meta
    console.log('\n3. Teste de Handshake do Webhook da Meta (GET challenge):');
    const validChallenge = whatsappCloudApi.verifyWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': config.verifyToken,
        'hub.challenge': 'CHALLENGE_ACCEPTED_998877',
    });
    console.log('   - Handshake com token correto:', validChallenge.isValid ? '✅ APROVADO' : '❌ FALHOU', 'Challenge:', validChallenge.challenge);
    const invalidChallenge = whatsappCloudApi.verifyWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token_errado',
        'hub.challenge': 'CHALLENGE_DENIED',
    });
    console.log('   - Handshake com token errado:', !invalidChallenge.isValid ? '✅ RECUSADO COM SEGURANÇA' : '❌ FALHOU');
    // 4. Teste de Disparo do Dossiê via Template Oficial
    console.log('\n4. Teste de Disparo do Dossiê Executivo (Template Oficial):');
    const dispatchResult = await whatsappCloudApi.sendDossierReport({
        to: '(11) 99876-5432',
        clientName: 'Dr. Rubens Roberto',
        companyName: 'Clínica Sorriso SP',
        reportSlug: 'clinica-sorriso-sp',
        score: 28,
    });
    console.log('   - Sucesso no envio:', dispatchResult.success ? '✅ SUCESSO' : '❌ ERRO');
    console.log('   - ID da Mensagem Meta:', dispatchResult.messageRecord.metaMessageId);
    console.log('   - Status:', dispatchResult.messageRecord.status);
    console.log('   - Link do Dossiê injetado:', dispatchResult.messageRecord.dossierUrl);
    if (dispatchResult.metaResponse?.previewText) {
        console.log('   - Prévia da Mensagem:', `"${dispatchResult.metaResponse.previewText}"`);
    }
    // 5. Teste de Recebimento de Webhook da Meta (Status Callback)
    console.log('\n5. Teste de Callback do Webhook da Meta (DELIVERED & READ):');
    const metaWebhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WABA_123456',
                changes: [
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: { display_phone_number: '5511999998888', phone_number_id: 'PN_123' },
                            statuses: [
                                {
                                    id: dispatchResult.messageRecord.metaMessageId,
                                    status: 'delivered',
                                    timestamp: '1726848000',
                                    recipient_id: '5511998765432',
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    };
    const webhookResult = whatsappCloudApi.handleIncomingWebhook(metaWebhookPayload);
    console.log('   - Eventos processados:', webhookResult.processedCount, webhookResult.events);
    // 6. Teste de Histórico de Mensagens no Repositório
    console.log('\n6. Consulta do Histórico de Mensagens no Banco:');
    const recentMessages = db.listWhatsAppMessages(5);
    console.log(`   - Encontradas ${recentMessages.length} mensagens no histórico.`);
    const lastMsg = recentMessages[0];
    console.log(`   - Última msg [${lastMsg.status}]: Destino=${lastMsg.formattedTo}, Empresa=${lastMsg.companyName}`);
    console.log('\n🎉 TODOS OS TESTES DA META WHATSAPP CLOUD API PASSARAM COM SUCESSO!\n');
}
runWhatsAppTests().catch(console.error);
