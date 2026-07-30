import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@zamam/authorization': fileURLToPath(new URL('./packages/authorization/src/index.ts', import.meta.url)),
      '@zamam/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@zamam/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@zamam/firestore': fileURLToPath(new URL('./packages/firestore/src/index.ts', import.meta.url)),
      '@zamam/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.emulator.test.ts'] },
})
