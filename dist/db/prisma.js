import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const connectionString = process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/geopulse?schema=public';
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = global.__geopulse_prisma ??
    new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    global.__geopulse_prisma = prisma;
}
