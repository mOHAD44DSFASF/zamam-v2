/**
 * Frontend-local mirror of packages/domain/src/whatsapp.ts's pure encoding logic — duplicated rather than
 * imported because @zamam/domain is a backend-only workspace package (not a declared dependency of
 * apps/web) and its barrel file re-exports modules that are unsafe to bundle into the browser. Keep this
 * in sync with the domain version if the message format changes; see Area 5 of the dashboard/member
 * rollout for where this is used (task pipeline WhatsApp reminder button).
 */
export interface WhatsappReminderInput {
  taskTitle: string
  projectName?: string
  stepName: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueAt?: string
  description?: string
}

const PRIORITY_LABEL_AR: Record<WhatsappReminderInput['priority'], string> = {
  low: 'عادي', medium: 'عادي', high: 'مهم', urgent: 'عاجل',
}

export function buildWhatsappReminderMessage(input: WhatsappReminderInput): string {
  const lines = [
    `تذكير بمهمة: ${input.taskTitle}`,
    ...(input.projectName ? [`المشروع: ${input.projectName}`] : []),
    `الخطوة الحالية: ${input.stepName}`,
    `الأولوية: ${PRIORITY_LABEL_AR[input.priority]}`,
    ...(input.dueAt ? [`تاريخ الاستحقاق: ${input.dueAt.slice(0, 10)}`] : []),
    ...(input.description ? ['', input.description.slice(0, 500)] : []),
  ]
  return lines.join('\n')
}

export function buildWhatsappLink(phone: string, message: string): string {
  const digitsOnly = phone.replace(/^\+/, '')
  if (!/^[1-9]\d{7,14}$/.test(digitsOnly)) throw new Error('INVALID_WHATSAPP_PHONE')
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`
}
