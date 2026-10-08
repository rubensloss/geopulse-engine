import dns from 'dns';
import net from 'net';

/**
 * Normaliza o host de entrada removendo esquema, porta, usuário e caminhos.
 */
export function extractCleanHostname(target: string): string {
  let clean = (target || '').trim().toLowerCase();

  // Remove esquema http:// ou https://
  if (clean.includes('://')) {
    try {
      const parsed = new URL(clean);
      clean = parsed.hostname;
    } catch {
      clean = clean.replace(/^https?:\/\//i, '').split('/')[0];
    }
  } else {
    // Remove qualquer barra ou query
    clean = clean.split('/')[0].split('?')[0].split('#')[0];
  }

  // Remove credenciais de autenticação (ex.: user@host)
  if (clean.includes('@')) {
    clean = clean.split('@').pop() || '';
  }

  // Remove colchetes de IPv6 (ex.: [::1] ou [fd12::1])
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  // Remove porta (exceto para IPv6 com colchetes já tratados)
  if (clean.includes(':') && !clean.includes('::') && !clean.includes('.')) {
    clean = clean.split(':')[0];
  } else if (clean.includes(':') && clean.split(':').length === 2 && !clean.includes('::')) {
    clean = clean.split(':')[0];
  }

  return clean.trim();
}

/**
 * Detecta se uma string é um IP literal em qualquer uma das representações conhecidas
 * (decimal com 1 a 4 partes, hex, octal, dword numérico ou IPv6).
 */
export function isLiteralIp(host: string): boolean {
  const h = host.toLowerCase().trim();

  // IPv6 detectado por net.isIP ou presença de colons
  if (net.isIP(h) === 6 || h.includes(':')) {
    return true;
  }

  // IPv4 padrão reconhecido pelo net.isIP
  if (net.isIP(h) === 4) {
    return true;
  }

  // Hexadecimal (ex.: 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(h)) {
    return true;
  }

  // Dword numérico decimal puro (ex.: 2130706433)
  if (/^\d{8,12}$/.test(h)) {
    return true;
  }

  // Notação decimal reduzida ou com octal (ex.: 127.1, 0177.0.0.1, 127.0.1)
  const parts = h.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const allNumericOrHex = parts.every(p => /^(0x[0-9a-f]+|\d+)$/i.test(p));
    if (allNumericOrHex) {
      return true;
    }
  }

  return false;
}

/**
 * Valida se um endereço IPv4 (em string com 4 octetos) é privado, loopback ou reservado.
 */
export function isRestrictedIpv4(ipStr: string): boolean {
  const parts = ipStr.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    return true;
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (This host on this network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Rede Privada RFC 1918)
  if (a === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 169.254.0.0/16 (Link-Local / Cloud Metadata AWS/GCP/Railway)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Rede Privada RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Rede Privada RFC 1918)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 224.0.0.0/4 (Multicast) e 240.0.0.0/4 (Reservado)
  if (a >= 224) return true;

  // Broadcast 255.255.255.255
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Valida se um endereço IPv6 é privado, loopback, link-local, ULA ou mapeado de IPv4.
 */
export function isRestrictedIpv6(ipStr: string): boolean {
  let clean = ipStr.toLowerCase().trim();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  // Loopback (::1) e Unspecified (::)
  if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1' || clean === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // IPv4-mapped IPv6 (ex.: ::ffff:127.0.0.1 ou ::ffff:7f00:1)
  if (clean.startsWith('::ffff:')) {
    const embeddedIpv4 = clean.replace(/^::ffff:/, '');
    if (net.isIP(embeddedIpv4) === 4) {
      return isRestrictedIpv4(embeddedIpv4);
    }
    // Pode estar em formato hex (ex.: ::ffff:7f00:0001)
    const hexParts = embeddedIpv4.split(':');
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      const oct1 = (p1 >> 8) & 0xff;
      const oct2 = p1 & 0xff;
      const oct3 = (p2 >> 8) & 0xff;
      const oct4 = p2 & 0xff;
      return isRestrictedIpv4(`${oct1}.${oct2}.${oct3}.${oct4}`);
    }
    return true;
  }

  // IPv6 ULA (Unique Local Address: fc00::/7 - inclui fc00.. e fd00.., incluindo fd12:: da rede interna do Railway)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean) || clean.startsWith('fc') || clean.startsWith('fd')) {
    return true;
  }

  // IPv6 Link-Local (fe80::/10 - inclui fe8*, fe9*, fea*, feb*)
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith('fe80:')) {
    return true;
  }

  // IPv6 Discard prefix (100::/64)
  if (clean.startsWith('100:')) {
    return true;
  }

  // IPv6 Documentation prefix (2001:db8::/32)
  if (clean.startsWith('2001:db8:') || clean.startsWith('2001:0db8:')) {
    return true;
  }

  // IPv6 Multicast (ff00::/8)
  if (clean.startsWith('ff')) {
    return true;
  }

  return false;
}

