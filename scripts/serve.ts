import { ensureEnv, prepareDatabase, run } from './local-env.ts'

const created = ensureEnv()
if (created.created && created.adminPassword) {
  console.log('Local operator account: operator')
  console.log(`Local operator password (store this; it is not printed again): ${created.adminPassword}`)
}
await prepareDatabase()
await run('npm', ['run', 'build', '-w', '@livebrary/web'])
const port = process.env.API_PORT?.trim() || '3001'
await run('npm', ['run', 'start', '-w', '@livebrary/api'], {
  ...process.env,
  SERVE_WEB: '1',
  HOST: process.env.HOST?.trim() || '0.0.0.0',
  API_PORT: port,
})
