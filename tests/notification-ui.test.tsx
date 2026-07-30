// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenterScreen } from '../apps/web/src/features/notifications/NotificationCenterPage'
import type {
  NotificationClient, NotificationSnapshot,
} from '../apps/web/src/features/notifications/client'

afterEach(cleanup)
const ar = {
  heading: '\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a',
  title: '\u0645\u0631\u0627\u062c\u0639\u0629 \u0645\u0637\u0644\u0648\u0628\u0629',
  markRead: '\u062a\u0639\u0644\u064a\u0645 \u0643\u0645\u0642\u0631\u0648\u0621',
  save: '\u062d\u0641\u0638',
  provider: '\u0645\u0632\u0648\u062f \u0627\u0644\u0628\u0631\u064a\u062f \u063a\u064a\u0631 \u0645\u0647\u064a\u0623',
}
const snapshot: NotificationSnapshot = {
  emailProvider: { name: 'local', configured: true },
  capabilities: { managePreferences: true },
  notifications: [{
    id: 'notification-1', title: ar.title,
    preview: '\u0627\u0641\u062a\u062d \u0632\u0645\u0627\u0645 \u0644\u0644\u062a\u0641\u0627\u0635\u064a\u0644',
    status: 'unread', critical: false, createdAt: '2026-07-30 12:00',
    resourceType: 'review_request', resourceId: 'review-1', version: 1,
  }],
  preferences: [{
    eventType: 'review.requested', label: '\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0631\u0627\u062c\u0639\u0629',
    critical: false, inApp: true, email: true, digest: 'immediate',
    timezone: 'Africa/Cairo', quietHoursStart: '22:00', quietHoursEnd: '07:00',
    version: 1,
  }],
}
function client(value = snapshot): NotificationClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    setStatus: vi.fn().mockResolvedValue(undefined),
    updatePreference: vi.fn().mockResolvedValue(undefined),
  }
}
describe('notification center UI', () => {
  it('renders an accessible Arabic RTL inbox and preference controls', async () => {
    const view = render(<NotificationCenterScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: ar.heading })).toBeTruthy()
    expect(screen.getByText(ar.title)).toBeTruthy()
    expect(view.container.querySelector('main')?.getAttribute('dir')).toBe('rtl')
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('marks a notification read through the trusted client command', async () => {
    const api = client()
    render(<NotificationCenterScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: ar.heading })
    fireEvent.click(screen.getByRole('button', { name: `${ar.markRead}: ${ar.title}` }))
    await waitFor(() => expect(api.setStatus).toHaveBeenCalledWith(
      'org-1', 'notification-1', 1, 'read',
    ))
  })
  it('fails visibly closed when email is not configured', async () => {
    render(<NotificationCenterScreen organizationId="org-1" client={client({
      ...snapshot, emailProvider: { name: 'none', configured: false },
    })} />)
    expect((await screen.findByRole('alert')).textContent).toContain(ar.provider)
    expect((screen.getByLabelText('\u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a') as HTMLInputElement).disabled).toBe(true)
  })
})
