import { ArticleOutput, PipelineInput } from './types/index.js';
import { runResearchStep } from './pipeline/1-research.js';
import { runOutlineStep } from './pipeline/2-outline.js';
import { runSectionalWriterStep } from './pipeline/3-writer.js';
import { runSchemaStep } from './pipeline/4-schema.js';
import { injectInternalLinks, sanitizeAndLintText, simpleMarkdownToHtml } from './pipeline/5-linter.js';

/**
 * Orquestrador central do Pipeline de Geração GEO & SEO
 */
export async function generateGeoArticle(input: PipelineInput): Promise<ArticleOutput> {
  const startTime = Date.now();
  console.log(`================================================================`);
  console.log(`🚀 INICIANDO PIPELINE GEO ENGINE: "${input.topic}"`);
  console.log(`🏢 Empresa: ${input.brandProfile.companyName} | Idioma: ${input.targetLanguage || 'pt-BR'}`);
  console.log(`================================================================`);

  // 1. Pesquisa Factual com Search Grounding do Google
  const dossier = await runResearchStep(
    input.topic,
    input.primaryKeyword,
    input.targetLanguage
  );

  // 2. Arquiteto de Outline com Regras de Extração GEO
  const outline = await runOutlineStep(
    dossier,
    input.brandProfile,
    input.targetLanguage
  );

  // 3. Redação Seccional com Information Gain e Respostas Diretas
  const sections = await runSectionalWriterStep(
    outline,
    dossier,
    input.brandProfile,
    input.targetLanguage
  );

  // 4. Geração de Schemas JSON-LD (Schema.org / FAQPage / BlogPosting)
  const schemas = runSchemaStep(outline, input.brandProfile);

  // 5. Agregação, Linter Anti-Clichê e Malha de Links Internos
  console.log(`\n🧹 [ETAPA 5/5] Montagem final, Linter Anti-Clichê e Links Internos...`);
  
  let fullMarkdown = `# ${outline.title}\n\n`;
  fullMarkdown += `*${outline.metaDescription}*\n\n`;

  for (const sec of sections) {
    fullMarkdown += `${sec.markdown}\n\n---\n\n`;
  }

  // Linter de clichês
  const { cleanedMarkdown, replacementsCount } = sanitizeAndLintText(fullMarkdown);
  console.log(`   ✓ Linter executado: ${replacementsCount} clichês de IA identificados e normalizados.`);

  // Injeção de links internos
  const { content: finalMarkdownWithLinks, linksAddedCount } = injectInternalLinks(
    cleanedMarkdown,
    input.existingArticles
  );
  console.log(`   ✓ Malha de links internos: ${linksAddedCount} links contextuais adicionados.`);

  // Conversão para HTML Semântico
  const contentHtml = simpleMarkdownToHtml(finalMarkdownWithLinks);

  // Métricas de qualidade
  const totalWords = finalMarkdownWithLinks.trim().split(/\s+/).length;
  const tableCount = (finalMarkdownWithLinks.match(/\|[\s-:]+\|/g) || []).length;
  const directAnswersCount = outline.sections.length;

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`✅ ARTIGO CONCLUÍDO COM SUCESSO EM ${durationSec}s!`);
  console.log(`📊 Palavras: ${totalWords} | Tabelas: ${tableCount} | Respostas Diretas: ${directAnswersCount}`);
  console.log(`================================================================\n`);

  return {
    title: outline.title,
    slug: outline.slug,
    metaDescription: outline.metaDescription,
    contentMarkdown: finalMarkdownWithLinks,
    contentHtml,
    schemaJsonLd: schemas,
    faqItems: outline.faqItems.map((f) => ({
      question: f.question,
      answer: f.answerSummary,
    })),
    metrics: {
      totalWords,
      readingTimeMinutes: Math.ceil(totalWords / 200),
      tableCount,
      directAnswerSnippetsCount: directAnswersCount,
    },
  };
}

export * from './types/index.js';
export * from './publishers/index.js';
export * from './db/index.js';
export * from './worker/index.js';
