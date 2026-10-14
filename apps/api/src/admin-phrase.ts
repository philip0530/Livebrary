import { prisma } from '@livebrary/database'
import { verifySecret } from '@livebrary/database/password'
import { weekStart } from '@livebrary/shared'

export type AdminPhraseVia = 'weekly' | 'riyan' | 'fallback'

export const RIYAN_CODE_KEY = 'riyan.adminCode'

export type RiyanCode = { weekStart: string; expiresAt: string; codeHash: string }

export function normalizePhrase(value: unknown): string | null {
  const phrase = String(value ?? '').trim().toLowerCase()
  if (!phrase || phrase.length > 64 || /\s/.test(phrase)) return null
  return phrase
}

async function matchRiyanCode(phrase: string): Promise<boolean> {
  const row = await prisma.serviceSetting.findUnique({ where: { key: RIYAN_CODE_KEY } })
  if (!row) return false
  let code: RiyanCode
  try {
    code = JSON.parse(row.value) as RiyanCode
  } catch {
    return false
  }
  if (code.weekStart !== weekStart().toISOString() || new Date(code.expiresAt) <= new Date()) return false
  return verifySecret(code.codeHash, phrase)
}

export async function matchAdminPhrase(phrase: string): Promise<AdminPhraseVia | null> {
  const current = await prisma.adminAccessCode.findUnique({ where: { weekStart: weekStart() } })
  if (current && current.status === 'ACTIVE' && current.expiresAt > new Date() && await verifySecret(current.codeHash, phrase)) {
    return 'weekly'
  }
  if (await matchRiyanCode(phrase)) return 'riyan'
  const fallback = await prisma.adminFallbackCredential.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' } })
  if (fallback && await verifySecret(fallback.codeHash, phrase)) return 'fallback'
  return null
}
