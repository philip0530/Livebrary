export type Limiter = {
  hit: (key: string, limit: number, windowMs: number) => boolean | Promise<boolean>
}

export function createMemoryLimiter(): Limiter {
  const buckets = new Map<string, { count: number; reset: number }>()
  return {
    hit(key, limit, windowMs) {
      const now = Date.now()
      const current = buckets.get(key)
      if (!current || current.reset <= now) {
        buckets.set(key, { count: 1, reset: now + windowMs })
        return true
      }
      current.count += 1
      return current.count <= limit
    },
  }
}

export async function createLimiter(redisUrl: string): Promise<Limiter> {
  const memory = createMemoryLimiter()
  if (!redisUrl) return memory
  try {
    const imported = await import('ioredis')
    const Redis = imported.default
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    })
    await redis.ping()
    console.log('Rate limiter connected to Redis')
    return {
      async hit(key, limit, windowMs) {
        const redisKey = `lb:rate:${key}`
        const count = await redis.incr(redisKey)
        if (count === 1) await redis.pexpire(redisKey, windowMs)
        return count <= limit
      },
    }
  } catch (error) {
    console.warn(error instanceof Error ? `Redis unavailable (${error.message}), using memory rate limiter` : 'Redis unavailable')
    return memory
  }
}
