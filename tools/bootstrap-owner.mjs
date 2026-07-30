import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { FirebaseAtomicStore } from '@zamam/firestore'
import { BootstrapOwnerService } from '@zamam/functions/dist/organization/bootstrap-service.js'
import { FirebaseEmployeeIdentityAdapter } from '@zamam/functions/dist/employee/firebase-identity.js'

function parseArgs(argv) {
  const args = {}
  for (const entry of argv) {
    const match = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(entry)
    if (!match) continue
    args[match[1]] = match[2] ?? 'true'
  }
  return args
}

function value(args, argKey, envKey, fallback) {
  return args[argKey] ?? process.env[envKey] ?? fallback
}

function requireValue(args, argKey, envKey) {
  const resolved = value(args, argKey, envKey)
  if (!resolved) {
    console.error(`Missing required value: pass --${argKey}=... or set ${envKey}.`)
    process.exit(1)
  }
  return resolved
}

const args = parseArgs(process.argv.slice(2))

const isEmulatorTarget = Boolean(process.env.FIRESTORE_EMULATOR_HOST) && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)
const confirmedNonEmulator = value(args, 'confirm-non-emulator', 'ZAMAM_BOOTSTRAP_CONFIRM_NON_EMULATOR', 'false') === 'true'
if (!isEmulatorTarget && !confirmedNonEmulator) {
  console.error(
    'FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are not both set, so this does not look like a '
    + 'local emulator target. Refusing to run against what may be a real project.\n'
    + 'If this is genuinely intentional, re-run with --confirm-non-emulator=true '
    + '(or ZAMAM_BOOTSTRAP_CONFIRM_NON_EMULATOR=true).',
  )
  process.exit(1)
}

const organizationId = requireValue(args, 'organization-id', 'ZAMAM_BOOTSTRAP_ORGANIZATION_ID')
const organizationName = requireValue(args, 'organization-name', 'ZAMAM_BOOTSTRAP_ORGANIZATION_NAME')
const organizationSlug = value(args, 'organization-slug', 'ZAMAM_BOOTSTRAP_ORGANIZATION_SLUG', organizationId.toLowerCase())
const ownerEmail = requireValue(args, 'owner-email', 'ZAMAM_BOOTSTRAP_OWNER_EMAIL')
const ownerDisplayName = requireValue(args, 'owner-name', 'ZAMAM_BOOTSTRAP_OWNER_NAME')
const ownerFirstName = value(args, 'owner-first-name', 'ZAMAM_BOOTSTRAP_OWNER_FIRST_NAME', ownerDisplayName.split(' ')[0])
const ownerPassword = value(args, 'owner-password', 'ZAMAM_BOOTSTRAP_OWNER_PASSWORD', undefined)
const timezone = value(args, 'timezone', 'ZAMAM_BOOTSTRAP_TIMEZONE', 'Asia/Riyadh')
const locale = value(args, 'locale', 'ZAMAM_BOOTSTRAP_LOCALE', 'ar')

if (getApps().length === 0) initializeApp()
const store = new FirebaseAtomicStore(getFirestore())
const identities = new FirebaseEmployeeIdentityAdapter(getAuth())
const service = new BootstrapOwnerService(store, identities)

try {
  const result = await service.bootstrap({
    organizationId, organizationName, organizationSlug,
    ownerEmail, ownerDisplayName, ownerFirstName, ownerPassword, timezone, locale,
  })
  const performed = Object.entries(result.actions).filter(([, done]) => done).map(([action]) => action)
  console.log(JSON.stringify({
    status: 'ok',
    organizationId: result.organizationId,
    userId: result.userId,
    departmentId: result.departmentId,
    roleId: result.roleId,
    roleAssignmentId: result.roleAssignmentId,
    actionsPerformedThisRun: performed,
    alreadyBootstrapped: performed.length === 0,
  }, null, 2))
} catch (error) {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error)
  process.exit(1)
}
