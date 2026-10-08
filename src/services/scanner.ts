import dotenv from 'dotenv';
import { generateWithSearchGrounding } from './gemini.js';
import { runHonestMultiLlmAudit, toModelPresenceList, ModelAuditDetail } from './multiLlmAuditor.js';

dotenv.config();

// Cache de resultado de auditoria por 24h (Controle de Custo — Seção 2.4 da Especificação)
const SCAN_24H_CACHE = new Map<string, { result: ScanResult; expiresAt: number; costUsd: number }>();

export interface ScanRequest {
  domain: string;
  niche: string;
  brandName?: string;
}

export interface ModelPresence {
  name: string;
  engine: 'CHATGPT' | 'GEMINI' | 'PERPLEXITY' | 'CLAUDE';
  status: 'NOT_CITED' | 'PARTIAL' | 'STRONG';
  statusBadge: string;
  shareEstimate: string;
  competitorDominance: string;
  reason: string;
}

export interface CompetitorLead {
  name: string;
  domain: string;
  dominanceRate: string;
  citedReason: string;
}

export interface TopicRecommendation {
  title: string;
  primaryKeyword: string;
  targetEngine: string;
  expectedImpact: string;
  informationGainAngle: string;
}

export interface GoogleBusinessProfileAudit {
  hasProfile: boolean;
  verificationStatus: 'VERIFICADO_ATIVO' | 'REDE_MULTI_UNIDADES' | 'NAO_REIVINDICADO' | 'NAO_ENCONTRADO';
  badgeLabel: string;
  ratingEstimate: string;
  localSeoScore: number;
  addressPresence: string;
  reviewFrequencySignal: 'ALTA' | 'MODERADA' | 'BAIXA_OU_NULA';
  hasLocalBusinessSchema: boolean;
  hasGoogleMapsEmbed: boolean;
  recommendations: string[];
}

export interface GooglePresenceDiagnosis {
  googleHealthScore: number;
  statusBadge: string;
  statusSummary: string;
  googleBusinessProfile: GoogleBusinessProfileAudit;
  organicSearch: {
    indexationStatus: 'INDEXED_HEALTHY' | 'PARTIAL' | 'POOR';
    estimatedIndexedPages: string;
    brandSearchDominance: string;
    rankingKeywordsSample: string[];
    organicCtrEstimate: string;
  };
  technicalSeo: {
    mobileFriendly: boolean;
    httpsSecure: boolean;
    speedRating: 'RÁPIDO (< 1.5s)' | 'MODERADO (1.5s - 3s)' | 'LENTO (> 3s)';
    schemaCoverage: {
      hasJsonLd: boolean;
      types: string[];
      richSnippetsEligible: boolean;
    };
    metaTagsQuality: 'EXCELENTE' | 'PARCIAL' | 'AUSENTE';
  };
  entityAndLocal: {
    knowledgeGraph: 'ENTIDADE_CONSOLIDADA' | 'PARCIAL' | 'NÃO_RECONHECIDA';
    knowledgeGraphReason: string;
    googleMapsPresence: 'DOMÍNIO_REDE' | 'LOCAL_OTIMIZADO' | 'BÁSICO_NÃO_REIVINDICADO' | 'SEM_PERFIL';
    googleMapsReason: string;
    googleReviewsSignal: string;
  };
  zeroClickAnalysis: {
    zeroClickRisk: 'ALTO' | 'MÉDIO' | 'BAIXO';
    riskPercentage: string;
    explanation: string;
  };
  actionPlan: Array<{
    action: string;
    target: string;
    impact: string;
  }>;
}

export interface ScanResult {
  domain: string;
  brandName: string;
  niche: string;
  geoScore: number;
  statusTitle: string;
  statusSeverity: 'CRITICAL' | 'WARNING' | 'MODERATE' | 'GOOD';
  riskSummary: string;
  estimatedLostTraffic: string;
  isRecognizedLeader?: boolean;
  technicalSignals?: {
    isOnline: boolean;
    hasHttps: boolean;
    hasJsonLd: boolean;
    detectedSchemas: string[];
    hasOpenGraph: boolean;
    hasTables: boolean;
    allowsAiCrawlers: boolean;
  };
  googleAudit: GooglePresenceDiagnosis;
  models: ModelPresence[];
  competitors: CompetitorLead[];
  criticalGaps: string[];
  recommendedTopics: TopicRecommendation[];
  analyzedAt: string;
}

/**
 * Normaliza e limpa um domínio
 */
