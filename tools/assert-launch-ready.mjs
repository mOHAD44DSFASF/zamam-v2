import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures = []
const read = (path) => readFileSync(join(root, path), 'utf8')

const firebaseAdapter = read('services/functions/src/api/firebase-adapter.ts')
if (firebaseAdapter.includes('new DisabledFeatureCommandDispatcher()')) {
  failures.push('FEATURE_COMMAND_DISPATCHER_NOT_COMPOSED')
}

const workerTransport = read('services/workers/src/http.ts')
if (workerTransport.includes('WORKER_TRANSPORT_NOT_CONFIGURED')) {
  failures.push('WORKER_TRANSPORT_NOT_COMPOSED')
}

if (process.env.ZAMAM_LAUNCH_AUTHORITY_APPROVED !== 'true') {
  failures.push('LAUNCH_AUTHORITY_NOT_APPROVED')
}

if (!/^[A-Za-z0-9_-]{8,128}$/.test(process.env.ZAMAM_STAGING_ASSURANCE_ID ?? '')) {
  failures.push('STAGING_ASSURANCE_EVIDENCE_MISSING')
}

if (failures.length > 0) {
  console.error(`ZAMAM launch blocked: ${failures.join(', ')}`)
  process.exit(1)
}

console.log('ZAMAM launch-readiness assertions passed.')
