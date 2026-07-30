// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowBuilderScreen } from '../apps/web/src/features/workflows/WorkflowBuilderPage'
import type { WorkflowBuilderClient, WorkflowBuilderSnapshot } from '../apps/web/src/features/workflows/client'

afterEach(cleanup)
const snapshot: WorkflowBuilderSnapshot = {
  template: { id: 'template-1', name: 'سير المقال', status: 'draft', version: 2, latestVersionNumber: 1 },
  draft: {
    id: 'draft-1', version: 3, valid: true, errors: [],
    definition: {
      startStageKey: 'brief',
      stages: [
        { key: 'brief', name: 'الملخص', type: 'work', terminal: false },
        { key: 'done', name: 'مكتمل', type: 'work', terminal: true },
      ],
      transitions: [{ key: 'complete', from: 'brief', to: 'done', requiredPermission: 'task.transition' }],
    },
  },
  capabilities: { manage: true, publish: true, simulate: true },
}
function client(): WorkflowBuilderClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    simulate: vi.fn().mockResolvedValue({ paths: [['brief', 'done']], errors: [] }),
  }
}

describe('workflow builder UI', () => {
  it('renders an accessible RTL graph and simulation result', async () => {
    const api = client()
    const view = render(<WorkflowBuilderScreen organizationId="org-1" templateId="template-1" client={api} />)
    expect(await screen.findByRole('heading', { name: 'سير المقال' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'محاكاة' }))
    expect(await screen.findByText('1 مسارات نهائية قابلة للوصول.')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('publishes only through an explicit versioned command', async () => {
    const api = client()
    render(<WorkflowBuilderScreen organizationId="org-1" templateId="template-1" client={api} />)
    await screen.findByRole('heading', { name: 'سير المقال' })
    fireEvent.click(screen.getByRole('button', { name: 'نشر إصدار' }))
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('org-1', {
      templateId: 'template-1', draftVersionId: 'draft-1', expectedTemplateVersion: 2, expectedDraftVersion: 3,
    }))
  })

  it('saves the edited draft without mutating a published version', async () => {
    const api = client()
    render(<WorkflowBuilderScreen organizationId="org-1" templateId="template-1" client={api} />)
    await screen.findByRole('heading', { name: 'سير المقال' })
    fireEvent.change(screen.getByLabelText('اسم المرحلة 1'), { target: { value: 'ملخص محدث' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.updateDraft).toHaveBeenCalledWith('org-1', 'draft-1', 3, expect.objectContaining({
      stages: expect.arrayContaining([expect.objectContaining({ key: 'brief', name: 'ملخص محدث' })]),
    })))
  })
})

