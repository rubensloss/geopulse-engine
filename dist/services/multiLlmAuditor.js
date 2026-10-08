import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
dotenv.config();
// Inicializadores sob demanda
function getOpenAIClient() {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAI({ apiKey: key }) : null;
}
function getAnthropicClient() {
    const key = process.env.ANTHROPIC_API_KEY;
    return key ? new Anthropic({ apiKey: key }) : null;
}
function getPerplexityClient() {
    const key = process.env.PERPLEXITY_API_KEY;
    return key ? new OpenAI({ apiKey: key, baseURL: 'https://api.perplexity.ai' }) : null;
}
function getGeminiClient() {
    const key = process.env.GEMINI_API_KEY;
    return key ? new GoogleGenAI({ apiKey: key }) : null;
}
/**
 * Consulta de verdade os modelos oficiais (OpenAI, Gemini, Perplexity, Anthropic)
 * Conforme Regra 2.3: "Se um modelo não for consultado, ele não aparece no relatório."
 */
export async function runHonestMultiLlmAudit(domain, brandName, niche) {
    const prompt = `Quais são as principais, mais recomendadas e líderes empresas no segmento de ${niche} no Brasil? Cite as principais marcas, pontos fortes e fontes de referência.`;
    const modelsToQuery = [];
    // 1. ChatGPT (OpenAI)
    const openai = getOpenAIClient();
    if (openai) {
        modelsToQuery.push(queryOpenAiModel(openai, prompt, domain, brandName, niche));
    }
    // 2. Google Gemini
    const gemini = getGeminiClient();
    if (gemini) {
        modelsToQuery.push(queryGeminiModel(gemini, prompt, domain, brandName, niche));
    }
    // 3. Perplexity (Sonar)
    const perplexity = getPerplexityClient();
    if (perplexity) {
        modelsToQuery.push(queryPerplexityModel(perplexity, prompt, domain, brandName, niche));
    }
    // 4. Claude (Anthropic)
    const anthropic = getAnthropicClient();
    if (anthropic) {
        modelsToQuery.push(queryClaudeModel(anthropic, prompt, domain, brandName, niche));
    }
    // Executa todas as consultas em paralelo
    const results = await Promise.all(modelsToQuery);
    const validModels = results.filter((m) => m !== null);
    let totalCost = 0;
    let totalScore = 0;
    for (const model of validModels) {
        totalCost += model.costUsd;
        if (model.status === 'STRONG')
            totalScore += 100;
        else if (model.status === 'PARTIAL')
            totalScore += 50;
        else
            totalScore += 10;
    }
    const averageGeoScore = validModels.length > 0 ? Math.round(totalScore / validModels.length) : 0;
    return {
        queriedModels: validModels,
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        averageGeoScore,
        analyzedAt: new Date().toISOString(),
    };
}
async function queryOpenAiModel(client, prompt, domain, brandName, _niche) {
    const modelName = process.env.OPENAI_MODEL || 'gpt-4o';
    try {
        const res = await client.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
            temperature: 0.3,
        });
        const text = res.choices[0]?.message?.content || '';
        const analysis = analyzeModelResponseText(text, domain, brandName);
        return {
            engine: 'CHATGPT',
            name: `ChatGPT (OpenAI ${modelName})`,
            isMentioned: analysis.isMentioned,
            mentionRank: analysis.rank,
            status: analysis.status,
            statusBadge: analysis.badge,
            shareEstimate: analysis.share,
            competitorDominance: analysis.competitors,
            reason: analysis.reason,
            rawResponse: text,
            citedSources: analysis.citedUrls,
            costUsd: 0.0008,
        };
    }
    catch (err) {
        console.warn('[MultiLLM Auditor] Erro ao consultar ChatGPT:', err);
        return null;
    }
}
async function queryGeminiModel(client, prompt, domain, brandName, _niche) {
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    try {
        const res = await client.models.generateContent({
            model: modelName,
            contents: prompt,
        });
        const text = res.text || '';
        const analysis = analyzeModelResponseText(text, domain, brandName);
        return {
            engine: 'GEMINI',
            name: `Google Gemini (${modelName})`,
            isMentioned: analysis.isMentioned,
            mentionRank: analysis.rank,
            status: analysis.status,
            statusBadge: analysis.badge,
            shareEstimate: analysis.share,
            competitorDominance: analysis.competitors,
            reason: analysis.reason,
            rawResponse: text,
            citedSources: analysis.citedUrls,
            costUsd: 0.0005,
        };
    }
    catch (err) {
        console.warn('[MultiLLM Auditor] Erro ao consultar Gemini:', err);
        return null;
    }
}
async function queryPerplexityModel(client, prompt, domain, brandName, _niche) {
    const modelName = process.env.PERPLEXITY_MODEL || 'sonar';
    try {
        const res = await client.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 600,
        });
        const text = res.choices[0]?.message?.content || '';
        const citations = res.citations || [];
        const analysis = analyzeModelResponseText(text, domain, brandName);
        return {
            engine: 'PERPLEXITY',
            name: `Perplexity AI (${modelName})`,
            isMentioned: analysis.isMentioned,
            mentionRank: analysis.rank,
            status: analysis.status,
            statusBadge: analysis.badge,
            shareEstimate: analysis.share,
            competitorDominance: analysis.competitors,
            reason: analysis.reason,
            rawResponse: text,
            citedSources: citations,
            costUsd: 0.0015,
        };
    }
    catch (err) {
        console.warn('[MultiLLM Auditor] Erro ao consultar Perplexity:', err);
        return null;
    }
}
async function queryClaudeModel(client, prompt, domain, brandName, _niche) {
    const modelName = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
    try {
        const res = await client.messages.create({
            model: modelName,
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
        });
        const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
        const analysis = analyzeModelResponseText(text, domain, brandName);
        return {
            engine: 'CLAUDE',
            name: `Claude (Anthropic ${modelName})`,
            isMentioned: analysis.isMentioned,
            mentionRank: analysis.rank,
            status: analysis.status,
            statusBadge: analysis.badge,
            shareEstimate: analysis.share,
            competitorDominance: analysis.competitors,
            reason: analysis.reason,
            rawResponse: text,
            citedSources: analysis.citedUrls,
            costUsd: 0.001,
        };
    }
    catch (err) {
        console.warn('[MultiLLM Auditor] Erro ao consultar Claude:', err);
        return null;
    }
}
export function normalizeText(str) {
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
export function extractMentionedCompanies(text, currentBrand, currentDomain) {
    const normCurrent = normalizeText(currentBrand);
    const normDomain = normalizeText(currentDomain);
    const companies = [];
    const lines = text.split('\n');
    const ignoreWords = new Set([
        'introducao', 'conclusao', 'vantagens', 'dicas', 'pontosfortes', 'principais',
        'marcas', 'empresas', 'segmento', 'referencias', 'fontes', 'criterios',
        'mercado', 'brasil', 'resumo', 'servicos', 'solucoes', 'categoria', 'exemplo',
        'destaques', 'beneficios', 'recomendacoes', 'observacao', 'sobre'
    ]);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        // Reconhece listas como: "1. **Nome da Empresa**", "- **Nome**:", "1. Nome -"
        const match = trimmed.match(/^(?:(?:\d+[\.\)]|\*|-|\+)\s+)?(?:\*\*)?([A-Za-z0-9\sÀ-ÿ\.\-&]{2,45}?)(?:\*\*)?(?:\s*[:\-–—]\s*|\s*\([^)]*\)\s*[:\-–—]|$)/);
        if (match && match[1]) {
            const candidate = match[1].replace(/^\*\*|\*\*$/g, '').trim();
            const normCand = normalizeText(candidate);
            if (candidate.length >= 2 &&
                candidate.length <= 45 &&
                !ignoreWords.has(normCand) &&
                normCand !== normCurrent &&
                normCand !== normDomain &&
                !companies.some(c => normalizeText(c) === normCand)) {
                companies.push(candidate);
            }
        }
    }
    return companies.slice(0, 10);
}
function analyzeModelResponseText(text, domain, brandName) {
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
                competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 3).join(', ') : 'Sem outros líderes citados',
                reason: `A marca ${brandName} é mencionada como uma das primeiras recomendações da IA.`,
                citedUrls,
            };
        }
        else {
            return {
                isMentioned: true,
                rank: calculatedRank,
                status: 'PARTIAL',
                badge: `Menção Identificada (#${calculatedRank})`,
                share: `Citado na resposta (#${calculatedRank})`,
                competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 3).join(', ') : 'Concorrentes citados no mesmo nicho',
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
        competitors: realCompetitors.length > 0 ? realCompetitors.slice(0, 5).join(', ') : 'Nenhum concorrente específico extraído',
        reason: realCompetitors.length > 0
            ? `A marca ${brandName} não apareceu nas recomendações do modelo para esta pergunta. Empresas citadas: ${realCompetitors.slice(0, 3).join(', ')}.`
            : `Nenhuma citação de ${brandName} ou do domínio ${domain} foi encontrada na resposta do modelo para o nicho consultado.`,
        citedUrls,
    };
}
/**
 * Converte ModelAuditDetail para a interface esperada pelo scanner
 */
export function toModelPresenceList(details) {
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
