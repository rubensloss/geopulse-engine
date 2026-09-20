export interface ContentJobData {
  brandId: string;
  topicQueueId: string;
  topic: string;
  primaryKeyword: string;
  targetLanguage?: 'pt-BR' | 'en-US' | 'es-ES';
  priority?: number;
  scheduledFor?: Date;
  attempt?: number;
}

export interface JobResult {
  success: boolean;
  brandId: string;
  topicQueueId: string;
  articleId?: string;
  publishedUrl?: string;
  status: 'PUBLISHED' | 'READY_FOR_REVIEW' | 'FAILED';
  durationMs: number;
  error?: string;
}

export interface WorkerOptions {
  concurrency?: number; // Quantos artigos podem ser gerados simultaneamente
  pollIntervalMs?: number; // Intervalo de checagem do agendador (padrão: 5000ms)
  maxRetries?: number; // Tentativas de reprocessamento em caso de falha da API
  useRedis?: boolean; // Se true, conecta ao BullMQ/Redis; se false, usa fila em memória ultra-resiliente
  redisUrl?: string;
}
