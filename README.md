# GEO & SEO Content Generation Engine (ClickHunt Equivalent)

Motor autônomo de geração, distribuição e monitoramento de conteúdo otimizado para **Google (SEO)** e **Modelos de Linguagem (GEO - ChatGPT, Perplexity, Gemini, Claude)** construído em **Node.js + TypeScript**, alimentado pelo **Google Gemini Pro**, integrado com **CMSs**, estruturado para **Multi-Tenant Enterprise** com banco de dados **Prisma ORM**, agendador autônomo **24/7 (Worker & Scheduler Engine)** e **Painel Visual Interativo (Dashboard)**.

---

## 🎯 Por que esta solução realmente funciona?

Diferente de geradores de artigos genéricos que produzem "AI Slop" penalizado pelo Google, este motor executa uma esteira profissional completa:

1. **Pesquisa Factual & Search Grounding:** Usa a ferramenta nativa de Google Search do Gemini Pro para trazer estatísticas recentes, fatos comprovados e dúvidas reais ("People Also Ask").
2. **Arquiteto de Outlines GEO:** Desenha cada seção (H2/H3) com "resposta direta nos primeiros 40 caracteres" e exige formatos estruturados (tabelas comparativas e listas).
3. **Redação Seccional com Ganho de Informação:** Escreve bloco a bloco respeitando o tom de voz da marca e integrando a proposta de valor.
4. **Geração de Schemas JSON-LD:** Cria automaticamente metadados Schema.org (`BlogPosting` e `FAQPage`) para acelerar a extração por robôs de IA.
5. **Linter Anti-Clichê & Malha de Links Internos:** Limpa marcas d'água de IA e insere links contextuais para outros artigos do cliente.
6. **Distribuição Multi-CMS & Indexação Instantânea:** Publica via API no WordPress, Webflow ou Webhooks e notifica o protocolo **IndexNow** (Bing, Copilot, Perplexity) em tempo real.
7. **Arquitetura Multi-Tenant & Segurança Bancária:** Isolamento de dados por Organização e Marca, com credenciais de CMS criptografadas em repouso com **AES-256-GCM**.
8. **Agendador Autônomo 24/7 (Worker & Scheduler Engine):** Roda em background, monitora pautas por prioridade (1 a 5), controla concorrência por tenant e publica sem intervenção humana.
9. **Observabilidade GEO (Share of Model):** Monitoramento contínuo da taxa de recomendação e citação da marca dentro dos motores de IA.
10. **Painel Visual Moderno & Clean:** Interface web estilo Linear/ClickHunt para gerenciar marcas, acompanhar a esteira de pautas, inspecionar schemas e disparar publicações.

---

## 📁 Estrutura do Projeto

```
geo-content-engine/
├── package.json
├── tsconfig.json
├── output-demo.md             # Amostra de artigo gerado
├── prisma/
│   └── schema.prisma          # Schema relacional Enterprise (PostgreSQL / Prisma)
├── public/
│   └── index.html             # Painel Visual Web moderno, clean e reativo
├── src/
│   ├── types/
│   │   └── index.ts           # Interfaces e contratos de dados
│   ├── services/
│   │   └── gemini.ts          # Cliente Gemini Pro com Search Grounding e JSON Schema
│   ├── security/
│   │   └── encryption.ts      # Criptografia bancária AES-256-GCM para senhas e tokens
│   ├── db/
│   │   ├── types.ts           # DTOs e tipos de banco de dados
│   │   ├── repository.ts      # Repositório Enterprise Multi-Tenant
│   │   └── index.ts           # Exportador do módulo de banco
│   ├── pipeline/
│   │   ├── 1-research.ts      # Grounding de pesquisa no Google
│   │   ├── 2-outline.ts       # Arquiteto de Outline com regras GEO
│   │   ├── 3-writer.ts        # Redação Seccional
│   │   ├── 4-schema.ts        # Gerador de Schemas JSON-LD
│   │   └── 5-linter.ts        # Linter anti-clichê e links internos
│   ├── publishers/            # CONECTORES DE CMS & INDEXAÇÃO
│   │   ├── types.ts           # Configurações de credenciais e resultados
│   │   ├── wordpress.ts       # WordPress REST API (Application Passwords)
│   │   ├── webflow.ts         # Webflow CMS API v2
│   │   ├── webhook.ts         # Webhook Universal (Shopify, Ghost, Next.js)
│   │   ├── indexnow.ts        # Notificador IndexNow para indexação rápida
│   │   └── index.ts           # Roteador central de publicação
│   ├── worker/                # AGENDADOR AUTÔNOMO 24/7
│   │   ├── types.ts           # Tipos de jobs e opções de concorrência
│   │   ├── content-processor.ts # Processador ponta a ponta do job
│   │   ├── scheduler.ts       # Motor de agendamento e polling de pautas
│   │   └── index.ts           # Exportador do worker
│   ├── server.ts              # Servidor API Express + UI estática
│   ├── index.ts               # Orquestrador central exportável
│   ├── demo.ts                # Teste da esteira de geração
│   ├── demo-publish.ts        # Teste dos conectores de publicação CMS
│   ├── demo-enterprise.ts     # Teste de Multi-Tenant e Criptografia
│   └── demo-worker.ts         # Teste do Agendador Autônomo e Filas
```

---

## 🚀 Como Executar os Módulos

### 1. Pré-requisitos
- Node.js 18+ (recomendado Node 20+)

### 2. Configurar a Chave da API
Crie um arquivo `.env` na raiz da pasta `geo-content-engine`:
```env
# Gemini API Key (https://aistudio.google.com/)
GEMINI_API_KEY=sua_chave_do_google_ai_studio_aqui
GEMINI_MODEL=gemini-2.5-pro

# Chave mestra para criptografia AES-256-GCM das senhas dos clientes:
ENCRYPTION_KEY=minha-chave-secreta-de-32-caracteres-super-segura

# Porta do Servidor Web (padrão: 3000):
PORT=3000
```

### 3. Rodar os Scripts e o Painel Visual
```bash
# 1. Iniciar o Painel Visual Web no Navegador (http://localhost:3000)
npm run dev:server

# 2. Testar o Agendador Autônomo 24/7 processando pautas em background
npm run dev:worker

# 3. Testar a publicação em CMSs (WordPress, Webflow, Webhook) e IndexNow
npm run dev:publish

# 4. Testar a arquitetura Multi-Tenant, Criptografia AES-256-GCM e Monitor GEO
npm run dev:enterprise

# 5. Compilação TypeScript para produção
npm run build
```
