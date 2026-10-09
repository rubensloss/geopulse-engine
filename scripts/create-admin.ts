import readline from 'readline';
import { db } from '../src/db/index.js';
import { hashPassword } from '../src/services/auth.js';

function getCliArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  // Suporte a --flag=valor
  const prefix = `${flag}=`;
  const match = args.find((a) => a.startsWith(prefix));
  if (match) {
    return match.slice(prefix.length);
  }
  return null;
}

function askHiddenPassword(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    // Se não estiver em terminal interativo com TTY ou se setRawMode não existir/falhar,
    // faz fallback gracioso para readline padrão (ex: ambientes railway ssh sem pty)
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    try {
      process.stdout.write(promptText);
      let password = '';

      const onData = (buffer: Buffer) => {
        const char = buffer.toString('utf-8');
        if (char === '\r' || char === '\n') {
          try { process.stdin.setRawMode?.(false); } catch {}
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(password.trim());
        } else if (char === '\u0008' || char === '\x7f') { // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else if (char === '\u0003') { // Ctrl+C
          try { process.stdin.setRawMode?.(false); } catch {}
          process.exit(1);
        } else {
          password += char;
        }
      };

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } catch {
      // Fallback gracioso se setRawMode falhar no contêiner
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log('================================================================');
  console.log('🛡️  GEOPULSE - PROMOÇÃO / CRIAÇÃO DE PLATFORM_ADMIN');
  console.log('================================================================\n');

  // Segurança estrita: rejeita flag --password para evitar vazamento em logs/histórico
  if (process.argv.some((a) => a.startsWith('--password'))) {
    console.error('❌ Por motivos de segurança, o argumento --password via linha de comando foi desativado.');
    console.error('   Senhas em flags de CLI ficam salvas no histórico (.bash_history) e na listagem de processos.');
    console.error('   Por favor, execute sem --password e insira a senha na pergunta oculta interativa.\n');
    process.exit(1);
  }

  let email = getCliArg('--email');

  if (!email) {
    console.error('❌ Parâmetro --email é obrigatório.');
    console.error('Uso: npm run create-admin -- --email admin@empresa.com\n');
    process.exit(1);
  }

  email = email.toLowerCase().trim();
  if (!email.includes('@') || !email.includes('.')) {
    console.error('❌ E-mail informado possui formato inválido.');
    process.exit(1);
  }

  const password = await askHiddenPassword('Digite a senha para a conta PLATFORM_ADMIN (mínimo 12 caracteres): ');

  if (!password || password.length < 12) {
    console.error('❌ A senha deve conter pelo menos 12 caracteres para contas PLATFORM_ADMIN.');
    process.exit(1);
  }

  try {
    const existing = await db.getUserByEmail(email);

    if (existing) {
      console.log(`🔍 Usuário encontrado no banco (ID: ${existing.id}). Atualizando privilégios...`);
      await db.updateUser(existing.id, {
        role: 'PLATFORM_ADMIN',
        passwordHash: hashPassword(password),
        planTier: 'EXCELLENCE_CYCLE',
        subscriptionStatus: 'ACTIVE',
      });
      console.log(`✅ Sucesso! Usuário "${email}" agora possui o papel PLATFORM_ADMIN e senha atualizada.`);
    } else {
      console.log(`👤 Criando nova conta e organização administrativa para "${email}"...`);
      const org = await db.createOrganization('Creative Always Platform', 'creative-always-platform');
      const newUser = await db.createUser({
        organizationId: org.id,
        name: 'Platform Administrator',
        email,
        passwordHash: hashPassword(password),
        companyName: 'Creative Always Platform',
        role: 'PLATFORM_ADMIN',
        planTier: 'EXCELLENCE_CYCLE',
        subscriptionStatus: 'ACTIVE',
      });

      await db.createBrand({
        organizationId: org.id,
        name: 'Creative Always Platform',
        websiteUrl: 'https://creativealways.com.br',
        productDescription: 'Plataforma oficial GeoPulse Engine',
        targetAudience: 'Administradores da Plataforma',
        toneOfVoice: 'Autoritativo, Estratégico',
        ctaTargetUrl: 'https://creativealways.com.br/contato',
        ctaText: 'Contato',
        autoPublish: false,
        isActive: true,
      });

      console.log(`✅ Sucesso! Nova conta criada com ID ${newUser.id} e papel PLATFORM_ADMIN.`);
    }

    console.log('\n🔒 A senha foi criptografada com PBKDF2/SHA-512 e NÃO foi gravada em logs.');
    console.log('🚀 Acesso às rotas administrativas da plataforma liberado para este e-mail.\n');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Falha ao processar comando create-admin:', err.message);
    process.exit(1);
  }
}

main();
