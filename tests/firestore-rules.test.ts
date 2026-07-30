import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Firestore defense-in-depth rules', () => {
  const rules = readFileSync('firestore.rules', 'utf8')

  it('allows only a self get of the session read model', () => {
    expect(rules).toContain('allow get: if authenticated() && request.auth.uid == userId;')
    expect(rules).toContain('allow list, create, update, delete: if false;')
  })

  it('ends with a recursive deny for every other client operation', () => {
    expect(rules).toContain('match /{document=**}')
    expect(rules).toContain('allow read, write: if false;')
    expect(rules).not.toMatch(/allow\s+(read|write)\s*:\s*if\s+true/)
  })
})
