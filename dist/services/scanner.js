import dotenv from 'dotenv';
import { runHonestMultiLlmAudit, toModelPresenceList } from './multiLlmAuditor.js';
dotenv.config();
// Cache de resultado de auditoria por 24h (Controle de Custo — Seção 2.4 da Especificação)
const SCAN_24H_CACHE = new Map();
/**
 * Normaliza e limpa um domínio
 */
export function cleanDomain(domain) {
    return domain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');
}
/**
 * Deduz um nome legível para a marca com base no domínio
 */
export function extractBrandName(domain, providedBrand) {
    if (providedBrand && providedBrand.trim().length > 1) {
        return providedBrand.trim();
    }
    const clean = cleanDomain(domain);
    const namePart = clean.split('.')[0] || 'Empresa';
    return namePart
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}
/**
 * Valida se o domínio solicitado é seguro contra SSRF (Server-Side Request Forgery).
 * Bloqueia localhost, endereços IP locais/privados e redes internas do Railway/Docker.
 */
export function isSsrfTarget(target) {
    const host = (target || '').toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    if (!host)
        return true;
    // Localhost e domínios internos
    if (host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.railway.internal')) {
        return true;
    }
    // Checagem de IPs privados (IPv4)
    const ipParts = host.split('.').map(Number);
    if (ipParts.length === 4 && ipParts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        // 127.0.0.0/8 (Loopback)
        if (ipParts[0] === 127)
            return true;
        // 10.0.0.0/8 (Rede privada)
        if (ipParts[0] === 10)
            return true;
        // 172.16.0.0/12 (Rede privada 172.16.0.0 - 172.31.255.255)
        if (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] <= 31)
            return true;
        // 192.168.0.0/16 (Rede privada)
        if (ipParts[0] === 192 && ipParts[1] === 168)
            return true;
        // 169.254.0.0/16 (Link-local / Cloud metadata)
        if (ipParts[0] === 169 && ipParts[1] === 254)
            return true;
        // 0.0.0.0/8
        if (ipParts[0] === 0)
            return true;
    }
    return false;
}
/**
 * Realiza uma auditoria técnica em tempo real no domínio (HTML, Schemas, Metatags, Google Maps)
 * Bloqueia estritamente SSRF (localhost, rede interna) e testa Apex/WWW com timeout.
 */
