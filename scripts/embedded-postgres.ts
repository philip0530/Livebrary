import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'

const source = path.resolve(import.meta.dirname, '../node_modules/@embedded-postgres/windows-x64/native')
const binDir = path.join(os.homedir(), 'AppData', 'Local', 'livebrary', 'pg-bin')
const dataDir = path.join(os.homedir(), 'AppData', 'Local', 'livebrary', 'postgres')
const port = 54329

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.on('exit', (code) => {
      const robocopy = path.basename(command).toLowerCase() === 'robocopy.exe' || path.basename(command).toLowerCase() === 'robocopy'
      if (robocopy && code !== null && code < 8) {
        resolve()
        return
      }
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(command)} exited ${code}`))
    })
  })
}

async function ensureBinaries(): Promise<void> {
  if (existsSync(path.join(binDir, 'bin', 'postgres.exe'))) return
  mkdirSync(binDir, { recursive: true })
  await run('robocopy', [source, binDir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'])
}

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Postgres did not become ready')), 60_000)
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      process.stderr.write(text)
      if (text.includes('database system is ready to accept connections')) {
        clearTimeout(timer)
        resolve()
      }
      if (text.includes('FATAL')) {
        clearTimeout(timer)
        reject(new Error(text.trim()))
      }
    }
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`postgres exited ${code}`))
    })
  })
}

async function canConnect(): Promise<boolean> {
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'livebrary',
    password: 'livebrary',
    database: 'postgres',
    connectionTimeoutMillis: 1000,
  })
  try {
    await client.connect()
    await client.end()
    return true
  } catch {
    return false
  }
}

export async function startEmbeddedPostgres() {
  if (!(await canConnect())) {
    await ensureBinaries()
    const initdb = path.join(binDir, 'bin', 'initdb.exe')
    const postgres = path.join(binDir, 'bin', 'postgres.exe')
    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
      mkdirSync(dataDir, { recursive: true })
      const passwordFile = path.join(os.tmpdir(), 'livebrary-pg.pw')
      writeFileSync(passwordFile, 'livebrary\n')
      await run(initdb, [
        `--pgdata=${dataDir}`,
        '--auth=scram-sha-256',
        '--username=livebrary',
        `--pwfile=${passwordFile}`,
        '--locale=C',
        '--encoding=UTF8',
      ], { ...process.env, LC_MESSAGES: 'C' })
    }
    const child = spawn(postgres, ['-D', dataDir, '-p', String(port)], {
      env: { ...process.env, LC_MESSAGES: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk))
    await waitForReady(child)
    child.unref()
    for (const stream of [child.stdout, child.stderr]) (stream as unknown as { unref?: () => void } | null)?.unref?.()
  }
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: 'livebrary',
    password: 'livebrary',
    database: 'postgres',
  })
  await client.connect()
  const existing = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'livebrary'`)
  if (existing.rowCount === 0) await client.query('CREATE DATABASE livebrary')
  await client.end()
  return {
    async stop() {
      const ctl = path.join(binDir, 'bin', 'pg_ctl.exe')
      if (!existsSync(ctl)) return
      await run(ctl, ['-D', dataDir, 'stop', '-m', 'fast']).catch(() => undefined)
    },
  }
}
