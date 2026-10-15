import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const BOT_DIR = fileURLToPath(new URL('../../riyan-bot/', import.meta.url))

// 봇 전용 비밀값이 따로 없으면 SESSION_SECRET에서 고정값을 뽑아 씁니다. 재시작해도 값이 바뀌지 않습니다.
function derive(label: string): string {
  return createHmac('sha256', config.sessionSecret).update(`riyan:${label}`).digest('hex')
}

function botEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: process.env.RIYAN_DATABASE_URL || process.env.DATABASE_URL,
    // 사이트의 ADMIN_CODE_ENCRYPTION_KEY(base64)와 이름이 같지만 봇은 64자 hex를 요구합니다.
    ADMIN_CODE_ENCRYPTION_KEY: process.env.RIYAN_ADMIN_CODE_ENCRYPTION_KEY || derive('admin-code-key'),
    CODE_HASH_PEPPER: process.env.CODE_HASH_PEPPER || derive('code-hash-pepper'),
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || derive('internal-api-key'),
    INTERNAL_HOST: '127.0.0.1',
    // 같은 서버 안의 사이트와 직접 통신합니다.
    LIVEBRARY_SYNC_URLS: `http://127.0.0.1:${config.apiPort}`,
    LIVEBRARY_SYNC_KEY: config.riyanSyncKey,
    LIVEBRARY_CONNECT_URL: process.env.LIVEBRARY_CONNECT_URL || config.publicOrigin,
  }
}

/**
 * RIYAN_BOT_ENABLED=true 이면 리얀 디스코드 봇을 사이트와 같은 서버에서 자식 프로세스로 띄웁니다.
 * 봇이 죽으면 5초~1분 간격으로 다시 켭니다. 로컬 PC에서 봇을 따로 돌릴 때는 켜지 마세요 (같은 봇이 두 번 응답).
 */
export function startRiyanBot(): () => void {
  if (process.env.RIYAN_BOT_ENABLED !== 'true') return () => undefined
  if (!process.env.DISCORD_BOT_TOKEN?.trim() || !config.riyanSyncKey) {
    console.warn('Riyan bot not started: DISCORD_BOT_TOKEN and RIYAN_SYNC_KEY are required.')
    return () => undefined
  }
  if (!existsSync(`${BOT_DIR}src/index.js`)) {
    console.warn(`Riyan bot not started: ${BOT_DIR} is missing.`)
    return () => undefined
  }

  let child: ChildProcess | null = null
  let stopped = false
  let failures = 0
  let timer: NodeJS.Timeout | undefined

  const launch = () => {
    const startedAt = Date.now()
    child = spawn(process.execPath, ['src/index.js'], { cwd: BOT_DIR, env: botEnv(), stdio: 'inherit' })
    child.on('exit', (code) => {
      child = null
      if (stopped) return
      failures = Date.now() - startedAt > 10 * 60 * 1000 ? 1 : failures + 1
      const delay = Math.min(60_000, 5_000 * 2 ** (failures - 1))
      console.warn(`Riyan bot exited (${code ?? 'signal'}), restarting in ${delay / 1000}s`)
      timer = setTimeout(launch, delay)
    })
  }
  launch()

  return () => {
    stopped = true
    clearTimeout(timer)
    child?.kill('SIGTERM')
  }
}
