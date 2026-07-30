export type LogLevel = 'info' | 'warn' | 'error'

export interface LogRecord {
  level: LogLevel
  event: string
  correlationId: string
  timestamp: string
  fields: Readonly<Record<string, unknown>>
}

export interface LogSink {
  write(record: LogRecord): void
}

const sensitiveKey = /authorization|cookie|password|secret|token|credential|api[-_]?key/i

export function redact(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]))
  }
  return value
}

export function createLogger(sink: LogSink, now: () => Date = () => new Date()) {
  const write = (level: LogLevel, event: string, correlationId: string, fields: Record<string, unknown> = {}) => {
    sink.write({ level, event, correlationId, timestamp: now().toISOString(), fields: redact(fields) as Record<string, unknown> })
  }
  return {
    info: (event: string, correlationId: string, fields?: Record<string, unknown>) => write('info', event, correlationId, fields),
    warn: (event: string, correlationId: string, fields?: Record<string, unknown>) => write('warn', event, correlationId, fields),
    error: (event: string, correlationId: string, fields?: Record<string, unknown>) => write('error', event, correlationId, fields),
  }
}
