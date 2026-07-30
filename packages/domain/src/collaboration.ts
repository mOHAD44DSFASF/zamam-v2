const MAX_COMMENT_LENGTH = 4000

export function normalizeCommentBody(value: string) {
  const normalized = value.normalize('NFC').replaceAll('\r\n', '\n').trim()
  if (!normalized || normalized.length > MAX_COMMENT_LENGTH) throw new Error('COMMENT_BODY_INVALID')
  for (const character of normalized) {
    const code = character.charCodeAt(0)
    if ((code < 32 && character !== '\n' && character !== '\t') || code === 127) {
      throw new Error('COMMENT_CONTROL_CHARACTER_DENIED')
    }
  }
  return normalized
}

export function commentEditableUntil(now: string, minutes = 15) {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp) || minutes < 1 || minutes > 60) throw new Error('INVALID_COMMENT_EDIT_WINDOW')
  return new Date(timestamp + minutes * 60_000).toISOString()
}
