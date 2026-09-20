import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateGeoArticle, PipelineInput, ArticleOutput } from './index.js';
import { runSchemaStep } from './pipeline/4-schema.js';
import { injectInternalLinks, sanitizeAndLintText, simpleMarkdownToHtml } from './pipeline/5-linter.js';

dotenv.config();

// Cenário de teste: Uma empresa que vende aceleração de IA e SEO
const testInput: PipelineInput = {
  topic: 'O que é GEO (Generative Engine Optimization) e como ranquear no ChatGPT e Perplexity',
  primaryKeyword: 'GEO Generative Engine Optimization',
  targetLanguage: 'pt-BR',
  brandProfile: {
    companyName: 'ScaleAI Solutions',
    websiteUrl: 'https://scaleai.com.br',
    productDescription: 'Plataforma e consultoria de aceleração de tráfego orgânico através de IA e GEO para empresas B2B.',
    targetAudience: 'CEOs, Diretores de Marketing, Líderes de Growth e donos de empresas.',
    toneOfVoice: 'Pragmático, direto ao ponto, técnico sem ser professoral, focado em ROI e resultados reais.',
    ctaTargetUrl: 'https://scaleai.com.br/diagnostico-gratuito',
    ctaText: 'Solicitar Diagnóstico GEO Gratuito',
  },
  existingArticles: [
    {
      title: 'SEO tradicional vs SEO para IA',
      url: 'https://scaleai.com.br/blog/seo-tradicional-vs-ia',
    },
    {
      title: 'Como usar o Google Search Console',
      url: 'https://scaleai.com.br/blog/como-usar-google-search-console',
    },
  ],
};

function runMockSimulation(): ArticleOutput {
  console.log('🔄 Executando em modo de SIMULAÇÃO (Mock)...');
  
  const mockOutline = {
    title: 'O que é GEO (Generative Engine Optimization): Como Ranquear no ChatGPT e Perplexity',
    slug: 'o-que-e-geo-generative-engine-optimization',
    metaDescription: 'Aprenda o que é GEO, como os motores de IA selecionam fontes e as táticas práticas para colocar sua empresa nas respostas do ChatGPT e Perplexity.',
    searchIntent: 'informational' as const,
    sections: [
      {
        id: 'sec_1',
        h2: 'O que é GEO e como ele difere do SEO tradicional?',
        h3Subsections: [],
        directAnswerTarget: 'GEO (Generative Engine Optimization) é o conjunto de técnicas para otimizar conteúdo e entidades de marca para serem citadas diretamente por motores de IA generativa.',
        requiredFormat: 'direct_answer_and_steps' as const,
        keyEntitiesToMention: ['ChatGPT', 'Perplexity', 'Google AI Overviews', 'Topical Authority'],
        estimatedWordCount: 300,
      },
      {
        id: 'sec_2',
        h2: 'Comparativo Prático: SEO Tradicional vs. GEO',
        h3Subsections: [],
        directAnswerTarget: 'Enquanto o SEO tradicional foca em cliques e posições de links azuis, o GEO foca em taxa de citação e síntese de respostas em conversas.',
        requiredFormat: 'comparison_table' as const,
        keyEntitiesToMention: ['Rankings', 'Citações', 'Share of Model'],
        estimatedWordCount: 350,
      },
    ],
    faqItems: [
      {
        question: 'O GEO substitui o SEO tradicional?',
        answerSummary: 'Não, o GEO complementa o SEO. As IAs ainda utilizam o índice do Google e Bing como base de dados primária.',
      },
      {
        question: 'Quanto tempo leva para aparecer nas respostas do ChatGPT?',
        answerSummary: 'Varia entre 2 a 8 semanas após a indexação do conteúdo e citação por fontes de autoridade.',
      },
    ],
  };

  const mockContent = `## O que é GEO e como ele difere do SEO tradicional?

GEO (Generative Engine Optimization) é o conjunto de técnicas para otimizar conteúdos, marcas e produtos a fim de serem selecionados e citados nas respostas dos motores de busca alimentados por IA. 

Diferente do Google clássico, onde o usuário escolhe entre dez links azuis, modelos como Perplexity, ChatGPT e Claude analisam a densidade semântica da página, extraem os dados mais claros e sintetizam uma resposta pronta. Se a sua empresa não estiver estruturada com entidades claras, ela simplesmente não existe para o modelo. No mundo acelerado de hoje, entender SEO tradicional vs SEO para IA tornou-se um diferencial competitivo.

## Comparativo Prático: SEO Tradicional vs. GEO

A principal mudança de paradigma está na forma como o sucesso é medido:

| Critério | SEO Tradicional | GEO (Generative Engine Optimization) |
| :--- | :--- | :--- |
| **Objetivo Final** | Ranquear nas primeiras posições da SERP | Ser citado e recomendado na síntese da IA |
| **Métrica Principal** | Posição no ranking (1º ao 10º) e CTR | Taxa de citação, menção de marca e sentimento |
| **Formato Privilegiado** | Artigos longos com densidade de palavra-chave | Tabelas, listas diretas, dados proprietários e schemas |
| **Mecanismo de Leitura** | Web crawlers clássicos (Googlebot) | RAG (Retrieval-Augmented Generation) e agentes |

## Perguntas Frequentes sobre GEO

### O GEO substitui o SEO tradicional?
Não, o GEO complementa o SEO. Os motores de IA dependem dos índices do Google e do Bing para recuperar documentos atualizados via busca em tempo real.

### Quanto tempo leva para aparecer nas respostas do ChatGPT?
Varia entre 2 a 8 semanas após a indexação do conteúdo e citação por fontes confiáveis da sua indústria.

## Conclusão: Dê o próximo passo

Se a sua empresa deseja posicionar sua marca onde os compradores modernos estão tomando decisões, a ScaleAI Solutions oferece uma esteira completa de otimização de autoridade. [Solicitar Diagnóstico GEO Gratuito](https://scaleai.com.br/diagnostico-gratuito)`;

  const schemas = runSchemaStep(mockOutline, testInput.brandProfile);
  const { cleanedMarkdown, replacementsCount } = sanitizeAndLintText(mockContent);
  const { content: finalMarkdown, linksAddedCount } = injectInternalLinks(cleanedMarkdown, testInput.existingArticles);
  const contentHtml = simpleMarkdownToHtml(finalMarkdown);
  const totalWords = finalMarkdown.trim().split(/\s+/).length;

  console.log(`   ✓ Simulação executada com sucesso.`);
  console.log(`   ✓ Linter de IA substituiu ${replacementsCount} clichês.`);
  console.log(`   ✓ Links internos inseridos: ${linksAddedCount}.`);

  return {
    title: mockOutline.title,
    slug: mockOutline.slug,
    metaDescription: mockOutline.metaDescription,
    contentMarkdown: finalMarkdown,
    contentHtml,
    schemaJsonLd: schemas,
    faqItems: mockOutline.faqItems.map((f) => ({ question: f.question, answer: f.answerSummary })),
    metrics: {
      totalWords,
      readingTimeMinutes: Math.ceil(totalWords / 200),
      tableCount: 1,
      directAnswerSnippetsCount: 2,
    },
  };
}

