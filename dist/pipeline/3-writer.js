import { generateText } from '../services/gemini.js';
export async function runSectionalWriterStep(outline, dossier, brandProfile, targetLanguage = 'pt-BR') {
    console.log(`\n✍️ [ETAPA 3/5] Redação Seccional com Ganho Informacional (Total: ${outline.sections.length} seções)...`);
    const generatedSections = [];
    const baseSystemInstruction = `
Você é um redator e estrategista de conteúdo sênior, especialista na área.
Seu estilo é pragmático, analítico, denso em fatos e absolutamente avesso a enrolação ("encher linguiça").
Você NUNCA usa jargões clichês de IA (como "no cenário contemporâneo", "é fundamental lembrar", "mergulhe de cabeça", "um divisor de águas").

TOM DE VOZ DA MARCA: ${brandProfile.toneOfVoice}
PÚBLICO-ALVO: ${brandProfile.targetAudience}
IDIOMA: ${targetLanguage}
`;
    for (let i = 0; i < outline.sections.length; i++) {
        const section = outline.sections[i];
        console.log(`   ► Redigindo seção ${i + 1}/${outline.sections.length}: "${section.h2}" (${section.requiredFormat})...`);
        const sectionPrompt = `
CONTEXTO DO ARTIGO:
- Título Geral: "${outline.title}"
- Palavra-chave principal: "${dossier.primaryKeyword}"
- Empresa / Solução: ${brandProfile.companyName} (${brandProfile.productDescription})

DADOS DESTA SEÇÃO:
- Título H2: "${section.h2}"
- Subtítulos H3 planejados: ${JSON.stringify(section.h3Subsections)}
- Formato obrigatório: ${section.requiredFormat}
- Entidades que devem ser citadas: ${section.keyEntitiesToMention.join(', ')}
- Estimativa de tamanho: ~${section.estimatedWordCount} palavras.

REGRA DE OURO DE GEO (RESPOSTA DIRETA):
- A PRIMEIRA FRASE ou parágrafo DEVE responder de forma direta e sem rodeios à intenção do H2:
  Meta de resposta direta: "${section.directAnswerTarget}".

REQUISITOS ESPECÍFICOS DE FORMATAÇÃO:
${section.requiredFormat === 'comparison_table'
            ? '- OBRIGATÓRIO: Crie uma tabela comparativa em Markdown limpa com pelo menos 3 colunas e 3 linhas comparando critérios relevantes.'
            : ''}
${section.requiredFormat === 'bullet_framework'
            ? '- OBRIGATÓRIO: Crie um checklist ou passo a passo prático com marcadores numerados ou tópicos acionáveis.'
            : ''}

Retorne APENAS o conteúdo em Markdown desta seção (incluindo o título ## ${section.h2} no topo e os ### se houver).
`;
        const sectionMarkdown = await generateText(sectionPrompt, baseSystemInstruction, 0.4);
        const words = sectionMarkdown.trim().split(/\s+/).length;
        generatedSections.push({
            sectionId: section.id,
            h2: section.h2,
            markdown: sectionMarkdown,
            html: '', // Será convertido no agregador
            wordCount: words,
        });
    }
    // Seção de FAQ
    console.log(`   ► Redigindo seção de Perguntas Frequentes (FAQ)...`);
    const faqPrompt = `
Gere a seção final de Perguntas Frequentes (FAQ) para o artigo "${outline.title}".
Responda a cada uma das seguintes perguntas com respostas densas, diretas (2 a 3 frases cada), ideais para serem lidas por robôs de busca e humanos:

Perguntas a responder:
${outline.faqItems.map((f, idx) => `${idx + 1}. ${f.question} (Resumo planejado: ${f.answerSummary})`).join('\n')}

Comece com o título "## Perguntas Frequentes sobre ${outline.title}" e use "###" para cada pergunta.
`;
    const faqMarkdown = await generateText(faqPrompt, baseSystemInstruction, 0.3);
    const faqWords = faqMarkdown.trim().split(/\s+/).length;
    generatedSections.push({
        sectionId: 'sec_faq',
        h2: 'Perguntas Frequentes',
        markdown: faqMarkdown,
        html: '',
        wordCount: faqWords,
    });
    // Seção de Conclusão e CTA da Marca
    console.log(`   ► Redigindo Fechamento e CTA com a proposta de valor da ${brandProfile.companyName}...`);
    const ctaPrompt = `
Escreva uma breve seção de fechamento e Chamada para Ação (CTA) para o artigo "${outline.title}".
Apresente a ${brandProfile.companyName} como o próximo passo lógico para quem precisa de: ${brandProfile.productDescription}.
Link de destino do CTA: ${brandProfile.ctaTargetUrl} (use como link Markdown: [${brandProfile.ctaText || 'Conheça mais sobre a ' + brandProfile.companyName}](${brandProfile.ctaTargetUrl})).

Comece com o título "## Conclusão: Dê o próximo passo" e seja natural, sem parecer comercial agressivo.
`;
    const ctaMarkdown = await generateText(ctaPrompt, baseSystemInstruction, 0.4);
    const ctaWords = ctaMarkdown.trim().split(/\s+/).length;
    generatedSections.push({
        sectionId: 'sec_cta',
        h2: 'Conclusão e Próximos Passos',
        markdown: ctaMarkdown,
        html: '',
        wordCount: ctaWords,
    });
    console.log(`   ✓ Redação concluída com sucesso! Total de blocos: ${generatedSections.length}`);
    return generatedSections;
}
