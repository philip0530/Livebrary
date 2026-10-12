import path from 'node:path'
import { ensureEnv, prepareDatabase, run } from './local-env.ts'

const root = path.resolve(import.meta.dirname, '..')
const created = ensureEnv()
if (created.created && created.adminPassword) {
  console.log(`Local operator account: operator`)
  console.log(`Local operator password (store this; it is not printed again): ${created.adminPassword}`)
}
await prepareDatabase()
await run('npx', ['concurrently', '-n', 'web,api', '-c', 'green,gray', 'npm run dev -w @livebrary/web', 'npm run dev -w @livebrary/api'], {
  ...process.env,
  FORCE_COLOR: '1',
})
void root
