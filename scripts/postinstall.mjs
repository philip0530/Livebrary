import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('node_modules/prisma/build/index.js')) {
  console.log('prisma CLI not installed, skipping client generate')
  process.exit(0)
}

const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema=packages/database/prisma/schema.prisma'], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
