export function redactAIText(input: string) {
  if (input.length > 20_000) throw new Error('AI_INPUT_TOO_LARGE')
  return input
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '[REDACTED_PHONE]')
    .replace(/\b(?:Bearer\s+|sk-)[A-Za-z0-9._-]{12,}\b/gi, '[REDACTED_SECRET]')
}
export function assertAIContentSafe(input: string) {
  const normalized = input.toLowerCase()
  if (/(ignore|bypass).{0,30}(instruction|policy|permission)|system prompt|developer message/.test(normalized)) throw new Error('AI_PROMPT_INJECTION_DETECTED')
}
export const aiContentHash = async (input: string) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const aiProposalHash = (actionType: string, argumentsValue: Readonly<Record<string, string>>) =>
  aiContentHash(JSON.stringify({ actionType, arguments: Object.fromEntries(Object.entries(argumentsValue).sort(([a],[b]) => a.localeCompare(b))) }))
