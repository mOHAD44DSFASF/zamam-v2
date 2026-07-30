const forbiddenProjectionFields = /password|secret|credential|token|privateKey|objectKey/i

export function projectFields<T extends Readonly<Record<string, unknown>>>(
  document: T,
  allowlist: readonly (keyof T & string)[],
): Partial<T> {
  const result: Partial<T> = {}
  for (const field of allowlist) {
    if (forbiddenProjectionFields.test(field)) throw new Error('SENSITIVE_FIELD_PROJECTION_DENIED')
    if (Object.hasOwn(document, field)) result[field] = document[field]
  }
  return result
}

export const CLIENT_TASK_PROJECTION = [
  'id', 'organizationId', 'projectId', 'title', 'description', 'status', 'priority', 'dueAt', 'completedAt', 'clientVisible',
] as const
