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
    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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
function analyzeModelResponseText(text, domain, brandName) {
    const lower = text.toLowerCase();
    const cleanBrand = brandName.toLowerCase();
    const cleanDom = domain.toLowerCase();
    const brandFound = lower.includes(cleanBrand);
    const domainFound = lower.includes(cleanDom);
    const urlRegex = /https?:\/\/[^\s)"]+/g;
    const citedUrls = text.match(urlRegex) || [];
    if (brandFound || domainFound) {
        // Calcula rank aproximado pelo parágrafo/ordem
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        let rank = 1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(cleanBrand) || lines[i].toLowerCase().includes(cleanDom)) {
                rank = i + 1;
                break;
            }
        }
        if (rank <= 3) {
            return {
                isMentioned: true,
                rank,
                status: 'STRONG',
                badge: `Líder Citado (#${rank})`,
                share: '45% a 70% de Share of Model',
                competitors: 'Concorrentes dividem menções secundárias',
                reason: `A marca ${brandName} é destacada entre os primeiros resultados recomendados pelo modelo.`,
                citedUrls,
            };
        }
        else {
            return {
                isMentioned: true,
                rank,
                status: 'PARTIAL',
                badge: `Menção Secundária (#${rank})`,
                share: '15% a 30% de Share of Model',
                competitors: 'Concorrentes dominam o topo da resposta',
                reason: `A marca ${brandName} é citada, porém posicionada abaixo de concorrentes líderes.`,
                citedUrls,
            };
        }
    }
    return {
        isMentioned: false,
        rank: null,
        status: 'NOT_CITED',
        badge: 'Invisível no Modelo',
        share: '< 5% de Share of Model',
        competitors: 'Concorrentes capturam 100% das recomendações',
        reason: `Nenhuma citação de ${brandName} ou do domínio ${domain} identificada na resposta do modelo para o nicho consultado.`,
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
