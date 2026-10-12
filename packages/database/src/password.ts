import argon2 from 'argon2'

const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashSecret(value: string): Promise<string> {
  return argon2.hash(value, options)
}

export async function verifySecret(hash: string, value: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, value)
  } catch {
    return false
  }
}
