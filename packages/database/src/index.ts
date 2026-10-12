import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as { livebraryPrisma?: PrismaClient }

export const prisma = globalForPrisma.livebraryPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.livebraryPrisma = prisma

export { Prisma } from '@prisma/client'
export * from '@prisma/client'