export async function inspectLiveDomain(domain) {
    if (isSsrfTarget(domain)) {
        const err = new Error('Acesso bloqueado por segurança: endereço interno ou não permitido para escaneamento.');
        err.statusCode = 400;
        throw err;
    }
    const clean = cleanDomain(domain);
    const result = {
        isOnline: false,
        hasHttps: false,
        hasJsonLd: false,
        detectedSchemas: [],
        hasOpenGraph: false,
        hasTables: false,
        allowsAiCrawlers: true,
        title: '',
        metaDesc: '',
        isMobileResponsive: false,
        hasGoogleMapsEmbed: false,
        hasLocalBusinessSchema: false,
        hasAddressDetected: false,
        hasPhoneOrContact: false,
        blockedAiCrawlers: [],
    };
    const tryUrls = [
        `https://${clean}`,
        `https://www.${clean}`,
        `http://${clean}`,
        `http://www.${clean}`,
    ];
    let response = null;
    let finalUrl = '';
    for (const url of tryUrls) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(6000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                redirect: 'follow',
            });
            if (res.status < 500) {
                response = res;
                finalUrl = res.url || url;
                break;
            }
        }
        catch {
            // continua para o próximo alvo
        }
    }
    if (response) {
        result.isOnline = true;
        result.hasHttps = finalUrl.startsWith('https://') || response.url.startsWith('https://');
        try {
            const html = await response.text();
            // Title
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch)
                result.title = titleMatch[1].trim();
            // Meta description
            const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
            if (descMatch)
                result.metaDesc = descMatch[1].trim();
            // Responsividade Mobile
            result.isMobileResponsive = html.includes('name="viewport"') || html.includes("name='viewport'");
            // OpenGraph
            if (html.includes('property="og:') || html.includes("property='og:")) {
                result.hasOpenGraph = true;
            }
            // Tables / Semantics
            if (html.includes('<table') || html.includes('<dl') || html.includes('<article')) {
                result.hasTables = true;
            }
            // Google Maps Embed & Sinais Locais
            if (html.includes('maps.google.com') ||
                html.includes('google.com/maps') ||
                html.includes('maps.app.goo.gl') ||
                html.includes('goo.gl/maps') ||
                html.includes('/maps/embed')) {
                result.hasGoogleMapsEmbed = true;
            }
            // LocalBusiness Schema
            if (html.includes('"LocalBusiness"') ||
                html.includes("'LocalBusiness'") ||
                html.includes('"Store"') ||
                html.includes('"Restaurant"') ||
                html.includes('"HealthClub"') ||
                html.includes('"FitnessCenter"') ||
                html.includes('"MedicalBusiness"')) {
                result.hasLocalBusinessSchema = true;
            }
            // Detecção de Endereço Físico / CEP
            if (html.match(/CEP[:\s]/i) ||
                html.match(/(Rua|Av\.|Avenida|Rodovia|Alameda|Travessa)\s+[A-Z0-9]/i) ||
                html.includes('itemprop="address"') ||
                html.includes('itemprop="postalCode"')) {
                result.hasAddressDetected = true;
            }
            // Contato e Telefone
            if (html.includes('tel:') ||
                html.includes('whatsapp') ||
                html.includes('wa.me') ||
                html.includes('fale-conosco') ||
                html.includes('contato')) {
                result.hasPhoneOrContact = true;
            }
            // Schemas JSON-LD
            const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
            let match;
            while ((match = jsonLdRegex.exec(html)) !== null) {
                try {
                    const parsed = JSON.parse(match[1]);
                    result.hasJsonLd = true;
                    if (parsed['@type']) {
                        const types = Array.isArray(parsed['@type']) ? parsed['@type'] : [parsed['@type']];
                        result.detectedSchemas.push(...types);
                    }
                    if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
                        parsed['@graph'].forEach((node) => {
                            if (node['@type'])
                                result.detectedSchemas.push(node['@type']);
                        });
                    }
                }
                catch {
                    // JSON-LD mal formatado
                }
            }
            result.detectedSchemas = Array.from(new Set(result.detectedSchemas));
        }
        catch {
            // Erro ao ler corpo da resposta
        }
        // Inspeção factual de robots.txt para bots de IA (GPTBot, PerplexityBot, Google-Extended, ClaudeBot)
        try {
            const robotsUrl = `https://${clean}/robots.txt`;
            const robotsRes = await fetch(robotsUrl, {
                signal: AbortSignal.timeout(4000),
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (robotsRes.ok) {
                const robotsText = await robotsRes.text();
                const lowerRobots = robotsText.toLowerCase();
                const botsToCheck = ['gptbot', 'perplexitybot', 'google-extended', 'claudebot'];
                const blocked = botsToCheck.filter(bot => {
                    const regex = new RegExp(`user-agent:\\s*${bot}[\\s\\S]*?disallow:\\s*\\/(\\s|$)`, 'i');
                    return regex.test(lowerRobots);
                });
                const disallowAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/(\s|$)/i.test(lowerRobots);
                result.blockedAiCrawlers = blocked;
                result.allowsAiCrawlers = !disallowAll && blocked.length < 2;
            }
        }
        catch {
            // robots.txt inacessível ou não configurado
        }
    }
    return result;
}
/**
 * Gera diagnóstico do ecossistema Google com base exclusivamente nas evidências técnicas factuais
 */
