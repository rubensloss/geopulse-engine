import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();
export const prisma = global.__geopulse_prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    global.__geopulse_prisma = prisma;
}
