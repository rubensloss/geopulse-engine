import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import type { StoredUser, PlanTier } from '../db/types.js';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ERRO FATAL DE SEGURANÇA: JWT_SECRET não configurado em ambiente de produção!');
    }
    console.warn('⚠️ [SEGURANÇA] JWT_SECRET ausente em desenvolvimento. Usando segredo temporário local.');
    return 'geopulse-dev-jwt-secret-do-not-use-in-production-32b';
  }
  return secret;
}

export interface TokenPayload {
  userId: string;
  organizationId: string;
  role: string;
  planTier: PlanTier;
  email: string;
  iat?: number;
  exp?: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!combinedHash || !combinedHash.includes(':')) return false;
  const [salt, originalHash] = combinedHash.split(':');
  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(testHash, 'hex'));
}

export function generateToken(user: StoredUser): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    planTier: user.planTier,
    email: user.email,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: '30d',
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as TokenPayload;
  } catch {
    return null;
  }
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
  companyName: string;
  phone?: string;
  planTier?: PlanTier;
}): Promise<{ user: Omit<StoredUser, 'passwordHash'>; token: string }> {
  const existing = await db.getUserByEmail(input.email);
  if (existing) {
    throw new Error('Já existe uma conta registrada com este e-mail.');
  }

  // Cria organização correspondente para o tenant
  const slug = input.companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
  const org = await db.createOrganization(input.companyName, slug);

  // Cria usuário
  const user = await db.createUser({
    organizationId: org.id,
    name: input.name,
    email: input.email.toLowerCase().trim(),
    passwordHash: hashPassword(input.password),
    companyName: input.companyName,
    phone: input.phone,
    role: 'OWNER',
    planTier: input.planTier || 'FREE_TRIAL',
    subscriptionStatus: input.planTier && input.planTier !== 'FREE_TRIAL' ? 'ACTIVE' : 'TRIAL',
  });

  // Cria marca padrão
  await db.createBrand({
    organizationId: org.id,
    name: input.companyName,
    websiteUrl: `https://${slug}.com.br`,
    productDescription: `Soluções corporativas de ${input.companyName}`,
    targetAudience: 'Decisores de compra, empresários e diretores.',
    toneOfVoice: 'Profissional, autoritativo e orientado a dados.',
    ctaTargetUrl: `https://${slug}.com.br/contato`,
    ctaText: 'Falar com um Especialista',
    autoPublish: false,
    isActive: true,
  });

  const token = generateToken(user);
  const { passwordHash: _, ...safeUser } = user;
  return { user: safeUser, token };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: Omit<StoredUser, 'passwordHash'>; token: string }> {
  const user = await db.getUserByEmail(input.email);
  if (!user) {
    throw new Error('E-mail ou senha inválidos.');
  }

  const isValid = verifyPassword(input.password, user.passwordHash);
  if (!isValid) {
    throw new Error('E-mail ou senha inválidos.');
  }

  const token = generateToken(user);
  const { passwordHash: _, ...safeUser } = user;
  return { user: safeUser, token };
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Acesso não autorizado. Faça login para continuar.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Sessão expirada ou inválida. Por favor, entre novamente.' });
    return;
  }

  req.user = payload;
  next();
}

export function optionalAuthMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}

export function requireOwnerMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Acesso não autorizado. Faça login para continuar.' });
    return;
  }

  if (req.user.role !== 'OWNER' && req.user.role !== 'ADMIN') {
    res.status(403).json({ success: false, error: 'Acesso restrito a administradores da plataforma (papel OWNER).' });
    return;
  }

  next();
}