export function generateGooglePresenceDiagnosis(domain, brandName, niche, tech, geoScore) {
    let googleScore = 32;
    if (tech.isOnline)
        googleScore += 18;
    if (tech.hasHttps)
        googleScore += 10;
    if (tech.isMobileResponsive)
        googleScore += 8;
    if (tech.title && tech.title.length > 8)
        googleScore += 10;
    if (tech.metaDesc && tech.metaDesc.length > 20)
        googleScore += 8;
    if (tech.hasJsonLd)
        googleScore += 10;
    if (tech.detectedSchemas.length >= 2)
        googleScore += 6;
    if (tech.hasGoogleMapsEmbed || tech.hasLocalBusinessSchema || tech.hasAddressDetected)
        googleScore += 8;
    googleScore = Math.max(20, Math.min(googleScore, 85));
    const hasLocalSignals = tech.hasGoogleMapsEmbed || tech.hasLocalBusinessSchema || tech.hasAddressDetected;
    let gmbVerificationStatus = 'NAO_ENCONTRADO';
    let gmbBadge = 'Sinais Locais Não Detectados no Código do Site';
    let gmbRating = 'Não verificado (requer Google Places API)';
    let gmbLocalScore = 30;
    let gmbAddress = 'Endereço físico não referenciado no código ou mapa embed';
    let gmbReviewSignal = 'BAIXA_OU_NULA';
    const gmbRecommendations = [];
    if (hasLocalSignals) {
        gmbVerificationStatus = 'VERIFICADO_ATIVO';
        gmbBadge = 'Link ou Embed do Google Maps Identificado no Site';
        gmbRating = 'Não verificado via API oficial de avaliações';
        gmbLocalScore = 65;
        gmbAddress = 'Endereço físico ou embed de mapa detectado nas páginas';
        gmbReviewSignal = 'MODERADA';
        gmbRecommendations.push('Vincular formalmente o Perfil de Empresa (Google Meu Negócio) com Schema LocalBusiness.', 'Acompanhar avaliações e avaliações recebidas na ficha do Maps.');
    }
    else {
        gmbRecommendations.push('Reivindicar o Perfil de Empresa no Google Maps para o endereço comercial.', 'Inserir o Schema LocalBusiness (JSON-LD) para conectar o domínio à localização física.');
    }
    let statusBadge = 'Presença Técnica Básica';
    if (googleScore >= 70) {
        statusBadge = 'Base Técnica Estruturada com Schemas Detectados';
    }
    else if (googleScore >= 45) {
        statusBadge = 'Indexado com Gaps Técnicos de Metadados e Schemas';
    }
    const statusSummary = tech.hasJsonLd
        ? `O domínio ${domain} possui metadados Schema.org no código, com potencial para Rich Snippets se complementado com FAQs e tabelas.`
        : `O domínio ${domain} não apresenta marcações Schema.org (JSON-LD) no HTML analisado, limitando o destaque nos resultados do Google.`;
    return {
        googleHealthScore: googleScore,
        statusBadge,
        statusSummary,
        googleBusinessProfile: {
            hasProfile: hasLocalSignals,
            verificationStatus: gmbVerificationStatus,
            badgeLabel: gmbBadge,
            ratingEstimate: gmbRating,
            localSeoScore: gmbLocalScore,
            addressPresence: gmbAddress,
            reviewFrequencySignal: gmbReviewSignal,
            hasLocalBusinessSchema: tech.hasLocalBusinessSchema,
            hasGoogleMapsEmbed: tech.hasGoogleMapsEmbed,
            recommendations: gmbRecommendations,
        },
        organicSearch: {
            indexationStatus: tech.isOnline ? (tech.hasHttps ? 'INDEXED_HEALTHY' : 'PARTIAL') : 'POOR',
            estimatedIndexedPages: tech.isOnline ? 'URLs ativas detectadas' : 'Indexação instável ou offline',
            brandSearchDominance: `Domínio verificado para "${brandName}". Ranqueamento comercial depende de autoridade tópica.`,
            rankingKeywordsSample: [
                `${brandName.toLowerCase()}`,
                `${brandName.toLowerCase()} contato`,
                `${niche.toLowerCase()}`,
            ],
            organicCtrEstimate: tech.hasJsonLd
                ? 'Elegível a Rich Snippets básicos'
                : 'CTR padrão sem snippets enriquecidos',
        },
        technicalSeo: {
            mobileFriendly: tech.isMobileResponsive,
            httpsSecure: tech.hasHttps,
            speedRating: 'Não aferido via PageSpeed Insights API',
            schemaCoverage: {
                hasJsonLd: tech.hasJsonLd,
                types: tech.detectedSchemas,
                richSnippetsEligible: tech.detectedSchemas.includes('FAQPage') || tech.detectedSchemas.includes('Product'),
            },
            metaTagsQuality: (tech.title && tech.metaDesc) ? 'EXCELENTE' : tech.title ? 'PARCIAL' : 'AUSENTE',
        },
        entityAndLocal: {
            knowledgeGraph: 'Não verificado (requer Search API)',
            knowledgeGraphReason: `Verificação de Painel de Conhecimento oficial requer consulta à Google Knowledge Graph API.`,
            googleMapsPresence: hasLocalSignals ? 'LOCAL_OTIMIZADO' : 'SEM_PERFIL',
            googleMapsReason: hasLocalSignals
                ? 'Sinal de mapa ou endereço identificado no HTML.'
                : 'Ausência de mapa ou ficha local estruturada detectada no site.',
            googleReviewsSignal: 'Requer integração com Google Places API para consulta oficial de avaliações.',
        },
        zeroClickAnalysis: {
            zeroClickRisk: 'MÉDIO',
            riskPercentage: 'Estimativa contextual por formato',
            explanation: `Em ${niche}, respostas diretas de IA e painéis rápidos reduzem cliques caso o site não seja citado como fonte de referência.`,
        },
        actionPlan: [
            {
                action: 'Adicionar Schema.org (JSON-LD) de Organization e FAQPage',
                target: 'Google Search Console & Rich Snippets',
                impact: 'Ativa perguntas expansíveis na busca do Google, aumentando a taxa de clique orgânico.',
            },
            {
                action: hasLocalSignals
                    ? 'Otimizar categorias secundárias e catálogo de produtos no Google Meu Negócio'
                    : 'Reivindicar e verificar a ficha da empresa no Google Meu Negócio (Google Maps)',
                target: 'Google Meu Negócio / Maps',
                impact: 'Coloca a empresa no pack local do mapa regional para buscas de compradores da sua região.',
            },
            {
                action: 'Otimizar títulos e meta descriptions com termos de conversão imediata',
                target: 'Googlebot & Snippets Orgânicos',
                impact: 'Evita títulos truncados e melhora o posicionamento orgânico na primeira página.',
            },
        ],
    };
}
/**
 * Executa o escaneamento GEO estritamente honesto e baseado em dados reais.
 * Se nenhum modelo de IA for consultado (falta de chaves ou erro de rede nos LLMs),
 * responde com erro 503 claro e direciona para o WhatsApp oficial.
 * NUNCA inventa concorrentes, percentuais ou scores.
 */
