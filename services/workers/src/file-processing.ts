import type { OutboxEvent } from '@zamam/domain'
import type { EventHandler } from './worker.js'

export interface MalwareScanner {
  readonly configured: boolean
  scan(input: {
    organizationId: string
    fileId: string
    fileVersionId: string
    objectKey: string
  }): Promise<{ verdict: 'clean' | 'infected' | 'error'; reportHash: string }>
}
export interface FileScanCommandPort {
  record(input: {
    organizationId: string
    fileId: string
    fileVersionId: string
    verdict: 'clean' | 'infected' | 'error'
    reportHash: string
    correlationId: string
    sourceEventId: string
  }): Promise<void>
}
export interface FilePurgeCommandPort {
  complete(input: {
    organizationId: string
    fileId: string
    correlationId: string
    sourceEventId: string
  }): Promise<void>
}

function payloadString(event: OutboxEvent, key: string) {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('FILE_EVENT_PAYLOAD_INVALID')
  }
  const value = (event.payload as Readonly<Record<string, unknown>>)[key]
  if (typeof value !== 'string' || !value) throw new Error('FILE_EVENT_PAYLOAD_INVALID')
  return value
}
function organizationId(event: OutboxEvent) {
  if (!event.organizationId) throw new Error('FILE_EVENT_TENANT_REQUIRED')
  return event.organizationId
}

export class FileScanHandler implements EventHandler {
  readonly eventType = 'file.scan_requested'
  constructor(private readonly scanner: MalwareScanner, private readonly commands: FileScanCommandPort) {}
  async handle(event: OutboxEvent) {
    if (!this.scanner.configured) throw new Error('MALWARE_SCANNER_NOT_CONFIGURED')
    const fileId = payloadString(event, 'fileId')
    const fileVersionId = payloadString(event, 'fileVersionId')
    const objectKey = payloadString(event, 'objectKey')
    const result = await this.scanner.scan({
      organizationId: organizationId(event), fileId, fileVersionId, objectKey,
    })
    await this.commands.record({
      organizationId: organizationId(event), fileId, fileVersionId,
      verdict: result.verdict, reportHash: result.reportHash,
      correlationId: event.correlationId, sourceEventId: event.id,
    })
  }
}

export class FilePurgeHandler implements EventHandler {
  readonly eventType = 'file.purge_requested'
  constructor(private readonly commands: FilePurgeCommandPort) {}
  async handle(event: OutboxEvent) {
    await this.commands.complete({
      organizationId: organizationId(event),
      fileId: payloadString(event, 'fileId'),
      correlationId: event.correlationId,
      sourceEventId: event.id,
    })
  }
}

export class LocalDeterministicScanner implements MalwareScanner {
  readonly configured = true
  constructor(private readonly infectedObjectKeys: ReadonlySet<string> = new Set()) {}
  async scan(input: { objectKey: string }) {
    const infected = this.infectedObjectKeys.has(input.objectKey)
    const seed = infected ? 'f' : 'c'
    return { verdict: infected ? 'infected' as const : 'clean' as const, reportHash: seed.repeat(64) }
  }
}
