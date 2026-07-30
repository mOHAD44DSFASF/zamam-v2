// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewInboxScreen } from '../apps/web/src/features/reviews/ReviewInboxPage'
import type { ReviewInboxClient, ReviewInboxSnapshot } from '../apps/web/src/features/reviews/client'

afterEach(cleanup)
const snapshot: ReviewInboxSnapshot = {
  items: [{
    approvalId: 'approval-1', approvalVersion: 1, reviewRequestId: 'review-1',
    taskId: 'task-1', taskTitle: 'مراجعة المقال', projectName: 'مشروع المحتوى',
    requestedByName: 'مدير المحتوى', reviewedVersion: 5, round: 1, policy: 'all',
    visibility: 'internal', dueAt: null, orderReady: true,
  }],
  capabilities: { decide: true, delegate: true },
}
function client(): ReviewInboxClient {
  return { load: vi.fn().mockResolvedValue(snapshot), decide: vi.fn().mockResolvedValue(undefined) }
}
describe('review inbox UI', () => {
  it('renders accessible RTL review evidence', async () => {
    const view = render(<ReviewInboxScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'المراجعات والموافقات' })).toBeTruthy()
    expect(screen.getByText('نسخة العمل 5 · سياسة all')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('requires and sends a reason for change requests', async () => {
    const api = client()
    render(<ReviewInboxScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'المراجعات والموافقات' })
    fireEvent.change(screen.getByLabelText('سبب القرار مراجعة المقال'), { target: { value: 'يرجى تصحيح العنوان' } })
    fireEvent.click(screen.getByRole('button', { name: 'طلب تعديلات' }))
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('org-1', {
      approvalId: 'approval-1', expectedApprovalVersion: 1,
      decision: 'changes_requested', reason: 'يرجى تصحيح العنوان',
    }))
  })
})

