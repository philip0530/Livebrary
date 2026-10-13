import { defineConfig } from 'prisma/config'
import { loadProjectEnv } from './src/load-env.ts'

loadProjectEnv()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
