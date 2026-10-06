import { db } from '../db/index.js';
import { generateToken } from './auth.js';
export const AVAILABLE_PLANS = [
    {
        id: 'STARTER',
        name: 'GEO Starter',
        tagline: 'Para PMEs e profissionais que desejam iniciar a captura de citações em IA',
        price: 297,
        formattedPrice: 'R$ 297',
        billingPeriod: '/mês',
        features: [
            '1 Domínio / Marca monitorada',
            'Diagnóstico Híbrido Contínuo (Google + IAs)',
            '10 Pautas Otimizadas com IA por mês',
            'Monitoramento semanal de citações (ChatGPT, Gemini, Perplexity, Claude)',
            'Exportação de Dossiê Executivo em PDF ilimitada'
        ],
        ctaLabel: 'Assinar Plano Starter'
    },
    {
        id: 'PRO',
        name: 'GEO Pro',
        tagline: 'Para empresas em crescimento e agências que exigem publicação automática',
        price: 597,
        formattedPrice: 'R$ 597',
        billingPeriod: '/mês',
        popular: true,
        features: [
            'Até 5 Marcas / Clientes simultâneos',
            'Pautas Ilimitadas com IA e Information Gain',
            'Publicação Automática via CMS (WordPress / Webflow)',
            'Protocolo IndexNow (Indexação em tempo real no Bing e Copilot)',
            'Monitoramento semanal de Share of Model com alertas',
            'Suporte prioritário e onboarding guiado'
        ],
        ctaLabel: 'Assinar Plano Pro'
    },
    {
        id: 'EXCELLENCE_CYCLE',
        name: '👑 Ciclo de Excelência Digital',
        tagline: 'O Ecossistema Completo Chave-na-Mão: A Joia da Coroa + Os 4 Pilares Executados',
        price: 2497,
        formattedPrice: 'R$ 2.497',
        billingPeriod: '/mês',
        highlightCrown: true,
        features: [
            '👑 Joia da Coroa: Licença PRO completa da Plataforma GEO GeoPulse',
            '📍 Pilar 1: Configuração e Otimização Profissional do Google Meu Negócio / Maps',
            '🌐 Pilar 2: Site Moderno, Imersivo e Ultra-rápido com Schemas JSON-LD',
            '🤖 Pilar 3: Agente de IA Conversacional treinado para Atendimento 24/7',
            '📊 Pilar 4: CRM Integrado com Gestão de Funil de Vendas e Follow-up Automático',
            '🚀 Equipe dedicada cuidando da execução técnica e operacional'
        ],
        ctaLabel: 'Contratar Ciclo de Excelência VIP'
    }
];
export function processCheckout(input) {
    const plan = AVAILABLE_PLANS.find(p => p.id === input.planId);
    if (!plan) {
        throw new Error('Plano selecionado inválido.');
    }
    // Busca ou cria o usuário correspondente
    let user = db.getUserByEmail(input.customer.email);
    let token = '';
    if (!user) {
        const slug = input.customer.companyName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-');
        const org = db.createOrganization(input.customer.companyName, slug);
        user = db.createUser({
            organizationId: org.id,
            name: input.customer.name,
            email: input.customer.email.toLowerCase().trim(),
            passwordHash: 'checkout_auto_auth_' + Date.now(),
            companyName: input.customer.companyName,
            phone: input.customer.phone,
            role: 'OWNER',
            planTier: plan.id,
            subscriptionStatus: 'ACTIVE',
        });
        db.createBrand({
            organizationId: org.id,
            name: input.customer.companyName,
            websiteUrl: `https://${slug}.com.br`,
            productDescription: `Soluções corporativas de ${input.customer.companyName}`,
            targetAudience: 'Compradores e decisores corporativos',
            toneOfVoice: 'Profissional e orientado a autoridade.',
            ctaTargetUrl: `https://${slug}.com.br`,
            ctaText: 'Falar com Especialista',
            autoPublish: false,
            isActive: true,
        });
    }
    else {
        db.updateUser(user.id, {
            planTier: plan.id,
            subscriptionStatus: 'ACTIVE',
            companyName: input.customer.companyName || user.companyName,
        });
    }
    // Gera token de autenticação direto
    token = generateToken(user);
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // Cria a assinatura correspondente no banco
    db.createSubscription({
        userId: user.id,
        organizationId: user.organizationId,
        planTier: plan.id,
        planName: plan.name,
        status: 'ACTIVE',
        amount: plan.price,
        currency: 'BRL',
        billingCycle: input.billingCycle || 'MONTHLY',
        paymentMethod: input.paymentMethod,
        paymentId: transactionId,
    });
    if (input.paymentMethod === 'PIX') {
        // Simula payload real de PIX Banco Central (BR Code)
        const pixCopiaECola = `00020126580014br.gov.bcb.pix0136${transactionId}520400005303986540${plan.price}.005802BR5916GEOPULSE ENGINE6009SAO PAULO62070503***6304E1D2`;
        return {
            success: true,
            transactionId,
            planName: plan.name,
            amount: plan.price,
            paymentMethod: 'PIX',
            status: 'APPROVED', // Na demo ao vivo do investidor aprovamos na hora para encantar
            pixData: {
                qrCodeBase64: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="%230f172a"/><rect x="15" y="15" width="30" height="30" fill="%2338bdf8"/><rect x="22" y="22" width="16" height="16" fill="%230f172a"/><rect x="75" y="15" width="30" height="30" fill="%2338bdf8"/><rect x="82" y="22" width="16" height="16" fill="%230f172a"/><rect x="15" y="75" width="30" height="30" fill="%2338bdf8"/><rect x="22" y="82" width="16" height="16" fill="%230f172a"/><rect x="55" y="30" width="10" height="60" fill="%2338bdf8"/><rect x="70" y="65" width="35" height="10" fill="%2338bdf8"/><rect x="85" y="85" width="20" height="20" fill="%2338bdf8"/></svg>',
                copiaECola: pixCopiaECola,
                expiresInMinutes: 30,
            },
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                companyName: user.companyName,
                planTier: user.planTier,
            },
            token,
        };
    }
    // Cartão de Crédito
    return {
        success: true,
        transactionId,
        planName: plan.name,
        amount: plan.price,
        paymentMethod: 'CREDIT_CARD',
        status: 'APPROVED',
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            companyName: user.companyName,
            planTier: user.planTier,
        },
        token,
    };
}
