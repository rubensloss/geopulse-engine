import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { ModelPresence } from './scanner.js';

dotenv.config();

export interface ModelAuditDetail {
  engine: 'CHATGPT' | 'GEMINI' | 'PERPLEXITY' | 'CLAUDE';
  name: string;
  isMentioned: boolean;
  mentionRank: number | null;
  status: 'NOT_CITED' | 'PARTIAL' | 'STRONG';
  statusBadge: string;
  shareEstimate: string;
  competitorDominance: string;
  reason: string;
  rawResponse: string;
  citedSources: string[];
  costUsd: number;
}

export interface MultiLlmAuditResult {
  queriedModels: ModelAuditDetail[];
  totalCostUsd: number;
  averageGeoScore: number;
  analyzedAt: string;
}

// Inicializadores sob demanda
function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAI({ apiKey: key }) : null;
}

function getAnthropicClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new Anthropic({ apiKey: key }) : null;
}

function getPerplexityClient(): OpenAI | null {
  const key = process.env.PERPLEXITY_API_KEY;
  return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.perplexity.ai' }) : null;
}

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  return key ? new GoogleGenAI({ apiKey: key }) : null;
}

/**
 * Consulta de verdade os modelos oficiais (OpenAI, Gemini, Perplexity, Anthropic)
 * Conforme Regra 2.3: "Se um modelo não for consultado, ele não aparece no relatório."
 */
export function buildNicheAuditPrompts(niche: string): string[] {
  return [
    `Quais são as principais empresas, líderes e mais recomendadas no segmento de ${niche} no Brasil? Cite as principais marcas e referências de mercado.`,
    `Qual é a melhor empresa ou prestadora de serviço para contratar em ${niche} no Brasil? Destaque as soluções mais confiáveis e avaliadas.`,
    `Quem são as maiores referências e especialistas com autoridade em ${niche} no Brasil? Compare quem mais se sobressai no setor.`,
  ];
}

/**
 * Consulta de verdade os modelos oficiais (OpenAI, Gemini, Perplexity, Anthropic)
 * Executa 3 perguntas representativas do nicho por modelo para mensurar presença factual ("citado em X de 3 respostas").
 * Conforme Regra: "Se um modelo não for consultado, ele não aparece no relatório."
 */
export async function runHonestMultiLlmAudit(
  domain: string,
  brandName: string,
  niche: string
): Promise<MultiLlmAuditResult> {
  const prompts = buildNicheAuditPrompts(niche);

  const modelsToQuery: Promise<ModelAuditDetail | null>[] = [];

  // 1. ChatGPT (OpenAI)
  const openai = getOpenAIClient();
  if (openai) {
    modelsToQuery.push(
      queryOpenAiModel(openai, prompts, domain, brandName, niche)
    );
  }

  // 2. Google Gemini
  const gemini = getGeminiClient();
  if (gemini) {
    modelsToQuery.push(
      queryGeminiModel(gemini, prompts, domain, brandName, niche)
    );
  }

  // 3. Perplexity (Sonar)
  const perplexity = getPerplexityClient();
  if (perplexity) {
    modelsToQuery.push(
      queryPerplexityModel(perplexity, prompts, domain, brandName, niche)
    );
  }

  // 4. Claude (Anthropic)
  const anthropic = getAnthropicClient();
  if (anthropic) {
    modelsToQuery.push(
      queryClaudeModel(anthropic, prompts, domain, brandName, niche)
    );
  }

  // Executa todas as consultas em paralelo
  const results = await Promise.all(modelsToQuery);
  const validModels = results.filter((m): m is ModelAuditDetail => m !== null);

  let totalCost = 0;
  let totalScore = 0;

  for (const model of validModels) {
    totalCost += model.costUsd;
    if (model.status === 'STRONG') totalScore += 100;
    else if (model.status === 'PARTIAL') totalScore += 50;
    else totalScore += 10;
  }

  const averageGeoScore = validModels.length > 0 ? Math.round(totalScore / validModels.length) : 0;

  return {
    queriedModels: validModels,
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    averageGeoScore,
    analyzedAt: new Date().toISOString(),
  };
}

