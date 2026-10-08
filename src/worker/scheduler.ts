import { ContentJobData, WorkerOptions } from './types.js';
import { processContentJob } from './content-processor.js';
import { db } from '../db/index.js';

/**
 * Agendador Autônomo de Conteúdo (Scheduler Engine).
 * Roda continuamente em background, monitorando pautas agendadas por marca,
 * controlando concorrência por tenant e disparando a esteira autônoma.
 */
export class AutonomousScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private activeJobsCount = 0;
  private activeBrandJobs: Set<string> = new Set(); // Controle de concorrência por marca
  private executionHistory: Array<{
    id: string;
    topic: string;
    brandId: string;
    brandName: string;
    durationMs: number;
    status: 'SUCCESS' | 'FAILED';
    executedAt: Date;
    error?: string;
  }> = [];

  private options: Required<WorkerOptions>;

  constructor(options: WorkerOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 2,
      pollIntervalMs: options.pollIntervalMs ?? 30000,
      maxRetries: options.maxRetries ?? 3,
      useRedis: options.useRedis ?? false,
      redisUrl: options.redisUrl ?? (process.env.REDIS_URL || 'redis://localhost:6379'),
    };
  }

  /**
   * Inicia o ciclo do agendador
   */
  start(): void {
    if (this.isRunning) {
      console.warn('⚠️ [SCHEDULER] O agendador já está em execução.');
      return;
    }

    this.isRunning = true;
    console.log(`\n⏰ [SCHEDULER] Iniciado com sucesso!`);
    console.log(`   - Concorrência máxima global: ${this.options.concurrency}`);
    console.log(`   - Intervalo de checagem: ${this.options.pollIntervalMs}ms`);
    console.log(`   - Modo: ${this.options.useRedis ? 'Distribuído (BullMQ + Redis)' : 'Autônomo (In-Memory Worker Pool)'}`);

    // Executa imediatamente o primeiro ciclo
    this.tick();

    // Inicia loop periódico
    this.timer = setInterval(() => {
      this.tick();
    }, this.options.pollIntervalMs);
  }

  /**
   * Para o agendador de forma segura
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('🛑 [SCHEDULER] Agendador pausado com segurança.');
  }

  /**
   * Ciclo de checagem do Scheduler
   */
  private async tick(): Promise<void> {
    if (!this.isRunning) return;

    // Se já atingiu o limite de concorrência global, aguarda o próximo ciclo
    if (this.activeJobsCount >= this.options.concurrency) {
      return;
    }

    // Busca todas as organizações e marcas ativas
    // Para cada marca, verifica se há pautas pendentes
    // (Como usamos o EnterpriseRepository, varremos as marcas cadastradas)
    const pendingTopicsToProcess = await this.findNextEligibleTopics();

    for (const jobData of pendingTopicsToProcess) {
      if (this.activeJobsCount >= this.options.concurrency) {
        break;
      }

      // Concorrência por marca: se a marca já está gerando um artigo agora, pula para não sobrecarregar
      if (this.activeBrandJobs.has(jobData.brandId)) {
        continue;
      }

      // Despacha o Job para execução assíncrona
      this.dispatchJob(jobData);
    }
  }

  /**
   * Identifica pautas elegíveis para processamento imediato
   */
  private async findNextEligibleTopics(): Promise<ContentJobData[]> {
    const eligible: ContentJobData[] = [];
    const now = new Date();

    const activeBrands = await db.listAllActiveBrands();

    for (const brand of activeBrands) {
      const pending = await db.listPendingTopics(brand.id);
      for (const topic of pending) {
        if (!topic.scheduledFor || topic.scheduledFor <= now) {
          eligible.push({
            brandId: topic.brandId,
            topicQueueId: topic.id,
            topic: topic.topic,
            primaryKeyword: topic.primaryKeyword,
            priority: topic.priority,
            scheduledFor: topic.scheduledFor,
          });
          break; // Pega 1 pauta por marca por ciclo para garantir rotatividade justa
        }
      }
    }

    return eligible;
  }

  /**
   * Dispara a execução assíncrona do Job
   */
  private async dispatchJob(job: ContentJobData): Promise<void> {
    this.activeJobsCount++;
    this.activeBrandJobs.add(job.brandId);

    console.log(`\n🚀 [SCHEDULER DISPATCH] Pauta "${job.topic}" enviada ao worker.`);
    console.log(`   Slots ocupados: ${this.activeJobsCount}/${this.options.concurrency}`);

    // Executa em background sem bloquear o tick do scheduler
    processContentJob(job)
      .then(async (result) => {
        const brand = await db.getBrand(job.brandId);
        this.executionHistory.unshift({
          id: `exec_${Date.now().toString(36)}`,
          topic: job.topic,
          brandId: job.brandId,
          brandName: brand ? brand.name : 'Marca',
          durationMs: result.durationMs,
          status: result.success ? 'SUCCESS' : 'FAILED',
          executedAt: new Date(),
          error: result.error,
        });
        if (this.executionHistory.length > 20) {
          this.executionHistory.pop();
        }

        if (result.success) {
          console.log(`🎉 [SCHEDULER CONCLUÍDO] Job finalizado em ${result.durationMs}ms para a marca ${job.brandId}`);
        } else {
          console.warn(`⚠️ [SCHEDULER FALHA] Job falhou: ${result.error}`);
        }
      })
      .catch((err) => {
        console.error(`💥 [SCHEDULER CRITICAL]:`, err);
      })
      .finally(() => {
        this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
        this.activeBrandJobs.delete(job.brandId);
      });
  }

  /**
   * Força uma execução imediata (ótimo para testes ao vivo e demonstrações a investidores)
   */
  async triggerNow(brandId?: string): Promise<{ dispatched: number; message: string }> {
    if (!this.isRunning) {
      this.start();
    }
    
    // Se a marca não tiver pauta pendente, o piloto automático gera uma pauta de alta relevância GEO
    if (brandId) {
      const pending = await db.listPendingTopics(brandId);
      if (pending.length === 0) {
        const brand = await db.getBrand(brandId);
        if (brand) {
          const autoTopic = await db.addTopicToQueue({
            brandId,
            topic: `Como escolher o melhor especialista em ${brand.name}: Guia Comparativo 2026`,
            primaryKeyword: `melhor especialista ${brand.name.toLowerCase()} custo beneficio`,
            searchIntent: 'COMMERCIAL',
            priority: 5,
          });
          console.log(`✨ [SCHEDULER AUTOPILOT] Pauta gerada automaticamente para ${brand.name}: ${autoTopic.topic}`);
        }
      }
    }

    const eligible = await this.findNextEligibleTopics();
    let dispatched = 0;

    for (const job of eligible) {
      if (this.activeJobsCount >= this.options.concurrency) break;
      if (brandId && job.brandId !== brandId) continue;
      if (this.activeBrandJobs.has(job.brandId)) continue;
      this.dispatchJob(job);
      dispatched++;
    }

    return {
      dispatched,
      message: dispatched > 0 
        ? `${dispatched} pauta(s) enviada(s) para produção autônoma com IndexNow.`
        : 'Ciclo verificado: Nenhuma pauta elegível ou limite de concorrência ativo.'
    };
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobsCount: this.activeJobsCount,
      activeBrands: Array.from(this.activeBrandJobs),
      concurrency: this.options.concurrency,
      pollIntervalMs: this.options.pollIntervalMs,
      history: this.executionHistory,
    };
  }
}

// Instância singleton exportada
export const scheduler = new AutonomousScheduler();
