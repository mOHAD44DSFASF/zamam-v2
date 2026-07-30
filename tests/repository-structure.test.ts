import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const requiredPaths = [
  'apps/web/src/main.tsx',
  'packages/domain/src/index.ts',
  'packages/contracts/src/index.ts',
  'packages/authorization/src/index.ts',
  'packages/config/src/index.ts',
  'packages/firestore/src/index.ts',
  'packages/observability/src/index.ts',
  'services/functions/src/index.ts',
  'services/workers/src/index.ts',
]

describe('repository foundation', () => {
  it.each(requiredPaths)('contains %s', (path) => {
    expect(existsSync(path)).toBe(true)
  })

  it('points Firebase Hosting at the web build', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
      hosting: { public: string }
    }
    expect(config.hosting.public).toBe('apps/web/dist')
  })
})
