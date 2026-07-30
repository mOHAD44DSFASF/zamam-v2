// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeTrackingScreen } from '../apps/web/src/features/time/TimeTrackingPage'
import type { TimeClient, TimeSnapshot } from '../apps/web/src/features/time/client'

afterEach(cleanup)
const ar = {
  title: '\u0627\u0644\u0648\u0642\u062a \u0648\u0643\u0634\u0648\u0641 \u0627\u0644\u0633\u0627\u0639\u0627\u062a',
  start: '\u0628\u062f\u0621 \u0627\u0644\u0645\u0624\u0642\u062a',
  stop: '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0645\u0624\u0642\u062a',
  submit: '\u0625\u0631\u0633\u0627\u0644 \u0643\u0634\u0641 \u0627\u0644\u0633\u0627\u0639\u0627\u062a',
}
const snapshot: TimeSnapshot = {
  timezone: 'Africa/Cairo', periodStart: '2026-08-03', periodEnd: '2026-08-09',
  runningEntry: null, timesheet: null, approvalQueue: [],
  projects: [{ id: 'project-1', name: '\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0647\u0648\u064a\u0629' }],
  capabilities: {
    track: true, submit: true, approve: false,
    viewBillable: false, requestCorrection: true,
  },
  entries: [{
    id: 'time-1', projectId: 'project-1', projectName: '\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0647\u0648\u064a\u0629',
    taskId: null, taskTitle: null, startedAt: '2026-08-03 10:00',
    endedAt: '2026-08-03 11:00', minutes: 60, billable: true,
    note: '', status: 'draft', version: 1,
  }],
}
function client(value = snapshot): TimeClient {
  return {
    load: vi.fn().mockResolvedValue(value), start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined), createManual: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(undefined), decide: vi.fn().mockResolvedValue(undefined),
  }
}
describe('time tracking UI', () => {
  it('renders an accessible RTL self view without leaking billable labels', async () => {
    const view = render(<TimeTrackingScreen organizationId="org-1" client={client()} initialPeriodStart="2026-08-03" />)
    expect(await screen.findByRole('heading', { name: ar.title })).toBeTruthy()
    expect(screen.queryByText('\u0642\u0627\u0628\u0644 \u0644\u0644\u0641\u0648\u062a\u0631\u0629')).toBeNull()
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('starts a timer through the trusted client', async () => {
    const api = client()
    render(<TimeTrackingScreen organizationId="org-1" client={api} initialPeriodStart="2026-08-03" />)
    await screen.findByRole('heading', { name: ar.title })
    fireEvent.click(screen.getByRole('button', { name: ar.start }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(
      'org-1', expect.objectContaining({
        projectId: 'project-1', timezone: 'Africa/Cairo', billable: false,
      }),
    ))
  })
  it('submits only the explicit displayed period', async () => {
    const api = client()
    render(<TimeTrackingScreen organizationId="org-1" client={api} initialPeriodStart="2026-08-03" />)
    await screen.findByRole('heading', { name: ar.title })
    fireEvent.click(screen.getByRole('button', { name: ar.submit }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith(
      'org-1', '2026-08-03', '2026-08-09',
    ))
  })
})
