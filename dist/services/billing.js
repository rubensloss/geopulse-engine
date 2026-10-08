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
    const planName = plan ? plan.name : input.planId;
    const company = input.customer?.companyName || 'minha empresa';
    const whatsappUrl = `https://wa.me/5527988140076?text=${encodeURIComponent(`Olá! Gostaria de contratar o plano ${planName} do GeoPulse para a empresa ${company}.`)}`;
    const err = new Error('Contratação online direta temporariamente indisponível. Fale com nosso time comercial no WhatsApp oficial (27) 98814-0076 para ativação assistida imediata.');
    err.statusCode = 400;
    err.whatsappUrl = whatsappUrl;
    err.phone = '(27) 98814-0076';
    throw err;
}