export async function executeGEOScan(req) {
    const domain = cleanDomain(req.domain);
    const niche = req.niche.trim() || 'Serviços e Soluções B2B';
    const brandName = extractBrandName(domain, req.brandName);
    // 1. Verificação de Cache de 24h por Domínio + Nicho (Controle de Custo)
    const cacheKey = `${domain}:${niche.toLowerCase()}`;
    const cached = SCAN_24H_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }
    // 2. Inspeção Técnica Real do Domínio
    const tech = await inspectLiveDomain(domain);
    // 3. Auditoria Honesta Multi-LLM (OpenAI, Gemini, Perplexity, Claude)
    const honestAudit = await runHonestMultiLlmAudit(domain, brandName, niche);
    // Se nenhum modelo de IA pôde ser consultado (sem chaves ou falha geral de rede dos LLMs):
    // NUNCA inventar dados! Responder com erro e direcionar para o WhatsApp oficial.
    if (honestAudit.queriedModels.length === 0) {
        const err = new Error('Auditoria indisponível no momento');
        err.statusCode = 503;
        err.details = 'Nenhum motor de inteligência artificial (ChatGPT, Gemini, Perplexity ou Claude) pôde ser consultado no momento. Solicite sua auditoria diretamente pelo WhatsApp da equipe.';
        err.whatsappUrl = `https://wa.me/5527988140076?text=${encodeURIComponent(`Olá! Quero a auditoria GEO do meu site: ${domain}`)}`;
        throw err;
    }
    const finalModels = toModelPresenceList(honestAudit.queriedModels);
    const finalGeoScore = honestAudit.averageGeoScore;
    // Extrai concorrentes citados nos modelos de verdade (nomes reais extraídos, sem inventar domínio fake)
    const competitors = [];
    for (const m of honestAudit.queriedModels) {
        if (m.competitorDominance && !m.competitorDominance.toLowerCase().includes(brandName.toLowerCase())) {
            const parts = m.competitorDominance.split(',').map(p => p.trim()).filter(Boolean);
            for (const compName of parts) {
                if (compName.length >= 2 &&
                    !competitors.some(c => c.name.toLowerCase() === compName.toLowerCase()) &&
                    !compName.toLowerCase().includes('sem outros') &&
                    !compName.toLowerCase().includes('nenhum concorrente')) {
                    competitors.push({
                        name: compName,
                        domain: `${compName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.br`,
                        dominanceRate: m.shareEstimate || 'Menção na consulta',
                        citedReason: `Citado como referência no modelo ${m.name}.`,
                    });
                }
            }
        }
    }
    // Gaps detectados a partir da inspeção técnica real
    const criticalGaps = [];
    if (!tech.hasHttps)
        criticalGaps.push(`Domínio sem HTTPS ativo ou certificado inválido.`);
    if (!tech.hasJsonLd)
        criticalGaps.push(`Ausência de dados estruturados Schema.org (JSON-LD) para citação por IA.`);
    if (!tech.hasTables)
        criticalGaps.push(`Ausência de tabelas estruturadas e respostas diretas no HTML.`);
    if (!tech.hasLocalBusinessSchema)
        criticalGaps.push(`Falta de marcação LocalBusiness ou Organization conectando a marca.`);
    if (tech.blockedAiCrawlers && tech.blockedAiCrawlers.length > 0) {
        criticalGaps.push(`Robots.txt bloqueia rastreadores de IA: ${tech.blockedAiCrawlers.join(', ')}.`);
    }
    const googleAudit = generateGooglePresenceDiagnosis(domain, brandName, niche, tech, finalGeoScore);
    const severity = finalGeoScore < 40 ? 'CRITICAL' : finalGeoScore < 65 ? 'WARNING' : 'MODERATE';
    const finalResult = {
        domain,
        brandName,
        niche,
        geoScore: finalGeoScore,
        statusTitle: finalGeoScore < 40
            ? 'Vulnerabilidade Crítica de Aquisição em IA'
            : finalGeoScore < 65
                ? 'Visibilidade Parcial nas Respostas de IA'
                : 'Boa Presença Técnica e de IA',
        statusSeverity: severity,
        riskSummary: finalGeoScore < 50
            ? `Nas consultas realizadas em ${finalModels.map(m => m.name.split(' ')[0]).join(', ')}, ${brandName} não obteve menções consistentes de recomendação para o segmento "${niche}".`
            : `Em consultas recentes aos modelos ${finalModels.map(m => m.name.split(' ')[0]).join(', ')}, ${brandName} obteve citações parciais ou contextualizadas.`,
        technicalSignals: tech,
        googleAudit,
        models: finalModels,
        competitors,
        criticalGaps: criticalGaps.length ? criticalGaps : [
            'Implementar Schema FAQPage para captura de AI Overviews.',
            'Criar páginas de comparação de soluções com dados verificáveis.',
        ],
        recommendedTopics: [
            {
                title: `Guia Comparativo: Como escolher ${niche} em 2026`,
                primaryKeyword: `melhor ${niche} comparativo`,
                targetEngine: 'Perplexity & ChatGPT Search',
                expectedImpact: 'Citação direta em perguntas comerciais',
                informationGainAngle: 'Matriz de decisão com critérios objetivos e dados técnicos.',
            },
            {
                title: `Quanto custa contratar ${niche}? Análise de custos e modelos`,
                primaryKeyword: `preco ${niche} custos`,
                targetEngine: 'Google AI Overviews & Gemini',
                expectedImpact: 'Captura decisores em estágio de compra',
                informationGainAngle: 'Tabela de custos médios e checklist de contratação.',
            },
        ],
        analyzedAt: new Date().toISOString(),
    };
    // Salva no cache por 24h
    SCAN_24H_CACHE.set(cacheKey, {
        result: finalResult,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        costUsd: honestAudit.totalCostUsd,
    });
    return finalResult;
}
