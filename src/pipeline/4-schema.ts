import { ArticleOutline, BrandProfile } from '../types/index.js';

export function runSchemaStep(
  outline: ArticleOutline,
  brandProfile: BrandProfile,
  publishedDate: Date = new Date()
) {
  console.log(`\n🏷️ [ETAPA 4/5] Gerando Schemas Estruturados (Schema.org / JSON-LD)...`);

  const articleUrl = `${brandProfile.websiteUrl.replace(/\/$/, '')}/blog/${outline.slug}`;
  const isoDate = publishedDate.toISOString();

  // 1. Schema: Article / BlogPosting
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: outline.title,
    description: outline.metaDescription,
    url: articleUrl,
    datePublished: isoDate,
    dateModified: isoDate,
    inLanguage: 'pt-BR',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    author: {
      '@type': 'Organization',
      name: brandProfile.companyName,
      url: brandProfile.websiteUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: brandProfile.companyName,
      url: brandProfile.websiteUrl,
    },
  };

  // 2. Schema: FAQPage
  let faqSchema: object | undefined;
  if (outline.faqItems && outline.faqItems.length > 0) {
    faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: outline.faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answerSummary,
        },
      })),
    };
  }

  console.log(`   ✓ Schema BlogPosting gerado com sucesso.`);
  if (faqSchema) {
    console.log(`   ✓ Schema FAQPage gerado com ${outline.faqItems.length} perguntas mapeadas.`);
  }

  return {
    articleSchema,
    faqSchema,
  };
}
