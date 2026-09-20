export interface BrandProfile {
  companyName: string;
  websiteUrl: string;
  productDescription: string;
  targetAudience: string;
  toneOfVoice: string; // e.g. "Especialista pragmático, direto ao ponto, técnico sem ser prolixo"
  ctaTargetUrl: string;
  ctaText?: string;
  forbiddenTerms?: string[];
}

export interface ResearchDossier {
  topic: string;
  primaryKeyword: string;
  searchGroundingSources: Array<{ title: string; url: string }>;
  keyFactualFindings: string[];
  targetQuestions: string[];
  competitiveAngles: string[];
  statisticalDataPoints: string[];
  rawGroundingText?: string;
}

export type SectionContentType = 
  | 'direct_answer_and_steps' 
  | 'comparison_table' 
  | 'bullet_framework' 
  | 'case_example' 
  | 'faq';

export interface OutlineSection {
  id: string;
  h2: string;
  h3Subsections: string[];
  directAnswerTarget: string; // Resposta concisa direta para featured snippet / citação de LLM
  requiredFormat: SectionContentType;
  keyEntitiesToMention: string[];
  estimatedWordCount: number;
}

export interface ArticleOutline {
  title: string;
  slug: string;
  metaDescription: string;
  searchIntent: 'informational' | 'commercial' | 'transactional';
  sections: OutlineSection[];
  faqItems: Array<{ question: string; answerSummary: string }>;
}

export interface GeneratedSection {
  sectionId: string;
  h2: string;
  markdown: string;
  html: string;
  wordCount: number;
}

export interface ArticleOutput {
  title: string;
  slug: string;
  metaDescription: string;
  contentMarkdown: string;
  contentHtml: string;
  schemaJsonLd: {
    articleSchema: object;
    faqSchema?: object;
  };
  faqItems: Array<{ question: string; answer: string }>;
  metrics: {
    totalWords: number;
    readingTimeMinutes: number;
    tableCount: number;
    directAnswerSnippetsCount: number;
  };
}

export interface PipelineInput {
  topic: string;
  primaryKeyword: string;
  brandProfile: BrandProfile;
  targetLanguage?: 'pt-BR' | 'en-US' | 'es-ES';
  existingArticles?: Array<{ title: string; url: string }>;
}
