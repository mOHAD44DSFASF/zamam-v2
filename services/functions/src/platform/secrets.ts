import type { SecretName, SecretProvider } from './ports.js'

const ENV_NAMES: Record<SecretName, string> = {
  R2_ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID',
  R2_SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  EMAIL_PROVIDER_API_KEY: 'RESEND_API_KEY',
  CLIENT_PII_ENCRYPTION_KEY: 'CLIENT_PII_ENCRYPTION_KEY',
  CLIENT_PII_HASH_KEY: 'CLIENT_PII_HASH_KEY',
  CLIENT_PII_KEY_VERSION: 'CLIENT_PII_KEY_VERSION',
}

export class EnvSecretProvider implements SecretProvider {
  async get(name: SecretName): Promise<string> {
    const value = process.env[ENV_NAMES[name]]
    if (!value) throw new Error(`SECRET_NOT_CONFIGURED:${name}`)
    return value
  }
}
