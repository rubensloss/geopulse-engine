const BANNED_AI_CLICHES = [
    { pattern: /no mundo acelerado de hoje/gi, replacement: 'atualmente' },
    { pattern: /no cen[aá]rio contempor[aâ]neo/gi, replacement: 'no mercado atual' },
    { pattern: /[eé] crucial ressaltar que\s*/gi, replacement: '' },
    { pattern: /vale a pena destacar que\s*/gi, replacement: '' },
    { pattern: /[eé] fundamental lembrar que\s*/gi, replacement: '' },
    { pattern: /mergulhe de cabe[cç]a/gi, replacement: 'comece a aplicar' },
    { pattern: /vamos nos aprofundar/gi, replacement: 'vamos analisar' },
    { pattern: /um divisor de [aá]guas/gi, replacement: 'uma virada de chave importante' },
    { pattern: /^em suma,?\s*/gim, replacement: 'Em resumo, ' },
];
/**
 * Filtro determinístico e linter de qualidade para eliminar vícios de linguagem de IA
 */
export function sanitizeAndLintText(markdown) {
    let cleanedMarkdown = markdown;
    let replacementsCount = 0;
    for (const { pattern, replacement } of BANNED_AI_CLICHES) {
        const matches = cleanedMarkdown.match(pattern);
        if (matches) {
            replacementsCount += matches.length;
            cleanedMarkdown = cleanedMarkdown.replace(pattern, replacement);
        }
    }
    return { cleanedMarkdown, replacementsCount };
}
/**
 * Converte Markdown simples para HTML semântico com tabelas, cabeçalhos e listas
 */
export function simpleMarkdownToHtml(markdown) {
    let html = markdown;
    // Cabeçalhos
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    // Negrito e Itálico
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Tabelas Markdown simples
    html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableBlock) => {
        const rows = tableBlock.trim().split(/\r?\n/);
        if (rows.length < 2)
            return tableBlock;
        let tableHtml = '<div class="table-responsive"><table class="data-table border border-collapse">\n';
        let isHeader = true;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i].trim();
            // Linha separadora do Markdown |---|---|
            if (row.match(/^\|[\s-:]+\|$/)) {
                isHeader = false;
                continue;
            }
            const cols = row.split('|').slice(1, -1).map((c) => c.trim());
            tableHtml += '  <tr>\n';
            for (const col of cols) {
                if (isHeader) {
                    tableHtml += `    <th class="p-2 border font-bold">${col}</th>\n`;
                }
                else {
                    tableHtml += `    <td class="p-2 border">${col}</td>\n`;
                }
            }
            tableHtml += '  </tr>\n';
            if (i === 0)
                isHeader = false;
        }
        tableHtml += '</table></div>\n';
        return tableHtml;
    });
    // Parágrafos simples
    const blocks = html.split(/\n\s*\n/);
    html = blocks
        .map((b) => {
        const trimmed = b.trim();
        if (!trimmed)
            return '';
        if (trimmed.startsWith('<h1>') ||
            trimmed.startsWith('<h2>') ||
            trimmed.startsWith('<h3>') ||
            trimmed.startsWith('<div') ||
            trimmed.startsWith('<table') ||
            trimmed.startsWith('<ul>') ||
            trimmed.startsWith('<ol>')) {
            return trimmed;
        }
        return `<p>${trimmed}</p>`;
    })
        .join('\n\n');
    return html;
}
/**
 * Conecta artigos existentes na base via links internos automáticos
 */
export function injectInternalLinks(markdown, existingArticles = []) {
    if (!existingArticles || existingArticles.length === 0) {
        return { content: markdown, linksAddedCount: 0 };
    }
    let updated = markdown;
    let linksAddedCount = 0;
    for (const article of existingArticles) {
        // Procura o título do artigo no texto (se ainda não estiver linkado)
        const escaped = article.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!\\[)\\b(${escaped})\\b(?!\\])`, 'i');
        if (regex.test(updated) && linksAddedCount < 3) {
            updated = updated.replace(regex, `[$1](${article.url})`);
            linksAddedCount++;
        }
    }
    return { content: updated, linksAddedCount };
}
