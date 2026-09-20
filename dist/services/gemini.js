import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const apiKey = process.env.GEMINI_API_KEY;
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
if (!apiKey) {
    console.warn('⚠️ [AVISO] GEMINI_API_KEY não encontrada no arquivo .env. Configure sua chave do Google AI Studio para executar chamadas reais.');
}
export const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });
/**
 * Executa uma chamada ao Gemini Pro com a ferramenta Google Search Grounding nativa.
 * Traz fatos em tempo real, URLs de fontes e dados atualizados do Google.
 */
export async function generateWithSearchGrounding(prompt, systemInstruction) {
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY não está configurada no arquivo .env.');
    }
    const response = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: prompt,
        config: {
            systemInstruction: systemInstruction || 'Você é um pesquisador analítico e factual de classe mundial para SEO e GEO.',
            tools: [{ googleSearch: {} }],
            temperature: 0.2, // Baixa temperatura para maximizar precisão factual
        },
    });
    const text = response.text || '';
    // Extrai fontes de grounding fornecidas pela ferramenta de busca do Google
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = [];
    for (const chunk of groundingChunks) {
        if (chunk.web?.uri) {
            sources.push({
                title: chunk.web.title || chunk.web.uri,
                url: chunk.web.uri,
            });
        }
    }
    return {
        text,
        sources,
    };
}
/**
 * Executa uma chamada ao Gemini Pro com garantia estrita de retorno em formato JSON estruturado.
 */
export async function generateStructuredJson(prompt, schema, systemInstruction) {
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY não está configurada no arquivo .env.');
    }
    const response = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: prompt,
        config: {
            systemInstruction: systemInstruction || 'Você é um arquiteto especialista em SEO Técnico, GEO e Schemas estruturados.',
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.3,
        },
    });
    const rawJson = response.text || '{}';
    try {
        return JSON.parse(rawJson);
    }
    catch (error) {
        console.error('Falha ao fazer parse do JSON retornado pelo Gemini:', rawJson);
        throw new Error(`Erro ao interpretar resposta estruturada do Gemini: ${error}`);
    }
}
/**
 * Executa uma chamada de redação padrão com controle de tom e temperatura.
 */
export async function generateText(prompt, systemInstruction, temperature = 0.5) {
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY não está configurada no arquivo .env.');
    }
    const response = await ai.models.generateContent({
        model: DEFAULT_MODEL,
        contents: prompt,
        config: {
            systemInstruction,
            temperature,
        },
    });
    return response.text || '';
}
