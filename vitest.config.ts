import { mergeConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import viteConfig from './vite.config.ts'
import { discoverTests } from './scripts/test.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

export default mergeConfig(viteConfig, {
  cacheDir: path.join(process.env.AGENTDECK_CONFIG_DIR || '.', '.agentdeck/cache/vitest'),
  test: {
    include: discoverTests(root).vitest.map((file) => path.relative(root, file).split(path.sep).join('/')),
    environment: 'node',
    css: { include: /\.css(?:\?|$)/ },
    maxWorkers: 2,
    minWorkers: 1,
  },
})
