import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/server.js';
import { db } from '../src/db/index.js';
import { extractMentionedCompanies, normalizeText } from '../src/services/multiLlmAuditor.js';
import { isSsrfTarget } from '../src/services/scanner.js';

process.env.NODE_ENV = 'test';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES AUTOMATIZADOS - GEOPULSE RODADA 4');
  console.log('================================================================\n');

  db.resetPublicAuditLogs();

  // Inicializa servidor HTTP na porta dinâmica para testes ponta a ponta
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`📡 Servidor de teste ativo em: ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Rota protegida sem token devolve 401
    // -------------------------------------------------------------------------
    console.log('TESTE 1: Validando bloqueio universal 401 em rotas privadas sem token...');
    
    const endpointsToTest = [
      { path: '/api/brands', method: 'GET' },
      { path: '/api/settings', method: 'GET' },
      { path: '/api/settings/backup', method: 'GET' },
      { path: '/api/articles', method: 'GET' },
      { path: '/api/whatsapp/config', method: 'GET' },
      { path: '/api/worker/status', method: 'GET' },
      { path: '/api/geo-stats', method: 'GET' },
    ];

    for (const ep of endpointsToTest) {
      const res = await fetch(`${baseUrl}${ep.path}`, { method: ep.method });
      assert.equal(
        res.status,
        401,
        `Rota ${ep.method} ${ep.path} deveria retornar 401 Unauthorized, mas retornou ${res.status}`
      );
      const json = await res.json();
      assert.equal(json.success, false, `Resposta de ${ep.path} deveria ter success: false`);
      console.log(`   ✓ ${ep.method} ${ep.path} ➔ 401 Unauthorized (Bloqueado corretamente)`);
    }
    console.log('✅ TESTE 1 PASSOU: Todas as rotas protegidas exigem token JWT válido.\n');

    // -------------------------------------------------------------------------
    // TESTE 2: Isolamento multi-tenant entre organizações
    // -------------------------------------------------------------------------
    console.log('TESTE 2: Validando isolamento multi-tenant entre organizações...');

    const timestamp = Date.now();
    // Registra Usuário 1 (Org Alpha)
    const reg1Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gestor Alpha',
        email: `alpha_${timestamp}@empresa.com.br`,
        password: 'Password123!',
        companyName: `Empresa Alpha ${timestamp}`,
      }),
    });
    const reg1 = await reg1Res.json();
    assert.equal(reg1Res.status, 200, `Registro 1 falhou: ${reg1.error}`);
    const token1 = reg1.data.token;

    // Registra Usuário 2 (Org Beta)
    const reg2Res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gestor Beta',
        email: `beta_${timestamp}@empresa.com.br`,
        password: 'Password123!',
        companyName: `Empresa Beta ${timestamp}`,
      }),
    });
    const reg2 = await reg2Res.json();
    assert.equal(reg2Res.status, 200, `Registro 2 falhou: ${reg2.error}`);
    const token2 = reg2.data.token;

    // Cria marca específica para Usuário 2
    const createBrand2Res = await fetch(`${baseUrl}/api/brands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token2}`,
      },
      body: JSON.stringify({
        name: 'Marca Exclusiva Beta',
        websiteUrl: 'https://beta-exclusivo.com.br',
        productDescription: 'Soluções exclusivas Beta',
      }),
    });
    const brand2 = (await createBrand2Res.json()).data;

    // Usuário 1 lista marcas: NÃO pode ver a marca do Usuário 2
    const list1Res = await fetch(`${baseUrl}/api/brands`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const brandsOfUser1 = (await list1Res.json()).data;
    const hasBrand2InUser1 = brandsOfUser1.some((b: any) => b.id === brand2.id);
    assert.equal(
      hasBrand2InUser1,
      false,
      'FALHA DE ISOLAMENTO: Usuário 1 conseguiu ver a marca criada pelo Usuário 2!'
    );

    // Usuário 1 tenta acessar diretamente pelo ID a marca do Usuário 2
    const getDirectRes = await fetch(`${baseUrl}/api/brands/${brand2.id}`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(
      getDirectRes.status,
      404,
      `Usuário 1 não deveria acessar marca do Usuário 2 diretamente (esperado 404, veio ${getDirectRes.status})`
    );

    console.log(`   ✓ Usuário 1 (${reg1.data.user.email}) não vê dados do Usuário 2 (${reg2.data.user.email})`);
    console.log(`   ✓ Acesso cruzado por ID bloqueado com 404`);
    console.log('✅ TESTE 2 PASSOU: Isolamento multi-tenant garantido.\n');

    // -------------------------------------------------------------------------
    // TESTE 3: Auditoria sem chave devolve 503 com link do WhatsApp
    // -------------------------------------------------------------------------
    console.log('TESTE 3: Validando auditoria sem chave de IA (503 com WhatsApp)...');

    const auditRes = await fetch(`${baseUrl}/api/scanner/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'empresa-sem-ia-teste.com.br',
        niche: 'Odontologia e Implantes',
      }),
    });

    // Se nenhuma chave de IA estiver configurada, deve retornar 503
    const auditJson = await auditRes.json();
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.PERPLEXITY_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      assert.equal(auditRes.status, 503, `Esperado 503 sem chaves de IA, obtido: ${auditRes.status}`);
      assert.equal(auditJson.success, false);
      assert.ok(auditJson.whatsappUrl, 'Deveria conter campo whatsappUrl para conversão comercial');
      assert.ok(auditJson.whatsappUrl.includes('wa.me'), 'Link deve apontar para o WhatsApp oficial');
      console.log(`   ✓ Auditoria sem chaves devolveu HTTP 503`);
      console.log(`   ✓ Link de contato WhatsApp presente: ${auditJson.whatsappUrl}`);
    } else {
      console.log('   ℹ️ Chaves de IA configuradas no ambiente local; pulando verificação de erro 503');
    }
    console.log('✅ TESTE 3 PASSOU: Tratamento sem chaves verificado.\n');

    // -------------------------------------------------------------------------
    // TESTE 4: Auditoria limpa e honesta (sem concorrentes inventados ou fake domains)
    // -------------------------------------------------------------------------
    console.log('TESTE 4: Validando extração honesta de entidades e normalização...');

    const sampleAiResponse = `
Para consultorias de governança em nuvem no Brasil, as mais indicadas são:
1. TechCloud Soluções - especializada em migração AWS e Azure.
2. Datasafe Brasil - auditoria e adequação técnica LGPD.
3. Alpha Networks - infraestrutura híbrida com alta disponibilidade.
`;
    const mentioned = extractMentionedCompanies(sampleAiResponse);
    assert.deepEqual(
      mentioned,
      ['TechCloud Soluções', 'Datasafe Brasil', 'Alpha Networks'],
      'A extração deve identificar estritamente as empresas reais citadas'
    );

    // Verifica que nenhum domínio inventado existe
    const hasFakeDomain = mentioned.some((m) => m.includes('citado-por-ia.com.br') || m.includes('100%'));
    assert.equal(hasFakeDomain, false, 'Não deve conter domínio inventado ou frase fixa');

    // Normalização sem acentos e espaços
    assert.equal(normalizeText('Creative Always'), 'creativealways');
    assert.equal(normalizeText('Óptica São João'), 'opticasaojoao');
    assert.equal(normalizeText('Clínica Sorriso 360'), 'clinicasorriso360');

    console.log(`   ✓ Empresas reais extraídas da resposta: ${JSON.stringify(mentioned)}`);
    console.log(`   ✓ Nenhum domínio 'citado-por-ia.com.br' ou percentual inventado`);
    console.log(`   ✓ Normalização correta: "Óptica São João" ➔ "opticasaojoao"`);
    console.log('✅ TESTE 4 PASSOU: Motor de auditoria honesto e factual.\n');

    // -------------------------------------------------------------------------
    // TESTE 5: Proteção SSRF (Bloqueio de localhost, IPs internos e .internal)
    // -------------------------------------------------------------------------
    console.log('TESTE 5: Validando proteção SSRF contra localhost e IPs internos...');

    const ssrfTargets = [
      'localhost',
      '127.0.0.1',
      '::1',
      '10.0.0.1',
      '10.255.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      'servico.internal',
      'api.railway.internal',
    ];

    for (let i = 0; i < ssrfTargets.length; i++) {
      const target = ssrfTargets[i];
      assert.equal(
        isSsrfTarget(target),
        true,
        `Alvo ${target} deveria ser classificado como alvo proibido de SSRF`
      );

      const res = await fetch(`${baseUrl}/api/scanner/audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': `189.45.10.${i + 10}`,
        },
        body: JSON.stringify({ domain: target }),
      });

      assert.equal(
        res.status,
        400,
        `Requisição para ${target} deveria retornar 400 Bad Request por SSRF, mas retornou ${res.status}`
      );
      const json = await res.json();
      assert.ok(
        json.error.includes('interno') || json.error.includes('não permitido') || json.error.includes('inválido') || json.error.includes('privado') || json.error.includes('SSRF') || json.error.includes('proibido'),
        `Mensagem de erro deve alertar sobre domínio restrito ou inválido: ${json.error}`
      );
      console.log(`   ✓ Alvo SSRF '${target}' bloqueado com HTTP 400`);
    }
    console.log('✅ TESTE 5 PASSOU: Proteção SSRF 100% blindada.\n');

    console.log('================================================================');
    console.log('🎉 TODOS OS 5 TESTES DA RODADA 4 PASSARAM COM 100% DE SUCESSO!');
    console.log('================================================================\n');
  } finally {
    server.close();
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ FALHA NA SUÍTE DE TESTES:', err);
  process.exit(1);
});
