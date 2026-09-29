import { db } from '../db/index.js';
import type { WhatsAppCloudConfig, StoredWhatsAppMessage } from '../db/types.js';

export interface SendDossierOptions {
  to: string;
  clientName?: string;
  companyName: string;
  reportSlug: string;
  score?: number | string;
  customNotes?: string;
}

export interface SendTextOptions {
  to: string;
  text: string;
}

export interface MetaWebhookChallengeQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export class WhatsAppCloudApiService {
  private defaultBaseUrl = 'https://graph.facebook.com/v20.0';

  /**
   * Obtém a configuração atual do banco ou variáveis de ambiente
   */
  getConfig(): WhatsAppCloudConfig {
    const config = db.getWhatsAppConfig();
    return {
      ...config,
      accessToken: config.accessToken || process.env.META_WA_TOKEN || '',
      phoneNumberId: config.phoneNumberId || process.env.META_WA_PHONE_NUMBER_ID || '',
      businessAccountId: config.businessAccountId || process.env.META_WA_BUSINESS_ACCOUNT_ID || '',
      verifyToken: config.verifyToken || process.env.META_WA_VERIFY_TOKEN || 'geopulse_meta_verify_secret_2026',
      templateName: config.templateName || 'dossie_executivo_geo',
      testMode: config.testMode !== undefined ? config.testMode : !config.accessToken,
    };
  }

  /**
   * Salva configurações atualizadas
   */
  saveConfig(updates: Partial<WhatsAppCloudConfig>): WhatsAppCloudConfig {
    return db.saveWhatsAppConfig(updates);
  }

  /**
   * Normaliza o número de telefone para o padrão internacional exigido pela Meta (E.164 sem o sinal de +).
   * Exemplo: (11) 99876-5432 -> 5511998765432
   */
  normalizePhoneNumber(rawPhone: string): string {
    let clean = (rawPhone || '').replace(/\D/g, '');
    
    // Se o usuário digitou sem DDI (apenas DDD + número, ex: 11999998888 ou 1188887777), adiciona 55 (Brasil)
    if (clean.length === 10 || clean.length === 11) {
      clean = '55' + clean;
    }

    return clean;
  }

  /**
   * Valida o token de verificação na configuração inicial do Webhook da Meta
   */
  verifyWebhook(query: MetaWebhookChallengeQuery): { isValid: boolean; challenge?: string } {
    const config = this.getConfig();
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === config.verifyToken) {
      return { isValid: true, challenge };
    }

