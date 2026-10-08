import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../src/server.js';
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

    console.log('================================================================');
    console.log('🎉 TODOS OS 7 TESTES DA RODADA 5 PASSARAM COM 100% DE SUCESSO!');
    console.log('================================================================\n');
  } finally {
    server.close();
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ FALHA NA SUÍTE DE TESTES:', err);
  process.exit(1);
});
