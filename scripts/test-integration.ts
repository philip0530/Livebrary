import { loadProjectEnv } from '@livebrary/database/load-env'
import { ensureEnv, prepareDatabase, run } from './local-env.ts'

ensureEnv()
loadProjectEnv()
await prepareDatabase()
await run('npx', ['vitest', 'run', 'tests/integration'], { ...process.env, LIVEBRARY_INTEGRATION: '1' })
