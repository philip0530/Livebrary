import { ensureEnv, prepareDatabase } from './local-env.ts'

const created = ensureEnv()
if (created.created && created.adminPassword) {
  console.log(`Local operator account: operator`)
  console.log(`Local operator password (store this; it is not printed again): ${created.adminPassword}`)
}
await prepareDatabase()
console.log('Local database is ready on 127.0.0.1:54329')
