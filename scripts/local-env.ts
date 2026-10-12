import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadProjectEnv } from '@livebrary/database/load-env'
import { startEmbeddedPostgres } from './embedded-postgres.ts'

const root = path.resolve(import.meta.dirname, '..')

function randomPassword(): string {
  return `Lb${randomBytes(9).toString('base64url')}9`
}

export function ensureEnv(): { created: boolean; adminPassword: string | null } {
  const file = path.join(root, '.env')
  if (existsSync(file)) return { created: false, adminPassword: null }
  const adminPassword = randomPassword()
  const session = randomBytes(32).toString('base64url')
  const key = randomBytes(32).toString('base64')
  const body = [
    'NODE_ENV=development',
    'DATABASE_URL=postgresql://livebrary:livebrary@127.0.0.1:54329/livebrary?schema=public',
    `SESSION_SECRET=${session}`,
    `ADMIN_CODE_ENCRYPTION_KEY=${key}`,
    'ADMIN_FALLBACK_CODE=Trust',
    'DISCORD_BOT_TOKEN=',
    'DISCORD_GUILD_ID=',
    'DISCORD_ACTIVITY_CHANNEL_ID=',
    'DISCORD_SECURITY_CHANNEL_ID=',
    'DISCORD_DEVELOPER_CODE_CHANNEL_ID=',
    'DISCORD_LOG_ENABLED=false',
    'DISCORD_LOG_AGGREGATION_SECONDS=30',
    'ADMIN_CODE_ROTATION_TIMEZONE=Asia/Seoul',
    'APP_ORIGIN=http://127.0.0.1:5173',
    'API_PORT=3001',
    'COLLAB_PORT=1234',
    'ADMIN_EMAIL=operator@livebrary.local',
    'ADMIN_USERNAME=operator',
    `ADMIN_PASSWORD=${adminPassword}`,
    'TLS_CERT_PATH=',
    'TLS_KEY_PATH=',
    'REDIS_URL=',
    'FORCE_SECURE_COOKIES=false',
    '',
  ].join('\n')
  writeFileSync(file, body, { encoding: 'utf8' })
  writeFileSync(path.join(root, 'packages', 'database', '.env'), `DATABASE_URL=postgresql://livebrary:livebrary@127.0.0.1:54329/livebrary?schema=public\n`, { encoding: 'utf8' })
  return { created: true, adminPassword }
}

function executable(command: string): string {
  if (process.platform !== 'win32') return command
  if (command === 'npm' || command === 'npx') return `${command}.cmd`
  return command
}

function quoteCmd(value: string): string {
  if (!/[\s"^&|<>]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = process.platform === 'win32'
      ? spawn([executable(command), ...args.map(quoteCmd)].join(' '), { cwd: root, env, stdio: 'inherit', shell: true })
      : spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)))
  })
}

export async function prepareDatabase(): Promise<void> {
  loadProjectEnv()
  mkdirSync(path.join(root, '.data'), { recursive: true })
  const pg = await startEmbeddedPostgres()
  process.once('SIGINT', () => { void pg.stop() })
  process.once('SIGTERM', () => { void pg.stop() })
  await run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'packages/database/prisma/schema.prisma'])
  await run('npm', ['run', 'db:seed'])
}