/**
 * Valida se um IP qualquer (IPv4 ou IPv6) é restrito ou interno.
 */
export function isRestrictedIp(ip: string): boolean {
  if (net.isIP(ip) === 6 || ip.includes(':')) {
    return isRestrictedIpv6(ip);
  }
  return isRestrictedIpv4(ip);
}

/**
 * Validação rigorosa contra SSRF:
 * 1. Rejeita IPs literais (o visitante deve fornecer um domínio com nome legível).
 * 2. Valida sintaxe de FQDN com TLD com pelo menos 2 caracteres alfabéticos.
 * 3. Bloqueia sufixos de rede interna (.internal, .local, .localhost, etc.).
 * 4. Resolve DNS e bloqueia se QUALQUER IP resolvido (IPv4 ou IPv6) for privado, loopback ou restrito.
 */
export async function isSsrfTargetAsync(target: string): Promise<boolean> {
  const host = extractCleanHostname(target);

  if (!host) return true;

  // Bloqueio imediato de nomes locais/internos conhecidos
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.railway.internal') ||
    host.endsWith('.arpa') ||
    host.endsWith('.onion')
  ) {
    return true;
  }

  // Se o visitante digitou um IP literal puro (IPv4, IPv6, hex, octal, dword) -> Rejeita imediatamente
  if (isLiteralIp(host)) {
    return true;
  }

  // Deve ser um nome de domínio válido com pelo menos um ponto e TLD alfabético de 2+ letras
  // Exemplo: empresa.com, loja.com.br, consultoria.ai
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
  if (!domainRegex.test(host)) {
    return true;
  }

  // Resolução de DNS assíncrona (lookup de todos os IPs vinculados ao domínio)
  try {
    const addresses = await dns.promises.lookup(host, { all: true });
    if (!addresses || addresses.length === 0) {
      return false; // Domínio não resolve, requisição HTTP falhará de forma segura
    }

    // Se QUALQUER endereço resolvido for restrito, bloqueia imediatamente
    for (const record of addresses) {
      if (isRestrictedIp(record.address)) {
        return true;
      }
    }
  } catch {
    // Falha de resolução de DNS (domínio inexistente) não é SSRF
    return false;
  }

  return false;
}

/**
 * Versão síncrona preliminar para verificações rápidas em memória.
 */
export function isSsrfTarget(target: string): boolean {
  const host = extractCleanHostname(target);

  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.railway.internal') ||
    host.endsWith('.arpa') ||
    host.endsWith('.onion')
  ) {
    return true;
  }

  if (isLiteralIp(host)) {
    return true;
  }

  // Verifica domínios de bypass de DNS como nip.io, sslip.io com IPs internos
  if (
    host.includes('127.0.0.1') ||
    host.includes('10.0.') ||
    host.includes('192.168.') ||
    host.includes('172.16.')
  ) {
    return true;
  }

  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;
  if (!domainRegex.test(host)) {
    return true;
  }

  return false;
}

/**
 * Fetch seguro com proteção anti-SSRF de ponta a ponta:
 * - Valida a URL de partida contra SSRF (sintaxe + DNS lookup).
 * - Usa redirect manual (`redirect: 'manual'`) com até 3 hops.
 * - Valida rigorosamente cada cabeçalho `Location` antes de seguir o redirecionamento.
 */
export async function safeFetch(
  targetUrl: string,
  options: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let currentUrl = targetUrl;
  let remainingRedirects = maxRedirects;

  while (true) {
    // 1. Valida URL atual contra SSRF
    const isSsrf = await isSsrfTargetAsync(currentUrl);
    if (isSsrf) {
      const err: any = new Error('Acesso bloqueado por segurança: endereço interno ou não permitido para escaneamento.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Executa requisição com redirect manual
    const response = await fetch(currentUrl, {
      ...options,
      redirect: 'manual',
    });

    // 3. Se for redirecionamento (301, 302, 303, 307, 308), valida o próximo destino
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (remainingRedirects <= 0) {
        throw new Error('Limite máximo de redirecionamentos excedido.');
      }

      const location = response.headers.get('location');
      if (!location) {
        return response;
      }

      // Resolve URL relativa se necessário
      const nextUrl = new URL(location, currentUrl).toString();

      // Checa SSRF no destino antes de fazer a próxima requisição
      const nextIsSsrf = await isSsrfTargetAsync(nextUrl);
      if (nextIsSsrf) {
        const err: any = new Error('Acesso bloqueado por segurança: redirecionamento para endereço interno não permitido.');
        err.statusCode = 400;
        throw err;
      }

      currentUrl = nextUrl;
      remainingRedirects--;
      continue;
    }

    return response;
  }
}
