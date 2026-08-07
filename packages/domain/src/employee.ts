export const EMPLOYEE_NUMBER_MAX_LENGTH = 32

export function normalizeEmployeeNumber(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normalized)) throw new Error('INVALID_EMPLOYEE_NUMBER')
  return normalized
}

export function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('INVALID_EMAIL')
  return normalized
}

/** E.164-ish: optional leading +, then 8-15 digits, country code included (no local-format guessing) — the
 * exact shape wa.me links require (see domain/whatsapp.ts buildWhatsappLink). */
export function normalizeWhatsappPhone(value: string) {
  const trimmed = value.trim().replace(/[\s()-]/g, '')
  const normalized = trimmed.startsWith('+') ? trimmed : `+${trimmed}`
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error('INVALID_WHATSAPP_PHONE')
  return normalized
}

export function assertDateOnly(value: string, code = 'INVALID_DATE') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(code)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(code)
  return value
}

export interface EmployeeProjectionSource {
  userId: string
  displayName: string
  jobTitle: string
  departmentId: string
  employmentType: 'employee' | 'contractor'
  employmentStatus: string
  managerUserId?: string
  startDate?: string
  endDate?: string
  email?: string
  phone?: string
  compensation?: unknown
}

export function projectEmployeeFields(source: EmployeeProjectionSource, access: 'directory' | 'hr' | 'compensation') {
  const directory = {
    userId: source.userId,
    displayName: source.displayName,
    jobTitle: source.jobTitle,
    departmentId: source.departmentId,
    employmentType: source.employmentType,
    employmentStatus: source.employmentStatus,
  }
  if (access === 'directory') return directory
  const hr = {
    ...directory,
    ...(source.managerUserId ? { managerUserId: source.managerUserId } : {}),
    ...(source.startDate ? { startDate: source.startDate } : {}),
    ...(source.endDate ? { endDate: source.endDate } : {}),
    ...(source.email ? { email: source.email } : {}),
    ...(source.phone ? { phone: source.phone } : {}),
  }
  return access === 'hr' ? hr : { ...hr, compensation: source.compensation ?? null }
}
