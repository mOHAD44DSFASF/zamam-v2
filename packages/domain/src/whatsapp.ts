/**
 * No WhatsApp Business API — just a `wa.me` deep link the frontend opens in a new tab. The recipient still
 * has to press Send inside WhatsApp themselves; this only pre-fills the message.
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

/** `phone` must already be normalized E.164 (see employee.ts normalizeWhatsappPhone) — wa.me wants digits
 * only, no leading `+`. */
export function buildWhatsappLink(phone: string, message: string): string {
  const digitsOnly = phone.replace(/^\+/, '')
  if (!/^[1-9]\d{7,14}$/.test(digitsOnly)) throw new Error('INVALID_WHATSAPP_PHONE')
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`
}
