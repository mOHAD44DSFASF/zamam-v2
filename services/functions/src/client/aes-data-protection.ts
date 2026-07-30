import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { normalizeEmail } from '@zamam/domain'
import type { SecretProvider } from '../platform/ports.js'
import type { ClientDataProtectionPort } from './service.js'

const decodeKey = (value: string, name: string) => {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error(`INVALID_SECRET:${name}`)
  return key
}

const additionalData = (organizationId: string, clientId: string) =>
  Buffer.from(`zamam-client-email:v1:${organizationId}:${clientId}`, 'utf8')

export class AesGcmClientDataProtectionAdapter implements ClientDataProtectionPort {
  constructor(private readonly secrets: SecretProvider) {}

  async protectEmail(input: { organizationId: string; clientId: string; normalizedEmail: string }) {
    const normalizedEmail = normalizeEmail(input.normalizedEmail)
    const [encryptionValue, hashValue, keyVersion] = await Promise.all([
      this.secrets.get('CLIENT_PII_ENCRYPTION_KEY'),
      this.secrets.get('CLIENT_PII_HASH_KEY'),
      this.secrets.get('CLIENT_PII_KEY_VERSION'),
    ])
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(keyVersion)) throw new Error('INVALID_CLIENT_PII_KEY_VERSION')
    const encryptionKey = decodeKey(encryptionValue, 'CLIENT_PII_ENCRYPTION_KEY')
    const hashKey = decodeKey(hashValue, 'CLIENT_PII_HASH_KEY')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
    cipher.setAAD(additionalData(input.organizationId, input.clientId))
    const encrypted = Buffer.concat([cipher.update(normalizedEmail, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      deterministicHash: createHmac('sha256', hashKey)
        .update(`${input.organizationId}:${input.clientId}:${normalizedEmail}`)
        .digest('hex'),
      ciphertext: `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`,
      keyVersion,
    }
  }

  async revealEmail(input: { organizationId: string; clientId: string; ciphertext: string; keyVersion: string }) {
    const [encryptionValue, currentVersion] = await Promise.all([
      this.secrets.get('CLIENT_PII_ENCRYPTION_KEY'),
      this.secrets.get('CLIENT_PII_KEY_VERSION'),
    ])
    if (input.keyVersion !== currentVersion) throw new Error('CLIENT_PII_KEY_VERSION_UNAVAILABLE')
    const parts = input.ciphertext.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('INVALID_CLIENT_PII_CIPHERTEXT')
    const [, ivValue, tagValue, encryptedValue] = parts
    const decipher = createDecipheriv(
      'aes-256-gcm',
      decodeKey(encryptionValue, 'CLIENT_PII_ENCRYPTION_KEY'),
      Buffer.from(ivValue!, 'base64url'),
    )
    decipher.setAAD(additionalData(input.organizationId, input.clientId))
    decipher.setAuthTag(Buffer.from(tagValue!, 'base64url'))
    return normalizeEmail(Buffer.concat([
      decipher.update(Buffer.from(encryptedValue!, 'base64url')),
      decipher.final(),
    ]).toString('utf8'))
  }
}
