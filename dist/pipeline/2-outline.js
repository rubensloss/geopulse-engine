import { generateStructuredJson } from '../services/gemini.js';
export async function runOutlineStep(dossier, brandProfile, targetLanguage = 'pt-BR') {
    console.log(`\n📐 [ETAPA 2/5] Arquitetando Outline com regras de GEO & SEO...`);
    const prompt = `
Você é o Arquiteto-Chefe de Conteúdo GEO (Generative Engine Optimization) e SEO da plataforma.
Sua missão é desenhar a estrutura exata (Outline) de um artigo para dominar a primeira página do Google e ser a fonte número 1 citada por ChatGPT, Perplexity e Gemini.

DADOS DA EMPRESA (BRAND PROFILE):
- Empresa: ${brandProfile.companyName}
- Site: ${brandProfile.websiteUrl}
- Proposta de Valor / Produto: ${brandProfile.productDescription}
- Público-Alvo: ${brandProfile.targetAudience}
- Tom de Voz: ${brandProfile.toneOfVoice}

DOSSIÊ DE PESQUISA (FATOS E DÚVIDAS DO MERCADO):
- Tema: ${dossier.topic}
- Palavra-chave: ${dossier.primaryKeyword}
- Perguntas do público: ${JSON.stringify(dossier.targetQuestions)}
- Estatísticas disponíveis: ${JSON.stringify(dossier.statisticalDataPoints)}
- Gaps de concorrentes: ${JSON.stringify(dossier.competitiveAngles)}

REGRAS DE ARQUITETURA GEO OBRIGATÓRIAS:
1. Título (H1): Forte, focado na intenção de busca, sem promessas vazias.
2. Cada H2 deve responder a uma dúvida ou necessidade clara.
3. Em 'directAnswerTarget', defina qual é a resposta direta e concisa (em 30-50 palavras) que DEVE abrir aquela seção para ser fisgada como featured snippet ou citação de LLM.
4. OBRIGATÓRIO: Pelo menos uma seção deve ter o formato 'comparison_table' (tabela comparativa em markdown). LLMs adoram extrair tabelas!
5. OBRIGATÓRIO: Pelo menos uma seção deve ter o formato 'bullet_framework' (passo a passo numerado ou lista técnica).
6. Gere de 4 a 6 seções principais (H2) + 4 perguntas frequentes (FAQ).
7. Em uma das seções, planeje uma conexão natural e contextual com a solução oferecida por ${brandProfile.companyName}.
8. Idioma de resposta: ${targetLanguage}.
`;
    const schema = {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título principal H1 do artigo' },
            slug: { type: 'string', description: 'Slug da URL amigável (kebab-case, ex: o-que-e-geo-guia-pratico)' },
            metaDescription: { type: 'string', description: 'Meta description de 140 a 160 caracteres' },
            searchIntent: {
                type: 'string',
                enum: ['informational', 'commercial', 'transactional'],
                description: 'Intenção predominante da busca'
            },
            sections: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Identificador único, ex: sec_1' },
                        h2: { type: 'string', description: 'Título H2 da seção' },
                        h3Subsections: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Subtítulos H3 (opcionais para detalhamento)',
                        },
                        directAnswerTarget: {
                            type: 'string',
                            description: 'A resposta direta exata que deve abrir o parágrafo (30-50 palavras)',
                        },
                        requiredFormat: {
                            type: 'string',
                            enum: [
                                'direct_answer_and_steps',
                                'comparison_table',
                                'bullet_framework',
                                'case_example',
                                'faq',
                            ],
                            description: 'Formato estruturado obrigatório da seção',
                        },
                        keyEntitiesToMention: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Entidades, termos técnicos e palavras-chave que devem estar no texto',
                        },
                        estimatedWordCount: { type: 'number', description: 'Estimativa de palavras (250 a 450)' },
                    },
                    required: ['id', 'h2', 'directAnswerTarget', 'requiredFormat', 'keyEntitiesToMention', 'estimatedWordCount'],
                },
            },
            faqItems: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        question: { type: 'string' },
                        answerSummary: { type: 'string' },
                    },
                    required: ['question', 'answerSummary'],
                },
            },
        },
        required: ['title', 'slug', 'metaDescription', 'searchIntent', 'sections', 'faqItems'],
    };
    const outline = await generateStructuredJson(prompt, schema, 'Você é o arquiteto sênior de SEO/GEO. Crie outlines cirúrgicos e orientados a extração de dados.');
    console.log(`   ✓ Outline gerado: "${outline.title}"`);
    console.log(`   ✓ Total de seções planejadas: ${outline.sections.length} + ${outline.faqItems.length} FAQs`);
    return outline;
}
