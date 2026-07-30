// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateManagementScreen } from '../apps/web/src/features/templates/TemplateManagementPage'
import type { TemplateClient, TemplateSnapshot } from '../apps/web/src/features/templates/client'

afterEach(cleanup)
const snapshot: TemplateSnapshot = {
  templates: [{ id: 'tpl-1', name: 'تقرير أسبوعي', templateType: 'task', status: 'draft', version: 1, workflowName: null }],
  schedules: [{ id: 'schedule-1', templateId: 'tpl-1', templateName: 'تقرير أسبوعي', status: 'active', frequency: 'weekly', timezone: 'Africa/Cairo', timeLocal: '09:00', nextRunAt: '2026-08-02T06:00:00.000Z', version: 1 }],
  capabilities: { create: true, publish: true, manageRecurrence: true },
}
function client(): TemplateClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
    setScheduleStatus: vi.fn().mockResolvedValue(undefined),
  }
}
describe('template management UI', () => {
  it('renders an accessible RTL template and schedule inventory', async () => {
    const view = render(<TemplateManagementScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'القوالب والعمل المتكرر' })).toBeTruthy()
    expect(screen.getAllByText('تقرير أسبوعي')).toHaveLength(2)
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('creates a draft from explicit input', async () => {
    const api = client()
    render(<TemplateManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'القوالب والعمل المتكرر' })
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'مشروع متكرر' } })
    fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'project' } })
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء مسودة' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('org-1', { name: 'مشروع متكرر', templateType: 'project' }))
  })
})
