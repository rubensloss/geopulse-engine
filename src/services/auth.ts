import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import type { StoredUser, PlanTier } from '../db/types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'omnicite-secret-key-geo-2026-ciclo-excelencia-secure';

export interface TokenPayload {
  userId: string;
  organizationId: string;
  role: string;
  planTier: PlanTier;
  email: string;
  iat: number;
  exp: number;
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
  const payload: TokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    planTier: user.planTier,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 dias
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function registerUser(input: {
  name: string;
  email: string;
  password: string;
  companyName: string;
  phone?: string;
  planTier?: PlanTier;
}): { user: Omit<StoredUser, 'passwordHash'>; token: string } {
  const existing = db.getUserByEmail(input.email);
  if (existing) {
    throw new Error('Já existe uma conta registrada com este e-mail.');
  }

  // Cria organização correspondente para o tenant
  const slug = input.companyName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
  const org = db.createOrganization(input.companyName, slug);

  // Cria usuário
  const user = db.createUser({
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
  db.createBrand({
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

export function loginUser(input: {
  email: string;
  password: string;
}): { user: Omit<StoredUser, 'passwordHash'>; token: string } {
  const user = db.getUserByEmail(input.email);
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
