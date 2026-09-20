import { IndexNowConfig } from './types.js';

/**
 * Notificador de Indexação Instantânea via protocolo IndexNow.
 * O IndexNow avisa imediatamente os motores de busca (Bing, Yandex, Naver, Seznam)
 * para que os robôs rastreiem o novo conteúdo em minutos, alimentando também IAs como Copilot e Perplexity.
 */
export async function notifyIndexNow(
  urlList: string[],
  config: IndexNowConfig
): Promise<boolean> {
  if (!urlList || urlList.length === 0) return false;

  console.log(`⚡ [INDEXNOW] Notificando motores de busca para ${urlList.length} URL(s)...`);

  const endpoint = 'https://api.indexnow.org/indexnow';

  const payload: Record<string, any> = {
    host: config.host,
    key: config.key,
    urlList,
  };

  if (config.keyLocation) {
    payload.keyLocation = config.keyLocation;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    // 200 OK ou 202 Accepted indicam sucesso no recebimento do IndexNow
    if (response.ok || response.status === 202) {
      console.log(`   ✓ IndexNow notificado com sucesso! Status: ${response.status}`);
      return true;
    } else {
      const text = await response.text();
      console.warn(`   ⚠️ IndexNow retornou status ${response.status}: ${text}`);
      return false;
    }
  } catch (error) {
    console.error('   ❌ Falha na chamada do IndexNow:', error);
    return false;
  }
}
