import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function loadEnvFile(file: string): void {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function loadProjectEnv(start = process.cwd()): void {
  const candidates = [
    path.resolve(start, '.env'),
    path.resolve(start, 'packages/database/.env'),
    path.resolve(start, '../../.env'),
    path.resolve(start, '../../../.env'),
  ]
  for (const file of candidates) loadEnvFile(file)
}