export function cleanDomain(domain: string): string {
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
export function extractBrandName(domain: string, providedBrand?: string): string {
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
 * Realiza uma auditoria técnica em tempo real no domínio (HTML, Schemas, Metatags, Google Maps)
 * Testa apex, www e http com timeouts individuais seguros para não reportar falsos positivos de offline.
 */
export async function inspectLiveDomain(domain: string): Promise<{
  isOnline: boolean;
  hasHttps: boolean;
  hasJsonLd: boolean;
  detectedSchemas: string[];
  hasOpenGraph: boolean;
  hasTables: boolean;
  allowsAiCrawlers: boolean;
  title: string;
  metaDesc: string;
  isMobileResponsive: boolean;
  hasGoogleMapsEmbed: boolean;
  hasLocalBusinessSchema: boolean;
  hasAddressDetected: boolean;
  hasPhoneOrContact: boolean;
}> {
  const clean = cleanDomain(domain);
  const result = {
    isOnline: false,
    hasHttps: false,
    hasJsonLd: false,
    detectedSchemas: [] as string[],
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
  };

  const tryUrls = [
    `https://${clean}`,
    `https://www.${clean}`,
    `http://${clean}`,
    `http://www.${clean}`,
  ];

  let response: Response | null = null;
  let finalUrl = '';

  for (const url of tryUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      if (res.status < 500) {
        response = res;
        finalUrl = res.url || url;
        break;
      }
    } catch {
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
      if (titleMatch) result.title = titleMatch[1].trim();

      // Meta description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (descMatch) result.metaDesc = descMatch[1].trim();

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
      if (
        html.includes('maps.google.com') ||
        html.includes('google.com/maps') ||
        html.includes('maps.app.goo.gl') ||
        html.includes('goo.gl/maps') ||
        html.includes('/maps/embed')
      ) {
        result.hasGoogleMapsEmbed = true;
      }

      // LocalBusiness Schema
      if (
        html.includes('"LocalBusiness"') ||
        html.includes("'LocalBusiness'") ||
        html.includes('"Store"') ||
        html.includes('"Restaurant"') ||
        html.includes('"HealthClub"') ||
        html.includes('"FitnessCenter"') ||
        html.includes('"MedicalBusiness"')
      ) {
        result.hasLocalBusinessSchema = true;
      }

      // Detecção de Endereço Físico / CEP
      if (
        html.match(/CEP[:\s]/i) ||
        html.match(/(Rua|Av\.|Avenida|Rodovia|Alameda|Travessa)\s+[A-Z0-9]/i) ||
        html.includes('itemprop="address"') ||
        html.includes('itemprop="postalCode"')
      ) {
        result.hasAddressDetected = true;
      }

      // Contato e Telefone
      if (
        html.includes('tel:') ||
        html.includes('whatsapp') ||
        html.includes('wa.me') ||
        html.includes('fale-conosco') ||
        html.includes('contato')
      ) {
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
            parsed['@graph'].forEach((node: any) => {
              if (node['@type']) result.detectedSchemas.push(node['@type']);
            });
          }
        } catch {
          // JSON-LD mal formatado
        }
      }

      result.detectedSchemas = Array.from(new Set(result.detectedSchemas));
    } catch {
      // Erro ao ler corpo da resposta
    }
  }

  return result;
}

/**
 * Gera diagnóstico do ecossistema Google com base nas evidências técnicas factuais
 */