    return { isValid: false };
  }

  /**
   * Processa eventos recebidos pelo Webhook da Meta (status de envio e mensagens recebidas)
   */
  handleIncomingWebhook(body: any): { processedCount: number; events: string[] } {
    const events: string[] = [];
    let count = 0;

    if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) {
      return { processedCount: 0, events: ['Payload ignorado (não é de whatsapp_business_account)'] };
    }

    for (const entry of body.entry) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const value = change.value;
        if (!value) continue;

        // 1. Atualizações de Status de Entrega (sent, delivered, read, failed)
        if (Array.isArray(value.statuses)) {
          for (const statusObj of value.statuses) {
            const metaMessageId = statusObj.id;
            const status = (statusObj.status || '').toLowerCase();
            const recipientId = statusObj.recipient_id;

            let dbStatus: StoredWhatsAppMessage['status'] = 'SENT';
            if (status === 'delivered') dbStatus = 'DELIVERED';
            else if (status === 'read') dbStatus = 'READ';
            else if (status === 'failed') dbStatus = 'FAILED';

            const errorMessage = statusObj.errors ? JSON.stringify(statusObj.errors) : undefined;
            const updated = db.updateWhatsAppMessageStatus(metaMessageId, dbStatus, errorMessage);

            events.push(`Status [${status.toUpperCase()}] para msg ${metaMessageId} (${recipientId}) - Atualizado no DB: ${updated}`);
            count++;
          }
        }

        // 2. Mensagens Recebidas de Clientes / Respostas
        if (Array.isArray(value.messages)) {
          for (const incomingMsg of value.messages) {
            const from = incomingMsg.from;
            const textBody = incomingMsg.text?.body || `[Mídia: ${incomingMsg.type}]`;

            events.push(`Resposta de cliente recebida de ${from}: "${textBody}"`);
            
            // Registra mensagem recebida
            db.saveWhatsAppMessage({
              to: from,
              formattedTo: from,
              type: 'TEXT',
              status: 'READ',
              metaMessageId: incomingMsg.id,
              clientName: value.contacts?.[0]?.profile?.name || 'Cliente WhatsApp',
              companyName: 'Resposta Recebida',
              errorMessage: `Mensagem do cliente: ${textBody}`,
            });
            count++;
          }
        }
      }
    }

    return { processedCount: count, events };
  }

  /**
   * Testa a conectividade com a Meta Graph API usando as credenciais cadastradas
   */
  async testConnection(): Promise<{ success: boolean; data?: any; error?: string }> {
    const config = this.getConfig();

    if (!config.accessToken) {
      return { success: false, error: 'Access Token da Meta (META_WA_TOKEN) não informado.' };
    }

    if (!config.phoneNumberId) {
      return { success: false, error: 'Phone Number ID da Meta (META_WA_PHONE_NUMBER_ID) não informado.' };
    }

    try {
      const url = `${this.defaultBaseUrl}/${config.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: json.error?.message || `Erro HTTP ${response.status} da Meta Graph API`,
          data: json,
        };
      }

      return {
        success: true,
        data: {
          verifiedName: json.verified_name,
          displayPhoneNumber: json.display_phone_number,
          qualityRating: json.quality_rating,
          codeVerificationStatus: json.code_verification_status,
          liveStatus: 'Conexão ativa com a Meta Cloud API',
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Falha de rede ao conectar na Meta: ${err.message}`,
      };
    }
  }

  /**
   * Envia o Dossiê Executivo via Template Oficial Aprovado da Meta
   */
  async sendDossierReport(options: SendDossierOptions): Promise<{
    success: boolean;
    messageRecord: StoredWhatsAppMessage;
    metaResponse?: any;
    error?: string;
  }> {
    const config = this.getConfig();
    const formattedTo = this.normalizePhoneNumber(options.to);

    if (formattedTo.length < 10) {
      throw new Error(`Número de telefone inválido: "${options.to}". Informe com DDD, ex: (11) 98765-4321.`);
    }

    const clientName = options.clientName || 'Decisor Executivo';
    const companyName = options.companyName || 'Sua Empresa';
    const scoreText = options.score ? `${options.score}/100` : '28/100 (Crítico)';
    const templateName = config.templateName || 'dossie_executivo_geo';
    
    // Links de alta disponibilidade
    const dossierUrl = `https://rubensloss.github.io/geopulse-engine/relatorio.html?slug=${options.reportSlug}`;

    // Payload oficial no formato da Meta Cloud API v20.0
    const metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: clientName },
              { type: 'text', text: companyName },
              { type: 'text', text: scoreText },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              { type: 'text', text: options.reportSlug },
            ],
          },
        ],
      },
    };

    // MODO 1: Envio Real via Meta Graph API (se houver token e phoneNumberId)
    if (config.accessToken && config.phoneNumberId && !config.testMode) {
      try {
        const url = `${this.defaultBaseUrl}/${config.phoneNumberId}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metaPayload),
        });

        const json = await response.json();

        if (!response.ok) {
          const record = db.saveWhatsAppMessage({
            to: options.to,
            formattedTo,
            type: 'TEMPLATE',
            templateName,
            status: 'FAILED',
            clientName,
            companyName,
            reportSlug: options.reportSlug,
            dossierUrl,
            errorMessage: json.error?.message || `Erro da Meta: ${response.status}`,
          });

          return {
            success: false,
            messageRecord: record,
            metaResponse: json,
            error: json.error?.message || 'Erro ao enviar pela Meta',
          };
        }

        const metaMessageId = json.messages?.[0]?.id;
        const record = db.saveWhatsAppMessage({
          to: options.to,
          formattedTo,
          type: 'TEMPLATE',
          templateName,
          status: 'SENT',
          metaMessageId,
          clientName,
          companyName,
          reportSlug: options.reportSlug,
          dossierUrl,
        });

        return {
          success: true,
          messageRecord: record,
          metaResponse: json,
        };
      } catch (err: any) {
        const record = db.saveWhatsAppMessage({
          to: options.to,
          formattedTo,
          type: 'TEMPLATE',
          templateName,
          status: 'FAILED',
          clientName,
          companyName,
          reportSlug: options.reportSlug,
          dossierUrl,
          errorMessage: err.message,
        });

        return {
          success: false,
          messageRecord: record,
          error: err.message,
        };
      }
    }

    // MODO 2: Homologação / Simulação Estruturada (Pronto para receber o Token da Meta)
    const simulatedMetaId = `wamid.HBgL${Date.now()}SIMULATED==`;
    const record = db.saveWhatsAppMessage({
      to: options.to,
      formattedTo,
      type: 'TEMPLATE',
      templateName,
      status: 'SIMULATED',
      metaMessageId: simulatedMetaId,
      clientName,
      companyName,
      reportSlug: options.reportSlug,
      dossierUrl,
      errorMessage: 'Disparo simulado com sucesso. Para envio real pela Meta, insira seu META_WA_TOKEN nas Configurações.',
    });

    return {
      success: true,
      messageRecord: record,
      metaResponse: {
        messaging_product: 'whatsapp',
        contacts: [{ input: formattedTo, wa_id: formattedTo }],
        messages: [{ id: simulatedMetaId, message_status: 'accepted' }],
        templatePayload: metaPayload,
        isSimulation: true,
        previewText: `Olá ${clientName}, geramos o Dossiê Executivo de Presença em IA para a ${companyName}. Seu Score atual foi de ${scoreText}. Acesse o relatório completo: ${dossierUrl}`,
      },
    };
  }

  /**
   * Envia mensagem de texto direta (válido para clientes que responderam nas últimas 24h)
   */
  async sendTextMessage(options: SendTextOptions): Promise<{
    success: boolean;
    messageRecord: StoredWhatsAppMessage;
    metaResponse?: any;
    error?: string;
  }> {
    const config = this.getConfig();
    const formattedTo = this.normalizePhoneNumber(options.to);

    const metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedTo,
      type: 'text',
      text: {
        preview_url: true,
        body: options.text,
      },
    };

    if (config.accessToken && config.phoneNumberId && !config.testMode) {
      try {
        const url = `${this.defaultBaseUrl}/${config.phoneNumberId}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metaPayload),
        });

        const json = await response.json();
        if (!response.ok) {
          const record = db.saveWhatsAppMessage({
            to: options.to,
            formattedTo,
            type: 'TEXT',
            status: 'FAILED',
            errorMessage: json.error?.message,
          });
          return { success: false, messageRecord: record, metaResponse: json, error: json.error?.message };
        }

        const metaMessageId = json.messages?.[0]?.id;
        const record = db.saveWhatsAppMessage({
          to: options.to,
          formattedTo,
          type: 'TEXT',
          status: 'SENT',
          metaMessageId,
        });
        return { success: true, messageRecord: record, metaResponse: json };
      } catch (err: any) {
        const record = db.saveWhatsAppMessage({
          to: options.to,
          formattedTo,
          type: 'TEXT',
          status: 'FAILED',
          errorMessage: err.message,
        });
        return { success: false, messageRecord: record, error: err.message };
      }
    }

    const simulatedMetaId = `wamid.TEXT${Date.now()}SIMULATED==`;
    const record = db.saveWhatsAppMessage({
      to: options.to,
      formattedTo,
      type: 'TEXT',
      status: 'SIMULATED',
      metaMessageId: simulatedMetaId,
      errorMessage: 'Mensagem de texto simulada no ambiente de desenvolvimento.',
    });

    return {
      success: true,
      messageRecord: record,
      metaResponse: {
        messaging_product: 'whatsapp',
        contacts: [{ input: formattedTo, wa_id: formattedTo }],
        messages: [{ id: simulatedMetaId }],
        isSimulation: true,
      },
    };
  }
}

export const whatsappCloudApi = new WhatsAppCloudApiService();