async function main() {
  const isMock = process.argv.includes('--mock') || !process.env.GEMINI_API_KEY;

  if (!process.env.GEMINI_API_KEY && !process.argv.includes('--mock')) {
    console.log(`
================================================================
⚠️ CHAVE DE API NÃO CONFIGURADA
================================================================
Dica: Rodando automaticamente em modo de simulação (--mock).
Para rodar com o Gemini Pro real e Google Search Grounding:
1. Crie o arquivo '.env' na pasta 'geo-content-engine'
2. Configure:
   GEMINI_API_KEY=sua_chave_do_google_ai_studio
================================================================
`);
  }

  try {
    const article = isMock 
      ? runMockSimulation()
      : await generateGeoArticle(testInput);

    const outputPath = path.resolve(process.cwd(), 'output-demo.md');
    
    let fileContent = `---\n`;
    fileContent += `title: "${article.title}"\n`;
    fileContent += `slug: "${article.slug}"\n`;
    fileContent += `meta_description: "${article.metaDescription}"\n`;
    fileContent += `word_count: ${article.metrics.totalWords}\n`;
    fileContent += `reading_time: "${article.metrics.readingTimeMinutes} min"\n`;
    fileContent += `---\n\n`;
    fileContent += `<!-- SCHEMA JSON-LD GERADO:\n${JSON.stringify(article.schemaJsonLd, null, 2)}\n-->\n\n`;
    fileContent += article.contentMarkdown;

    fs.writeFileSync(outputPath, fileContent, 'utf-8');
    console.log(`\n📄 Artigo gerado salvo com sucesso em: ${outputPath}`);
  } catch (error) {
    console.error('❌ Erro durante a execução:', error);
  }
}

main();
