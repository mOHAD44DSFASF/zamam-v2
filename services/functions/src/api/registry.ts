import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal } from '@zamam/authorization'
import type { FeatureApiPath } from './feature-routes.js'

export interface CommandContext {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

export type CommandHandler = (context: CommandContext, input: Readonly<Record<string, unknown>>) => Promise<unknown>
export type HandlerRegistry = Partial<Record<FeatureApiPath, CommandHandler>>

export function fingerprintInput(input: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function requireString(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`INVALID_${key.toUpperCase()}`)
  return value
}

export function optionalString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

export function requireNumber(input: Readonly<Record<string, unknown>>, key: string): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`INVALID_${key.toUpperCase()}`)
  return value
}

export function requireBoolean(input: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = input[key]
  if (typeof value !== 'boolean') throw new Error(`INVALID_${key.toUpperCase()}`)
  return value
}

export function optionalNumber(input: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export type { AuthorizationPrincipal }
