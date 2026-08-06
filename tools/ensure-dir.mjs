import { mkdirSync } from 'node:fs'

const target = process.argv[2]
if (!target) {
  console.error('usage: node tools/ensure-dir.mjs <path>')
  process.exit(1)
}
mkdirSync(target, { recursive: true })