async function queryOpenAiModel(
  client: OpenAI,
  prompts: string[],
  domain: string,
  brandName: string,
  _niche: string
): Promise<ModelAuditDetail | null> {
  const modelName = process.env.OPENAI_MODEL || 'gpt-4o';
  try {
    const responses = await Promise.all(
      prompts.map(prompt =>
        client.chat.completions.create({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 0.3,
        })
      )
    );

    const texts = responses.map(r => r.choices[0]?.message?.content || '');
    const analyses = texts.map(t => analyzeModelResponseText(t, domain, brandName));

    const mentionsCount = analyses.filter(a => a.isMentioned).length;
    const allCompetitors = Array.from(
      new Set(
        analyses
          .flatMap(a => a.competitors.split(',').map(c => c.trim()))
          .filter(c => c.length >= 2 && !c.toLowerCase().includes(brandName.toLowerCase()))
      )
    );
    const allCitedUrls = Array.from(new Set(analyses.flatMap(a => a.citedUrls)));

    const status: 'NOT_CITED' | 'PARTIAL' | 'STRONG' =
      mentionsCount >= 2 ? 'STRONG' : mentionsCount === 1 ? 'PARTIAL' : 'NOT_CITED';
    const statusBadge =
      mentionsCount >= 2
        ? `Forte Presença (${mentionsCount}/3 citações)`
        : mentionsCount === 1
        ? `Presença Parcial (1/3 citação)`
        : `Não Citado (0/3 respostas)`;

    return {
      engine: 'CHATGPT',
      name: `ChatGPT (OpenAI ${modelName})`,
      isMentioned: mentionsCount > 0,
      mentionRank: analyses.find(a => a.rank !== null)?.rank || null,
      status,
      statusBadge,
      shareEstimate: `Citado em ${mentionsCount} de 3 respostas`,
      competitorDominance: allCompetitors.slice(0, 5).join(', '),
      reason:
        mentionsCount > 0
          ? `A marca ${brandName} foi recomendada em ${mentionsCount} de 3 perguntas técnicas do segmento.`
          : `A marca ${brandName} não figurou nas respostas para as 3 consultas de mercado avaliadas.`,
      rawResponse: texts.join('\n\n---\n\n'),
      citedSources: allCitedUrls,
      costUsd: 0.0024,
    };
  } catch (err) {
    console.warn('[MultiLLM Auditor] Erro ao consultar ChatGPT:', err);
    return null;
  }
}

async function queryGeminiModel(
  client: GoogleGenAI,
  prompts: string[],
  domain: string,
  brandName: string,
  _niche: string
): Promise<ModelAuditDetail | null> {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const responses = await Promise.all(
      prompts.map(prompt =>
        client.models.generateContent({
          model: modelName,
          contents: prompt,
        })
      )
    );

    const texts = responses.map(r => r.text || '');
    const analyses = texts.map(t => analyzeModelResponseText(t, domain, brandName));

    const mentionsCount = analyses.filter(a => a.isMentioned).length;
    const allCompetitors = Array.from(
      new Set(
        analyses
          .flatMap(a => a.competitors.split(',').map(c => c.trim()))
          .filter(c => c.length >= 2 && !c.toLowerCase().includes(brandName.toLowerCase()))
      )
    );
    const allCitedUrls = Array.from(new Set(analyses.flatMap(a => a.citedUrls)));

    const status: 'NOT_CITED' | 'PARTIAL' | 'STRONG' =
      mentionsCount >= 2 ? 'STRONG' : mentionsCount === 1 ? 'PARTIAL' : 'NOT_CITED';
    const statusBadge =
      mentionsCount >= 2
        ? `Forte Presença (${mentionsCount}/3 citações)`
        : mentionsCount === 1
        ? `Presença Parcial (1/3 citação)`
        : `Não Citado (0/3 respostas)`;

    return {
      engine: 'GEMINI',
      name: `Google Gemini (${modelName})`,
      isMentioned: mentionsCount > 0,
      mentionRank: analyses.find(a => a.rank !== null)?.rank || null,
      status,
      statusBadge,
      shareEstimate: `Citado em ${mentionsCount} de 3 respostas`,
      competitorDominance: allCompetitors.slice(0, 5).join(', '),
      reason:
        mentionsCount > 0
          ? `A marca ${brandName} foi citada em ${mentionsCount} de 3 perguntas consultadas no Gemini.`
          : `A marca ${brandName} não figurou nas respostas do Gemini para as 3 consultas de mercado avaliadas.`,
      rawResponse: texts.join('\n\n---\n\n'),
      citedSources: allCitedUrls,
      costUsd: 0.0015,
    };
  } catch (err) {
    console.warn('[MultiLLM Auditor] Erro ao consultar Gemini:', err);
    return null;
  }
}

