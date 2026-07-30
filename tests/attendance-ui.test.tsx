// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttendanceLeaveScreen } from '../apps/web/src/features/attendance/AttendanceLeavePage'
import type { AttendanceLeaveClient, AttendanceLeaveSnapshot } from '../apps/web/src/features/attendance/client'
afterEach(cleanup)
const title = '\u0627\u0644\u062d\u0636\u0648\u0631 \u0648\u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a'
const snapshot: AttendanceLeaveSnapshot = { today: null, leaveTypes: [{ id: 'leave-type-1', name: '\u0633\u0646\u0648\u064a\u0629', remainingDays: 12, source: 'zamam' }], myRequests: [], approvalQueue: [], capabilities: { recordAttendance: true, requestLeave: true, approveLeave: false, viewTeamAttendance: false } }
const client = (): AttendanceLeaveClient => ({ load: vi.fn().mockResolvedValue(snapshot), record: vi.fn().mockResolvedValue(undefined), requestLeave: vi.fn().mockResolvedValue(undefined), decideLeave: vi.fn().mockResolvedValue(undefined) })
describe('attendance and leave UI', () => {
  it('renders an accessible RTL self-service view', async () => { const view = render(<AttendanceLeaveScreen organizationId="org-1" client={client()} />); expect(await screen.findByRole('heading', { name: title })).toBeTruthy(); expect((await axe(view.container)).violations).toEqual([]) })
  it('submits an explicit leave type and date range', async () => { const api = client(); render(<AttendanceLeaveScreen organizationId="org-1" client={api} />); await screen.findByRole('heading', { name: title }); fireEvent.change(screen.getByLabelText('\u0645\u0646'), { target: { value: '2026-08-03' } }); fireEvent.change(screen.getByLabelText('\u0625\u0644\u0649'), { target: { value: '2026-08-04' } }); fireEvent.change(screen.getByLabelText('\u0627\u0644\u0633\u0628\u0628'), { target: { value: '\u0625\u062c\u0627\u0632\u0629 \u0633\u0646\u0648\u064a\u0629' } }); fireEvent.click(screen.getByRole('button', { name: '\u0625\u0631\u0633\u0627\u0644' })); await waitFor(() => expect(api.requestLeave).toHaveBeenCalledWith('org-1', expect.objectContaining({ leaveTypeId: 'leave-type-1', startsOn: '2026-08-03', endsOn: '2026-08-04' }))) })
})
