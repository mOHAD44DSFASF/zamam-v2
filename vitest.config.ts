import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@zamam/authorization': fileURLToPath(new URL('./packages/authorization/src/index.ts', import.meta.url)),
      '@zamam/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@zamam/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
      '@zamam/firestore': fileURLToPath(new URL('./packages/firestore/src/index.ts', import.meta.url)),
      '@zamam/observability': fileURLToPath(new URL('./packages/observability/src/index.ts', import.meta.url)),
      '@zamam/workers': fileURLToPath(new URL('./services/workers/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'services/**/*.test.{ts,tsx}'],
    exclude: ['tests/**/*.emulator.test.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
})