async function queryPerplexityModel(
  client: OpenAI,
  prompts: string[],
  domain: string,
  brandName: string,
  _niche: string
): Promise<ModelAuditDetail | null> {
  const modelName = process.env.PERPLEXITY_MODEL || 'sonar';
  try {
    const responses = await Promise.all(
      prompts.map(prompt =>
        client.chat.completions.create({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
        })
      )
    );

    const texts = responses.map(r => r.choices[0]?.message?.content || '');
    const citations = responses.flatMap(r => (r as any).citations || []);
    const analyses = texts.map(t => analyzeModelResponseText(t, domain, brandName));

    const mentionsCount = analyses.filter(a => a.isMentioned).length;
    const allCompetitors = Array.from(
      new Set(
        analyses
          .flatMap(a => a.competitors.split(',').map(c => c.trim()))
          .filter(c => c.length >= 2 && !c.toLowerCase().includes(brandName.toLowerCase()))
      )
    );
    const allCitedUrls = Array.from(new Set([...citations, ...analyses.flatMap(a => a.citedUrls)]));

    const status: 'NOT_CITED' | 'PARTIAL' | 'STRONG' =
      mentionsCount >= 2 ? 'STRONG' : mentionsCount === 1 ? 'PARTIAL' : 'NOT_CITED';
    const statusBadge =
      mentionsCount >= 2
        ? `Forte Presença (${mentionsCount}/3 citações)`
        : mentionsCount === 1
        ? `Presença Parcial (1/3 citação)`
        : `Não Citado (0/3 respostas)`;

    return {
      engine: 'PERPLEXITY',
      name: `Perplexity AI (${modelName})`,
      isMentioned: mentionsCount > 0,
      mentionRank: analyses.find(a => a.rank !== null)?.rank || null,
      status,
      statusBadge,
      shareEstimate: `Citado em ${mentionsCount} de 3 respostas`,
      competitorDominance: allCompetitors.slice(0, 5).join(', '),
      reason:
        mentionsCount > 0
          ? `Perplexity citou a marca ${brandName} em ${mentionsCount} de 3 perguntas de busca e síntese.`
          : `Perplexity não citou ${brandName} nas 3 perguntas realizadas sobre o setor.`,
      rawResponse: texts.join('\n\n---\n\n'),
      citedSources: allCitedUrls,
      costUsd: 0.0045,
    };
  } catch (err) {
    console.warn('[MultiLLM Auditor] Erro ao consultar Perplexity:', err);
    return null;
  }
}

async function queryClaudeModel(
  client: Anthropic,
  prompts: string[],
  domain: string,
  brandName: string,
  _niche: string
): Promise<ModelAuditDetail | null> {
  const modelName = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  try {
    const responses = await Promise.all(
      prompts.map(prompt =>
        client.messages.create({
          model: modelName,
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        })
      )
    );

    const texts = responses.map(r => (r.content[0]?.type === 'text' ? r.content[0].text : ''));
    const analyses = texts.map(t => analyzeModelResponseText(t, domain, brandName));

    const mentionsCount = analyses.filter(a => a.isMentioned).length;
    const allCompetitors = Array.from(
      new Set(
        analyses
          .flatMap(a => a.competitors.split(',').map(c => c.trim()))
          .filter(c => c.length >= 2 && !c.toLowerCase().includes(brandName.toLowerCase()))
      )
    );
    const allCitedUrls = Array.from(new Set(analyses.flatMap(a => a.citedUrls)));

    const status: 'NOT_CITED' | 'PARTIAL' | 'STRONG' =
      mentionsCount >= 2 ? 'STRONG' : mentionsCount === 1 ? 'PARTIAL' : 'NOT_CITED';
    const statusBadge =
      mentionsCount >= 2
        ? `Forte Presença (${mentionsCount}/3 citações)`
        : mentionsCount === 1
        ? `Presença Parcial (1/3 citação)`
        : `Não Citado (0/3 respostas)`;

    return {
      engine: 'CLAUDE',
      name: `Claude (Anthropic ${modelName})`,
      isMentioned: mentionsCount > 0,
      mentionRank: analyses.find(a => a.rank !== null)?.rank || null,
      status,
      statusBadge,
      shareEstimate: `Citado em ${mentionsCount} de 3 respostas`,
      competitorDominance: allCompetitors.slice(0, 5).join(', '),
      reason:
        mentionsCount > 0
          ? `Claude recomendou ${brandName} em ${mentionsCount} de 3 perguntas avaliadas.`
          : `Claude não citou ${brandName} nas 3 consultas do nicho.`,
      rawResponse: texts.join('\n\n---\n\n'),
      citedSources: allCitedUrls,
      costUsd: 0.003,
    };
  } catch (err) {
    console.warn('[MultiLLM Auditor] Erro ao consultar Claude:', err);
    return null;
  }
}

