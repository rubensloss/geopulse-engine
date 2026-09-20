import { ResearchDossier } from '../types/index.js';
import { generateWithSearchGrounding, generateStructuredJson } from '../services/gemini.js';

export async function runResearchStep(
  topic: string,
  primaryKeyword: string,
  targetLanguage: string = 'pt-BR'
): Promise<ResearchDossier> {
  console.log(`\n🔍 [ETAPA 1/5] Pesquisa Factual & Search Grounding para: "${topic}"...`);

  // Prompt para ativar a busca do Google e extrair fatos recentes
  const researchPrompt = `
Realize uma pesquisa aprofundada no Google sobre o tema: "${topic}".
Palavra-chave principal: "${primaryKeyword}".
Idioma de destino: ${targetLanguage}.

Sua missão:
1. Identifique dados estatísticos, estudos ou benchmarks recentes relacionados a esse assunto.
2. Identifique quais são as dúvidas mais recorrentes e perguntas práticas ("People Also Ask") feitas pelo público.
3. Identifique termos técnicos, entidades e definições precisas.
4. Descubra quais são os pontos fracos do conteúdo comum que os concorrentes publicam e que podemos superar com dados reais.

Forneça um relatório factual denso, sem floreios ou enrolação.
`;

  const searchResult = await generateWithSearchGrounding(
    researchPrompt,
    'Você é um pesquisador investigativo sênior de SEO/GEO focado em extrair dados factuais precisos e verificados via Google Search.'
  );

  console.log(`   ✓ Busca concluída. Fontes indexadas encontradas: ${searchResult.sources.length}`);

  // Agora estruturamos os achados em um Dossier limpo via Gemini Structured Output
  const structuringPrompt = `
Com base no seguinte relatório de pesquisa factual obtido via Google Search, extraia e organize os dados no formato estruturado solicitado:

Relatório de Pesquisa:
${searchResult.text}
`;

  const schema = {
    type: 'object',
    properties: {
      keyFactualFindings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Principais conclusões e fatos comprovados descobertos',
      },
      targetQuestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dúvidas reais e perguntas frequentes do público sobre o tema',
      },
      competitiveAngles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Gaps de concorrentes e ângulos únicos que podemos explorar',
      },
      statisticalDataPoints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Estatísticas, percentuais, valores ou métricas factuais encontradas',
      },
    },
    required: [
      'keyFactualFindings',
      'targetQuestions',
      'competitiveAngles',
      'statisticalDataPoints',
    ],
  };

  const structured = await generateStructuredJson<{
    keyFactualFindings: string[];
    targetQuestions: string[];
    competitiveAngles: string[];
    statisticalDataPoints: string[];
  }>(structuringPrompt, schema);

  const dossier: ResearchDossier = {
    topic,
    primaryKeyword,
    searchGroundingSources: searchResult.sources,
    keyFactualFindings: structured.keyFactualFindings,
    targetQuestions: structured.targetQuestions,
    competitiveAngles: structured.competitiveAngles,
    statisticalDataPoints: structured.statisticalDataPoints,
    rawGroundingText: searchResult.text,
  };

  console.log(`   ✓ Dossiê estruturado com ${dossier.statisticalDataPoints.length} pontos de dados e ${dossier.targetQuestions.length} perguntas.`);
  return dossier;
}
