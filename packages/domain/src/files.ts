const MAX_FILE_SIZE = 100 * 1024 * 1024
const allowedTypes = new Map<string, ReadonlySet<string>>([
  ['application/pdf', new Set(['pdf'])],
  ['image/jpeg', new Set(['jpg', 'jpeg'])],
  ['image/png', new Set(['png'])],
  ['image/webp', new Set(['webp'])],
  ['text/plain', new Set(['txt'])],
  ['text/csv', new Set(['csv'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['docx'])],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Set(['xlsx'])],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', new Set(['pptx'])],
])

export interface FileUploadDescriptor {
  displayName: string
  contentType: string
  sizeBytes: number
  checksumSha256: string
}

export function validateFileUpload(input: FileUploadDescriptor) {
  const displayName = input.displayName.normalize('NFC').trim()
  if (!displayName || displayName.length > 180 || displayName.includes('/') || displayName.includes('\\')) {
    throw new Error('FILE_NAME_INVALID')
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_FILE_SIZE) {
    throw new Error('FILE_SIZE_DENIED')
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256)) throw new Error('FILE_CHECKSUM_INVALID')
  const extension = displayName.includes('.') ? displayName.split('.').at(-1)!.toLowerCase() : ''
  if (!allowedTypes.get(input.contentType)?.has(extension)) throw new Error('FILE_TYPE_DENIED')
  return { ...input, displayName, checksumSha256: input.checksumSha256.toLowerCase() }
}

export function privateObjectKey(
  organizationId: string,
  fileId: string,
  versionNumber: number,
  fileVersionId: string,
) {
  const valid = /^[A-Za-z0-9_-]{2,128}$/
  if (!valid.test(organizationId) || !valid.test(fileId) || !valid.test(fileVersionId)) {
    throw new Error('FILE_OBJECT_ID_INVALID')
  }
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new Error('FILE_VERSION_INVALID')
  return `tenants/${organizationId}/files/${fileId}/versions/${versionNumber}/${fileVersionId}`
}

export function filePurgeAfter(now: string, days = 30) {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp) || !Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('FILE_RETENTION_INVALID')
  }
  return new Date(timestamp + days * 86_400_000).toISOString()
}
