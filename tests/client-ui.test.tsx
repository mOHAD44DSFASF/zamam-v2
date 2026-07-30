// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientManagementScreen } from '../apps/web/src/features/clients/ClientManagementPage'
import type { ClientManagementClient, ClientManagementSnapshot } from '../apps/web/src/features/clients/client'

afterEach(cleanup)

const snapshot: ClientManagementSnapshot = {
  clients: [{ id: 'client-1', name: 'شركة العميل', code: 'CLIENT', industry: 'تقنية', status: 'active', activeProjectCount: 2 }],
  contacts: [{
    id: 'contact-1', clientId: 'client-1', name: 'مدير التسويق', emailDisplay: 'm***@example.com',
    portalStatus: 'none', clientAdmin: true, version: 1,
  }],
  capabilities: { create: true, manage: true, manageContacts: true, archive: true },
}

function client(): ClientManagementClient {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    create: vi.fn().mockResolvedValue(undefined),
    addContact: vi.fn().mockResolvedValue(undefined),
    setEligibility: vi.fn().mockResolvedValue(undefined),
  }
}

describe('client management UI', () => {
  it('renders the Arabic list/detail projection with no axe violations', async () => {
    const view = render(<ClientManagementScreen organizationId="org-1" client={client()} />)
    expect(await screen.findByRole('heading', { name: 'العملاء' })).toBeTruthy()
    expect(screen.getAllByText('شركة العميل').length).toBeGreaterThan(0)
    expect(screen.getByText('m***@example.com')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })

  it('creates a contact without exposing a portal invitation action', async () => {
    const api = client()
    render(<ClientManagementScreen organizationId="org-1" client={api} />)
    await screen.findByRole('heading', { name: 'العملاء' })
    fireEvent.click(screen.getByRole('button', { name: /جهة اتصال/ }))
    expect(screen.getByText('إضافة جهة الاتصال لا ترسل دعوة ولا تمنح صلاحية دخول.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /دعوة/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('الاسم'), { target: { value: 'مسؤول جديد' } })
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }))
    await waitFor(() => expect(api.addContact).toHaveBeenCalledWith('org-1', {
      clientId: 'client-1', name: 'مسؤول جديد', email: 'new@example.com', clientAdmin: false,
    }))
  })

  it('records eligibility as a separate command without creating portal access', async () => {
    const api = client()
    render(<ClientManagementScreen organizationId="org-1" client={api} />)
    await screen.findByText('مدير التسويق')
    fireEvent.click(screen.getByRole('button', { name: 'تحديد كمؤهل' }))
    await waitFor(() => expect(api.setEligibility).toHaveBeenCalledWith('org-1', {
      clientId: 'client-1', contactId: 'contact-1', expectedVersion: 1, eligible: true,
    }))
  })
})
