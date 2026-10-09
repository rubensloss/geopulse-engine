import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/server.js';
import { db } from '../src/db/index.js';
import { isSsrfTargetAsync, safeFetch } from '../src/security/ssrfProtection.js';

process.env.NODE_ENV = 'test';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES AUTOMATIZADOS - GEOPULSE RODADA 5');
  console.log('================================================================\n');

  // Inicializa servidor HTTP dinâmico para a API principal
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`📡 Servidor de testes da API ativo em: ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Cadastro ignora planTier e nasce FREE_TRIAL / TRIAL
    // -------------------------------------------------------------------------
    console.log('TESTE 1: Validando que o cadastro ignora planTier e nasce FREE_TRIAL...');
    const regTimestamp = Date.now();
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cliente Teste Plan',
        email: `cliente.plano.${regTimestamp}@geopulse.ai`,
        password: 'SenhaForte123!',
        companyName: 'Acme Teste Plano',
        planTier: 'EXCELLENCE_CYCLE', // Tentativa do visitante de se auto-atribuir plano pago
      }),
    });

    assert.equal(regRes.status, 200, `Cadastro deveria retornar 200 OK, retornou ${regRes.status}`);
    const regJson = await regRes.json();
    assert.equal(regJson.success, true);
    assert.equal(
      regJson.data.user.planTier,
      'FREE_TRIAL',
      `O usuário deveria nascer como FREE_TRIAL, mas nasceu como ${regJson.data.user.planTier}`
    );
    assert.equal(
      regJson.data.user.subscriptionStatus,
      'TRIAL',
      `O status da assinatura deveria ser TRIAL, mas foi ${regJson.data.user.subscriptionStatus}`
    );
    console.log('   ✓ Usuário tentou "EXCELLENCE_CYCLE", mas nasceu estritamente como FREE_TRIAL (TRIAL).');
    console.log('✅ TESTE 1 PASSOU: planTier público devidamente ignorado no cadastro.\n');

    const commonUserToken = regJson.data.token;

    // -------------------------------------------------------------------------
    // TESTE 2: Usuário comum recebe 403 Forbidden em rotas de plataforma
    // -------------------------------------------------------------------------
    console.log('TESTE 2: Validando 403 Forbidden para usuário comum em /whatsapp/config, /worker/trigger-now e /settings...');
    const adminEndpoints = [
      { path: '/api/whatsapp/config', method: 'GET' },
      { path: '/api/worker/trigger-now', method: 'POST', body: { brandId: 'brd_fake' } },
      { path: '/api/settings', method: 'GET' },
    ];

    for (const ep of adminEndpoints) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${commonUserToken}`,
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });

      assert.equal(
        res.status,
        403,
        `Rota ${ep.method} ${ep.path} deveria retornar 403 Forbidden para usuário comum, mas retornou ${res.status}`
      );
      const json = await res.json();
      assert.equal(json.success, false);
      console.log(`   ✓ ${ep.method} ${ep.path} ➔ 403 Forbidden (Acesso restrito a PLATFORM_ADMIN)`);
    }
    console.log('✅ TESTE 2 PASSOU: Rotas de administração da plataforma blindadas com 403.\n');

    // -------------------------------------------------------------------------
    // TESTE 3: Dois cadastros com mesmo nome de empresa criam organizações separadas
    // -------------------------------------------------------------------------
    console.log('TESTE 3: Validando prevenção de tomada de conta (mesmo nome de empresa cria tenants distintos)...');
    const compName = `Empresa Duplicada ${regTimestamp}`;

    // Usuário A
    const resA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fundador A',
        email: `fundador.a.${regTimestamp}@empresa.com`,
        password: 'SenhaForte123!',
        companyName: compName,
      }),
    });
    const jsonA = await resA.json();
    const tokenA = jsonA.data.token;
    const orgIdA = jsonA.data.user.organizationId;

    // Usuário B com exatamente o mesmo nome de empresa
    const resB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invasor B',
        email: `invasor.b.${regTimestamp}@empresa.com`,
        password: 'SenhaForte123!',
        companyName: compName,
      }),
    });
    const jsonB = await resB.json();
    const tokenB = jsonB.data.token;
    const orgIdB = jsonB.data.user.organizationId;

    assert.notEqual(
      orgIdA,
      orgIdB,
      `Organizações deveriam ser distintas! orgIdA: ${orgIdA}, orgIdB: ${orgIdB}`
    );
    console.log(`   ✓ Organização A: ${orgIdA}`);
    console.log(`   ✓ Organização B: ${orgIdB} (Slug com sufixo, sem colisão de tenant)`);

    // Valida que Usuário B não vê as marcas do Usuário A
    const listBrandsB = await fetch(`${baseUrl}/api/brands`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const brandsBJson = await listBrandsB.json();
    const brandsOfA = brandsBJson.data.filter((b: any) => b.organizationId === orgIdA);
    assert.equal(brandsOfA.length, 0, 'Usuário B não pode ver marcas pertencentes à Organização A!');
    console.log('   ✓ Usuário B isolado: 0 dados visíveis da Organização A.');
    console.log('✅ TESTE 3 PASSOU: Prevenção contra tomada de contas confirmada.\n');

    // -------------------------------------------------------------------------
    // TESTE 4: POST /api/whatsapp/send-dossier recusado para usuário comum
    // -------------------------------------------------------------------------
    console.log('TESTE 4: Validando recusa de envio de WhatsApp oficial por usuário comum...');
    const sendDossierRes = await fetch(`${baseUrl}/api/whatsapp/send-dossier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${commonUserToken}`,
      },
      body: JSON.stringify({
        to: '5527999999999',
        clientName: 'Lead Teste',
        companyName: 'Lead Empresa',
        reportSlug: 'relatorio-teste',
        score: 45,
      }),
    });

    assert.equal(
      sendDossierRes.status,
      403,
      `send-dossier deveria retornar 403 Forbidden para usuário comum, retornou ${sendDossierRes.status}`
    );
    const sendDossierJson = await sendDossierRes.json();
    assert.equal(sendDossierJson.success, false);
    console.log('   ✓ POST /api/whatsapp/send-dossier ➔ 403 Forbidden (Usuário comum bloqueado)');
    console.log('✅ TESTE 4 PASSOU: Disparo não autorizado de WhatsApp oficial bloqueado.\n');

    // -------------------------------------------------------------------------
    // TESTE 5: Bloqueio dos 9 vetores de SSRF
    // -------------------------------------------------------------------------
    console.log('TESTE 5: Validando bloqueio rigoroso dos 9 vetores de evasão SSRF...');
    const ssrfCases = [
      '127.1',
      '0x7f000001',
      '2130706433',
      '[::1]',
      '[::ffff:127.0.0.1]',
      '[fd12::1]',
      '127.0.0.1.nip.io',
      'http://user@127.0.0.1',
      'LOCALHOST',
    ];

    let ipCounter = 20;
    for (const ssrfTarget of ssrfCases) {
      // 1. Checagem direta pela biblioteca de proteção
      const isBlocked = await isSsrfTargetAsync(ssrfTarget);
      assert.equal(
        isBlocked,
        true,
        `Vetor de SSRF '${ssrfTarget}' deveria ser identificado como restrito/bloqueado!`
      );

      // 2. Checagem pela API do scanner
      ipCounter++;
      const scanRes = await fetch(`${baseUrl}/api/scanner/audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': `198.51.100.${ipCounter}`,
        },
        body: JSON.stringify({
          url: `http://${ssrfTarget}`,
          domain: ssrfTarget,
        }),
      });

      assert.equal(
        scanRes.status,
        400,
        `API do scanner deveria retornar 400 Bad Request para '${ssrfTarget}', mas retornou ${scanRes.status}`
      );
      console.log(`   ✓ SSRF Target '${ssrfTarget}' ➔ Bloqueado com HTTP 400`);
    }
    console.log('✅ TESTE 5 PASSOU: Todos os 9 vetores de SSRF bloqueados.\n');

    // -------------------------------------------------------------------------
    // TESTE 6: Redirecionamento HTTP para endereço interno (127.0.0.1) bloqueado
    // -------------------------------------------------------------------------
    console.log('TESTE 6: Validando bloqueio de redirecionamento HTTP para IP interno...');

    // Cria um servidor HTTP intermediário que faz redirect para 127.0.0.1
    const redirectServer = http.createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://127.0.0.1:9999/malicious' });
      res.end();
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, resolve));
    const redirAddress = redirectServer.address() as any;
    const redirUrl = `http://127.0.0.1:${redirAddress.port}`;

    try {
      let threw = false;
      try {
        await safeFetch(redirUrl);
      } catch (err: any) {
        threw = true;
        assert.equal(err.statusCode, 400);
        console.log(`   ✓ Redirecionamento interceptado e abortado com sucesso: ${err.message}`);
      }
      assert.equal(threw, true, 'safeFetch deveria lançar erro 400 ao detectar redirect para endereço interno');
    } finally {
      redirectServer.close();
    }
    console.log('✅ TESTE 6 PASSOU: Redirecionamento malicioso para rede interna bloqueado com 400.\n');

    // -------------------------------------------------------------------------
    // TESTE 7: Rotas privadas sem token continuam devolvendo 401
    // -------------------------------------------------------------------------
    console.log('TESTE 7: Validando que rotas privadas sem token retornam 401 Unauthorized...');
    const noTokenRes = await fetch(`${baseUrl}/api/brands`, { method: 'GET' });
    assert.equal(noTokenRes.status, 401);
    console.log('   ✓ GET /api/brands sem token ➔ 401 Unauthorized');
    console.log('✅ TESTE 7 PASSOU: Autenticação obrigatória ativa em todas as rotas privadas.\n');

    // -------------------------------------------------------------------------
    // TESTE 8: Cadastro com e-mail em PLATFORM_ADMIN_EMAILS NUNCA vira admin
    // -------------------------------------------------------------------------
    console.log('TESTE 8: Validando que cadastro com e-mail de admin nasce OWNER e é recusado em rotas admin...');
    const adminEmailTimestamp = Date.now();
    const adminEmail = `admin.supremo.${adminEmailTimestamp}@creativealways.com.br`;
    process.env.PLATFORM_ADMIN_EMAILS = `${adminEmail},outro.admin@empresa.com`;
    const adminRegRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tentativa de Admin via Cadastro',
        email: adminEmail,
        password: 'SenhaAdmin123!',
        companyName: `Admin Spoof Test ${adminEmailTimestamp}`,
      }),
    });

    assert.equal(adminRegRes.status, 200);
    const adminRegJson = await adminRegRes.json();
    assert.equal(
      adminRegJson.data.user.role,
      'OWNER',
      `Cadastro público deveria ter papel OWNER, mas recebeu ${adminRegJson.data.user.role}`
    );
    console.log('   ✓ Usuário cadastrado com e-mail de PLATFORM_ADMIN_EMAILS nasceu estritamente como OWNER');

    // Tenta acessar rota de admin (/api/whatsapp/config) com o token gerado no cadastro
    const spoofAdminToken = adminRegJson.data.token;
    const testAdminAccess = await fetch(`${baseUrl}/api/whatsapp/config`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${spoofAdminToken}` },
    });
    assert.equal(
      testAdminAccess.status,
      403,
      `Tentativa de acessar rota de admin deveria retornar 403 Forbidden, retornou ${testAdminAccess.status}`
    );
    console.log('   ✓ Token de cadastro recebeu 403 Forbidden em rota administrativa (sem privilégios indevidos)');
    console.log('✅ TESTE 8 PASSOU: Impossível obter PLATFORM_ADMIN pelo cadastro público.\n');

    // -------------------------------------------------------------------------
    // TESTE 9: Monitoramento semanal bloqueado com 403 para planos gratuitos
    // -------------------------------------------------------------------------
    console.log('TESTE 9: Validando bloqueio 403 Forbidden em /api/brands/:id/monitor-weekly para contas FREE_TRIAL...');
    // Busca a marca do usuário comum criado no Teste 1
    const brandsRes = await fetch(`${baseUrl}/api/brands`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${commonUserToken}` },
    });
    const brandsJson = await brandsRes.json();
    assert.equal(brandsJson.success, true);
    assert.ok(brandsJson.data.length > 0, 'Usuário comum deveria ter ao menos uma marca cadastrada');
    const commonBrandId = brandsJson.data[0].id;

    const monitorRes = await fetch(`${baseUrl}/api/brands/${commonBrandId}/monitor-weekly`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${commonUserToken}` },
    });
    assert.equal(
      monitorRes.status,
      403,
      `Monitoramento semanal deveria retornar 403 Forbidden para FREE_TRIAL, retornou ${monitorRes.status}`
    );
    const monitorJson = await monitorRes.json();
    assert.equal(monitorJson.success, false);
    assert.match(
      monitorJson.error,
      /plano ativo/i,
      'Mensagem de erro deveria indicar necessidade de plano ativo'
    );
    console.log('   ✓ POST /api/brands/:id/monitor-weekly ➔ 403 Forbidden para conta FREE_TRIAL');
    console.log('✅ TESTE 9 PASSOU: Monitoramento semanal por IA protegido contra consumo indevido no trial.\n');

    // -------------------------------------------------------------------------
    // TESTE 10: Consulta de papel e plano em tempo real no banco de dados
    // -------------------------------------------------------------------------
    console.log('TESTE 10: Validando reflexo imediato de promoção e plano no banco de dados...');
    const targetUserId = adminRegJson.data.user.id;

    // Promove o usuário direto no banco de dados (simulando script create-admin)
    await db.updateUser(targetUserId, {
      role: 'PLATFORM_ADMIN',
      planTier: 'EXCELLENCE_CYCLE',
      subscriptionStatus: 'ACTIVE',
    });

    // Mesmo usando o token emitido antes (que tinha role: OWNER gravado nele), a verificação no banco em tempo real deve reconhecer PLATFORM_ADMIN
    const adminCheckRes = await fetch(`${baseUrl}/api/whatsapp/config`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${spoofAdminToken}` },
    });
    assert.equal(
      adminCheckRes.status,
      200,
      `Usuário promovido no banco deveria ter acesso 200 OK a /whatsapp/config, retornou ${adminCheckRes.status}`
    );
    console.log('   ✓ Usuário promovido no banco para PLATFORM_ADMIN ganhou acesso imediato (200 OK) sem reemissão de token');
    console.log('✅ TESTE 10 PASSOU: Validação em tempo real no banco garante consistência e revogação imediata.\n');

    // -------------------------------------------------------------------------
    // TESTE 11: Auditoria pública - Bloqueio de evasão por X-Forwarded-For (IP real)
    // -------------------------------------------------------------------------
    console.log('TESTE 11: Validando que forjar X-Forwarded-For não burla o limite de 3 auditorias por IP...');
    const testRealIp = `203.0.113.${(Date.now() % 200) + 10}`;

    // Executa 3 diagnósticos com o IP real no final da cadeia do X-Forwarded-For
    for (let reqNum = 1; reqNum <= 3; reqNum++) {
      const spoofRes = await fetch(`${baseUrl}/api/scanner/audit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `1.1.1.${reqNum}, ${testRealIp}`,
        },
        body: JSON.stringify({
          domain: `empresa-ip-test-${reqNum}.com.br`,
          niche: 'Tecnologia',
        }),
      });

      // Em ambiente de teste sem chaves de IA retorna 503 (ou 200 se mockado), mas NUNCA 429 nas primeiras 3
      assert.notEqual(
        spoofRes.status,
        429,
        `Diagnóstico ${reqNum} não deveria atingir 429 Too Many Requests`
      );
      console.log(`   ✓ Diagnóstico ${reqNum}/3 processado com IP real ${testRealIp} (Status: ${spoofRes.status})`);
    }

    // 4ª requisição tentando burlar o limite trocando o prefixo do X-Forwarded-For para outro IP
    const evadeRes = await fetch(`${baseUrl}/api/scanner/audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `99.99.99.99, ${testRealIp}`, // Atacante forja 99.99.99.99, mas o proxy do Railway apende testRealIp no final
      },
      body: JSON.stringify({
        domain: 'empresa-ip-test-4.com.br',
        niche: 'Tecnologia',
      }),
    });

    assert.equal(
      evadeRes.status,
      429,
      `4ª chamada deveria retornar 429 Too Many Requests mesmo forjando prefixo no X-Forwarded-For, mas retornou ${evadeRes.status}`
    );
    const evadeJson = await evadeRes.json();
    assert.equal(evadeJson.success, false);
    assert.match(
      evadeJson.error,
      /Limite de 3 diagnósticos gratuitos por dia atingido para este IP/i,
      'Mensagem deve indicar que o limite por IP foi atingido'
    );
    console.log('   ✓ 4ª requisição com X-Forwarded-For adulterado bloqueada com 429 (IP real identificado no final da cadeia)');
    console.log('✅ TESTE 11 PASSOU: Evasão de rate limiting por spoofing de cabeçalho neutralizada.\n');

    // -------------------------------------------------------------------------
    // TESTE 12: Teto global diário de diagnósticos públicos (PUBLIC_AUDIT_DAILY_LIMIT)
    // -------------------------------------------------------------------------
    console.log('TESTE 12: Validando bloqueio 429 ao atingir o teto global diário de diagnósticos...');
    // Consulta quantas auditorias já foram registradas nas últimas 24h
    const currentGlobal = await db.countDailyPublicAudits(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const ceilingLimit = 30; // PUBLIC_AUDIT_DAILY_LIMIT padrão
    const neededToHitCeiling = Math.max(0, ceilingLimit - currentGlobal);

    // Registra registros simulados até atingir o teto de 30
    for (let i = 0; i < neededToHitCeiling; i++) {
      await db.recordPublicAudit(`198.51.100.${i + 50}`, `simulated-${i}.com.br`);
    }

    // Agora, mesmo uma requisição de um IP completamente virgem (nunca usado antes) deve receber 429
    const virginIp = '198.51.199.199';
    const ceilingRes = await fetch(`${baseUrl}/api/scanner/audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': virginIp,
      },
      body: JSON.stringify({
        domain: 'nova-empresa-teto-global.com.br',
        niche: 'Tecnologia',
      }),
    });

    assert.equal(
      ceilingRes.status,
      429,
      `Requisição após teto global deveria retornar 429, mas retornou ${ceilingRes.status}`
    );
    const ceilingJson = await ceilingRes.json();
    assert.equal(ceilingJson.success, false);
    assert.match(
      ceilingJson.error,
      /teto global diário de diagnósticos públicos gratuitos/i,
      'Mensagem deve informar que o teto global diário foi atingido'
    );
    console.log(`   ✓ Requisição com IP virgem bloqueada com 429 devido ao teto diário global (${ceilingLimit}/dia)`);
    console.log('✅ TESTE 12 PASSOU: Teto global diário protege o orçamento e créditos de IA.\n');

    // -------------------------------------------------------------------------
    // TESTE 13: POST /api/whatsapp/send-dossier valida PLATFORM_ADMIN em tempo real no banco
    // -------------------------------------------------------------------------
    console.log('TESTE 13: Validando que send-dossier rejeita tokens antigos se o usuário for rebaixado no banco...');
    // targetUserId foi promovido para PLATFORM_ADMIN no Teste 10.
    // Vamos rebaixar o usuário no banco de volta para OWNER:
    await db.updateUser(targetUserId, {
      role: 'OWNER',
    });

    // Tenta chamar /api/whatsapp/send-dossier usando o token
    const demotedRes = await fetch(`${baseUrl}/api/whatsapp/send-dossier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${spoofAdminToken}`,
      },
      body: JSON.stringify({
        to: '5527988140076',
        clientName: 'Cliente Teste',
        companyName: 'Empresa Teste',
        reportSlug: 'relatorio-teste',
        score: 60,
      }),
    });

    assert.equal(
      demotedRes.status,
      403,
      `send-dossier deveria retornar 403 Forbidden para admin rebaixado no banco, retornou ${demotedRes.status}`
    );
    const demotedJson = await demotedRes.json();
    assert.equal(demotedJson.success, false);
    console.log('   ✓ Usuário rebaixado no PostgreSQL bloqueado imediatamente em POST /api/whatsapp/send-dossier (403)');
    console.log('✅ TESTE 13 PASSOU: requirePlatformAdminMiddleware aplicado com sucesso no envio de dossiê WhatsApp.\n');

    console.log('================================================================');
    console.log('🎉 TODOS OS 13 TESTES DA RODADA 5 / 5c PASSARAM COM 100% DE SUCESSO!');
    console.log('================================================================\n');
  } finally {
    server.close();
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ FALHA NA SUÍTE DE TESTES:', err);
  process.exit(1);
});