export function normalizeText(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Extrai empresas/marcas reais citadas no texto da resposta da IA.
 * Não inventa concorrentes nem domínios falsos.
 */
export function extractMentionedCompanies(text: string, currentBrand: string, currentDomain: string): string[] {
  const normCurrent = normalizeText(currentBrand);
  const normDomain = normalizeText(currentDomain);
  const companies: string[] = [];
  const lines = text.split('\n');

  const ignoreWords = new Set([
    'introducao', 'conclusao', 'vantagens', 'dicas', 'pontosfortes', 'principais',
    'marcas', 'empresas', 'segmento', 'referencias', 'fontes', 'criterios',
    'mercado', 'brasil', 'resumo', 'servicos', 'solucoes', 'categoria', 'exemplo',
    'destaques', 'beneficios', 'recomendacoes', 'observacao', 'sobre'
  ]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Reconhece listas como: "1. **Nome da Empresa**", "- **Nome**:", "1. Nome -"
    const match = trimmed.match(/^(?:(?:\d+[\.\)]|\*|-|\+)\s+)?(?:\*\*)?([A-Za-z0-9\sÀ-ÿ\.\-&]{2,45}?)(?:\*\*)?(?:\s*[:\-–—]\s*|\s*\([^)]*\)\s*[:\-–—]|$)/);
    if (match && match[1]) {
      const candidate = match[1].replace(/^\*\*|\*\*$/g, '').trim();
      const normCand = normalizeText(candidate);

      if (
        candidate.length >= 2 &&
        candidate.length <= 45 &&
        !ignoreWords.has(normCand) &&
        normCand !== normCurrent &&
        normCand !== normDomain &&
        !companies.some(c => normalizeText(c) === normCand)
      ) {
        companies.push(candidate);
      }
    }
  }

  return companies.slice(0, 10);
}

function analyzeModelResponseText(
  text: string,
  domain: string,
  brandName: string
): {
  isMentioned: boolean;
  rank: number | null;
  status: 'NOT_CITED' | 'PARTIAL' | 'STRONG';
  badge: string;
  share: string;
  competitors: string;
  reason: string;
  citedUrls: string[];
} {
  const normText = normalizeText(text);
  const normBrand = normalizeText(brandName);
  const normDom = normalizeText(domain);

  const brandFound = normText.includes(normBrand) || (normBrand.length >= 4 && normText.includes(normBrand));
  const domainFound = normText.includes(normDom) || (normDom.length >= 4 && normText.includes(normDom));

  const urlRegex = /https?:\/\/[^\s)"]+/g;
  const citedUrls = text.match(urlRegex) || [];

  const realCompetitors = extractMentionedCompanies(text, brandName, domain);

  if (brandFound || domainFound) {
    // Calcula posição real pela ordem de aparição dos concorrentes citados
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let brandLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const normLine = normalizeText(lines[i]);
      if (normLine.includes(normBrand) || normLine.includes(normDom)) {
        brandLineIndex = i;
        break;
      }
    }

    // Conta quantos concorrentes apareceram antes da marca no texto
    let competitorsBeforeBrand = 0;
    for (const comp of realCompetitors) {
      const normComp = normalizeText(comp);
      for (let i = 0; i < brandLineIndex && i < lines.length; i++) {
        if (normalizeText(lines[i]).includes(normComp)) {
          competitorsBeforeBrand++;
          break;
        }
      }
    }

    const calculatedRank = competitorsBeforeBrand + 1;

    if (calculatedRank <= 2) {
      return {
        isMentioned: true,
        rank: calculatedRank,
        status: 'STRONG',
        badge: `Líder Citado (#${calculatedRank})`,
        share: `Citado em posição de destaque (#${calculatedRank})`,
        competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 3).join(', ') : '',
        reason: `A marca ${brandName} é mencionada como uma das primeiras recomendações da IA.`,
        citedUrls,
      };
    } else {
      return {
        isMentioned: true,
        rank: calculatedRank,
        status: 'PARTIAL',
        badge: `Menção Identificada (#${calculatedRank})`,
        share: `Citado na resposta (#${calculatedRank})`,
        competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 3).join(', ') : '',
        reason: `A marca ${brandName} foi citada, precedida por outros concorrentes recomendados.`,
        citedUrls,
      };
    }
  }

  return {
    isMentioned: false,
    rank: null,
    status: 'NOT_CITED',
    badge: 'Não Citado nesta Consulta',
    share: '0 menções registradas na resposta do modelo',
    competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 5).join(', ') : '',
    reason: realCompetitors.length > 0
      ? `A marca ${brandName} não apareceu nas recomendações do modelo para esta pergunta. Empresas citadas: ${realCompetitors.slice(0, 3).join(', ')}.`
      : `Nenhuma citação de ${brandName} ou do domínio ${domain} foi encontrada na resposta do modelo para o nicho consultado.`,
    citedUrls,
  };
}

/**
 * Converte ModelAuditDetail para a interface esperada pelo scanner
 */
export function toModelPresenceList(details: ModelAuditDetail[]): ModelPresence[] {
  return details.map(d => ({
    name: d.name,
    engine: d.engine,
    status: d.status,
    statusBadge: d.statusBadge,
    shareEstimate: d.shareEstimate,
    competitorDominance: d.competitorDominance,
    reason: d.reason,
  }));
}