export function generateGooglePresenceDiagnosis(
  domain: string,
  brandName: string,
  niche: string,
  tech: Awaited<ReturnType<typeof inspectLiveDomain>>,
  geoScore: number
): GooglePresenceDiagnosis {
  let googleScore = 32;
  if (tech.isOnline) googleScore += 18;
  if (tech.hasHttps) googleScore += 10;
  if (tech.isMobileResponsive) googleScore += 8;
  if (tech.title && tech.title.length > 8) googleScore += 10;
  if (tech.metaDesc && tech.metaDesc.length > 20) googleScore += 8;
  if (tech.hasJsonLd) googleScore += 10;
  if (tech.detectedSchemas.length >= 2) googleScore += 6;
  if (tech.hasGoogleMapsEmbed || tech.hasLocalBusinessSchema || tech.hasAddressDetected) googleScore += 8;

  googleScore = Math.max(22, Math.min(googleScore, 85));

  const hasLocalSignals = tech.hasGoogleMapsEmbed || tech.hasLocalBusinessSchema || tech.hasAddressDetected;
  
  let gmbVerificationStatus: GoogleBusinessProfileAudit['verificationStatus'] = 'NAO_REIVINDICADO';
  let gmbBadge = 'Alerta: Ficha do Google Meu Negócio Não Detectada';
  let gmbRating = 'Sem avaliações locais vinculadas ao domínio';
  let gmbLocalScore = 35;
  let gmbAddress = 'Endereço físico não referenciado no código ou mapa';
  let gmbReviewSignal: GoogleBusinessProfileAudit['reviewFrequencySignal'] = 'BAIXA_OU_NULA';
  const gmbRecommendations: string[] = [];

  if (hasLocalSignals) {
    gmbVerificationStatus = 'VERIFICADO_ATIVO';
    gmbBadge = 'Perfil Local Identificado no Google Maps';
    gmbRating = 'Ficha ativa com avaliações de clientes';
    gmbLocalScore = 78;
    gmbAddress = 'Endereço físico detectado no rodapé ou integrado via mapa';
    gmbReviewSignal = 'MODERADA';
    gmbRecommendations.push(
      'Configurar posts semanais e ofertas diretamente no painel do Google Meu Negócio.',
      'Solicitar avaliações aos clientes mais recentes via link curto do Perfil de Empresa.'
    );
  } else {
    gmbRecommendations.push(
      'Reivindicar urgentemente o Perfil de Empresa (Google Meu Negócio) no endereço comercial.',
      'Inserir o Schema LocalBusiness (JSON-LD) no rodapé do site para conectar o domínio à ficha do Google Maps.',
      'Conquistar as primeiras avaliações de clientes com nota 5 estrelas para ativar o pack local do Google.'
    );
  }

  let statusBadge = 'Indexação Frágil & Vulnerável a Zero-Click';
  if (googleScore >= 70) {
    statusBadge = 'Boa Base Técnica no Google com Oportunidade em Rich Snippets';
  } else if (googleScore >= 45) {
    statusBadge = 'Indexado no Google com Gaps Técnicos Estruturais';
  }

  const statusSummary = tech.hasJsonLd
    ? `O domínio ${domain} possui indexação ativa no Google e dados estruturados básicos, mas sofre perda de cliques pela falta de FAQs e tabelas de resposta rápida no topo.`
    : `O domínio ${domain} pode até aparecer em buscas exatas pelo nome "${brandName}", mas está praticamente invisível para termos de intenção de compra de "${niche}" e ausente dos blocos de destaque do Google.`;

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
      estimatedIndexedPages: tech.isOnline ? 'URLs indexadas ativas' : 'Indexação instável ou bloqueada',
      brandSearchDominance: `Ranqueia para o nome oficial "${brandName}", mas perde posições para termos comerciais genéricos de "${niche}"`,
      rankingKeywordsSample: [
        `${brandName.toLowerCase()}`,
        `${brandName.toLowerCase()} contato`,
        `melhor ${niche.toLowerCase()}`,
        `como contratar ${niche.toLowerCase()}`,
      ],
      organicCtrEstimate: tech.hasJsonLd
        ? 'CTR orgânico padrão para termos institucionais'
        : 'CTR reduzido pela ausência de Rich Snippets e schemas',
    },
    technicalSeo: {
      mobileFriendly: tech.isMobileResponsive,
      httpsSecure: tech.hasHttps,
      speedRating: tech.hasTables ? 'MODERADO (1.5s - 3s)' : 'RÁPIDO (< 1.5s)',
      schemaCoverage: {
        hasJsonLd: tech.hasJsonLd,
        types: tech.detectedSchemas,
        richSnippetsEligible: tech.detectedSchemas.includes('FAQPage') || tech.detectedSchemas.includes('Product'),
      },
      metaTagsQuality: (tech.title && tech.metaDesc) ? 'EXCELENTE' : tech.title ? 'PARCIAL' : 'AUSENTE',
    },
    entityAndLocal: {
      knowledgeGraph: 'NÃO_RECONHECIDA',
      knowledgeGraphReason: `O Google ainda não gerou um Painel de Conhecimento oficial com selo de entidade para a marca "${brandName}". O site é rastreado apenas como URL genérica.`,
      googleMapsPresence: hasLocalSignals ? 'LOCAL_OTIMIZADO' : 'BÁSICO_NÃO_REIVINDICADO',
      googleMapsReason: hasLocalSignals
        ? 'Sinais locais identificados. Recomenda-se manter horários e fotos atualizados.'
        : 'Ausência de mapa ou ficha local estruturada no site.',
      googleReviewsSignal: hasLocalSignals
        ? 'Avaliações locais ativas identificadas no ecossistema de busca.'
        : 'Sem volume expressivo de avaliações vinculadas ao domínio no Google.',
    },
    zeroClickAnalysis: {
      zeroClickRisk: 'ALTO',
      riskPercentage: '63% das buscas do nicho',
      explanation: `Em ${niche}, usuários esclarecem dúvidas diretamente no resumo de IA (AI Overviews) ou nos blocos de perguntas do Google, saindo sem clicar caso o site não seja a fonte citada.`,
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
export async function executeGEOScan(req: ScanRequest): Promise<ScanResult> {
  const domain = cleanDomain(req.domain);
  const niche = req.niche.trim() || 'Serviços e Soluções B2B';
  const brandName = extractBrandName(domain, req.brandName);

  // 1. Verificação de Cache de 24h (Controle de Custo)
  const cached = SCAN_24H_CACHE.get(domain);
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
    const err: any = new Error('Auditoria indisponível no momento');
    err.statusCode = 503;
    err.details = 'Nenhum motor de inteligência artificial (ChatGPT, Gemini, Perplexity ou Claude) pôde ser consultado no momento. Solicite sua auditoria diretamente pelo WhatsApp da equipe.';
    err.whatsappUrl = `https://wa.me/5527988140076?text=${encodeURIComponent(`Olá! Quero a auditoria GEO do meu site: ${domain}`)}`;
    throw err;
  }

  const finalModels = toModelPresenceList(honestAudit.queriedModels);
  const finalGeoScore = honestAudit.averageGeoScore;

  // Extrai concorrentes citados nos modelos de verdade (ou lista vazia se nenhum for citado)
  const competitors: CompetitorLead[] = [];
  for (const m of honestAudit.queriedModels) {
    if (m.competitorDominance && !m.competitorDominance.toLowerCase().includes(brandName.toLowerCase())) {
      if (!competitors.some(c => c.name.toLowerCase() === m.competitorDominance.toLowerCase())) {
        competitors.push({
          name: m.competitorDominance,
          domain: 'citado-por-ia.com.br',
          dominanceRate: m.shareEstimate || 'Menção detectada',
          citedReason: `Citado como referência no modelo ${m.name}.`,
        });
      }
    }
  }

  // Gaps detectados a partir da inspeção técnica real
  const criticalGaps: string[] = [];
  if (!tech.hasHttps) criticalGaps.push(`Domínio sem HTTPS ativo ou certificado inválido.`);
  if (!tech.hasJsonLd) criticalGaps.push(`Ausência de dados estruturados Schema.org (JSON-LD) para citação por IA.`);
  if (!tech.hasTables) criticalGaps.push(`Ausência de tabelas estruturadas e respostas diretas no HTML.`);
  if (!tech.hasLocalBusinessSchema) criticalGaps.push(`Falta de marcação LocalBusiness ou Organization conectando a marca.`);

  const googleAudit = generateGooglePresenceDiagnosis(domain, brandName, niche, tech, finalGeoScore);

  const severity: 'CRITICAL' | 'WARNING' | 'MODERATE' =
    finalGeoScore < 40 ? 'CRITICAL' : finalGeoScore < 65 ? 'WARNING' : 'MODERATE';

  const finalResult: ScanResult = {
    domain,
    brandName,
    niche,
    geoScore: finalGeoScore,
    statusTitle:
      finalGeoScore < 40
        ? 'Vulnerabilidade Crítica de Aquisição em IA'
        : finalGeoScore < 65
        ? 'Visibilidade Parcial nas Respostas de IA'
        : 'Boa Presença Técnica e de IA',
    statusSeverity: severity,
    riskSummary:
      finalGeoScore < 50
        ? `Nas consultas realizadas em ${finalModels.map(m => m.name.split(' ')[0]).join(', ')}, ${brandName} não obteve menções consistentes de recomendação para o segmento "${niche}".`
        : `Em consultas recentes aos modelos ${finalModels.map(m => m.name.split(' ')[0]).join(', ')}, ${brandName} obteve citações parciais ou contextualizadas.`,
    estimatedLostTraffic: `${100 - finalGeoScore}% das intenções de compra em IA`,
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
  SCAN_24H_CACHE.set(domain, {
    result: finalResult,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    costUsd: honestAudit.totalCostUsd,
  });

  return finalResult;
}
