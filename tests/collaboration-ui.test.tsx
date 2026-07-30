// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollaborationScreen } from '../apps/web/src/features/collaboration/CollaborationPage'
import type {
  CollaborationClient, CollaborationSnapshot,
} from '../apps/web/src/features/collaboration/client'

afterEach(cleanup)
const snapshot: CollaborationSnapshot = {
  resource: { type: 'task', id: 'task-1', title: 'مراجعة الحملة', clientVisible: true },
  comments: [{
    id: 'comment-1', authorName: 'سارة', authorUserId: 'user-1', body: 'تم تحديث النسخة',
    visibility: 'internal', status: 'active', createdAt: '2026-07-30 10:00', editedAt: null,
    version: 1, mine: true, locked: false, mentions: [{ userId: 'user-2', displayName: 'أحمد' }],
    reactions: [{ type: 'like', count: 2, selected: false }],
  }],
  mentionCandidates: [{ userId: 'user-2', displayName: 'أحمد' }],
  watched: false,
  capabilities: {
    createInternal: true, createClient: true, updateOwn: true, deleteOwn: true,
    react: true, watch: true,
  },
}
function client(value = snapshot): CollaborationClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    create: vi.fn().mockResolvedValue(undefined),
    tombstone: vi.fn().mockResolvedValue(undefined),
    setReaction: vi.fn().mockResolvedValue(undefined),
    setWatch: vi.fn().mockResolvedValue(undefined),
  }
}
describe('collaboration UI', () => {
  it('renders an accessible RTL conversation with explicit visibility', async () => {
    const view = render(<CollaborationScreen organizationId="org-1" resourceType="task" resourceId="task-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'مراجعة الحملة' })).toBeTruthy()
    expect(screen.getAllByText('داخلي', { exact: false }).length).toBeGreaterThan(0)
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('sends client visibility and selected mention explicitly', async () => {
    const api = client()
    render(<CollaborationScreen organizationId="org-1" resourceType="task" resourceId="task-1" client={api} />)
    await screen.findByRole('heading', { name: 'مراجعة الحملة' })
    fireEvent.click(screen.getByLabelText('ظاهر للعميل'))
    fireEvent.change(screen.getByLabelText('التعليق'), { target: { value: 'جاهز لمراجعة العميل' } })
    fireEvent.click(screen.getByLabelText('أحمد'))
    fireEvent.click(screen.getByRole('button', { name: 'إرسال' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', {
      resourceType: 'task', resourceId: 'task-1', body: 'جاهز لمراجعة العميل',
      visibility: 'client', mentionedUserIds: ['user-2'],
    }))
  })
  it('does not render the internal channel for a client projection', async () => {
    const portal: CollaborationSnapshot = {
      ...snapshot,
      comments: snapshot.comments.map((comment) => ({ ...comment, visibility: 'client' })),
      capabilities: { ...snapshot.capabilities, createInternal: false },
    }
    render(<CollaborationScreen organizationId="org-1" resourceType="task" resourceId="task-1" client={client(portal)} />)
    await screen.findByRole('heading', { name: 'مراجعة الحملة' })
    expect(screen.queryByLabelText('داخلي')).toBeNull()
  })
})
