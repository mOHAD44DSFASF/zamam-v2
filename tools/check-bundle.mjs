import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const DIST = resolve('apps/web/dist')
const manifest = JSON.parse(await readFile(resolve(DIST, '.vite/manifest.json'), 'utf8'))
const JavaScriptBudget = 650 * 1024
const EntryBudget = 350 * 1024
const ImageBudget = 1024 * 1024
const violations = []
const inspected = []

for (const [source, item] of Object.entries(manifest)) {
  if (!item.file?.endsWith('.js')) continue
  const bytes = (await stat(resolve(DIST, item.file))).size
  const budget = item.isEntry ? EntryBudget : JavaScriptBudget
  inspected.push({ source, file: item.file, bytes, budget, entry: Boolean(item.isEntry) })
  if (bytes > budget) violations.push(`${item.file}: ${bytes} bytes exceeds ${budget}`)
}

if (inspected.length === 0) throw new Error('No JavaScript artifacts were found in the Vite manifest')
for (const item of Object.values(manifest)) {
  for (const asset of item.assets ?? []) {
    if (!/\.(avif|gif|jpe?g|png|webp)$/i.test(asset)) continue
    const bytes = (await stat(resolve(DIST, asset))).size
    inspected.push({ source: 'image asset', file: asset, bytes, budget: ImageBudget, entry: false })
    if (bytes > ImageBudget) violations.push(`${asset}: ${bytes} bytes exceeds ${ImageBudget}`)
  }
}
console.table(inspected)
if (violations.length > 0) throw new Error(`Bundle budget failed:\n${violations.join('\n')}`)
