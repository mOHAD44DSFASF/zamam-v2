// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileLibraryScreen } from '../apps/web/src/features/files/FileLibraryPage'
import type { FileLibraryClient, FileLibrarySnapshot } from '../apps/web/src/features/files/client'

afterEach(cleanup)
const snapshot: FileLibrarySnapshot = {
  provider: { name: 'r2', configured: true },
  capabilities: { upload: true, shareWithClient: true, restore: true },
  files: [{
    id: 'file-1', displayName: 'التسليم.pdf', resourceType: 'task',
    resourceId: 'task-1', resourceTitle: 'تسليم الهوية', contentType: 'application/pdf',
    sizeBytes: 2048, visibility: 'client', status: 'available',
    latestVersionNumber: 2, updatedAt: '2026-07-30T10:00:00.000Z',
    version: 5, canDownload: true, canDelete: true,
  }],
}
function client(value = snapshot): FileLibraryClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue({ url: 'https://download.invalid/signed', expiresAt: '2026-07-30T10:05:00.000Z' }),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}
describe('file library UI', () => {
  it('renders an accessible RTL private file inventory', async () => {
    const view = render(<FileLibraryScreen organizationId="org-1" client={client()} initialResourceId="task-1" />)
    expect(await screen.findByRole('heading', { name: 'مكتبة الملفات' })).toBeTruthy()
    expect(screen.getByText('التسليم.pdf')).toBeTruthy()
    expect(screen.getByText('يخضع الملف للفحص قبل الإتاحة.', { exact: false })).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('uploads only through the client workflow with explicit resource and visibility', async () => {
    const api = client()
    render(<FileLibraryScreen organizationId="org-1" client={api} initialResourceId="task-1" />)
    await screen.findByRole('heading', { name: 'مكتبة الملفات' })
    const file = new File(['content'], 'brief.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('الملف'), { target: { files: [file] } })
    fireEvent.click(screen.getByLabelText('ظاهر للعميل'))
    fireEvent.click(screen.getByRole('button', { name: 'رفع آمن' }))
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith('org-1', {
      file, resourceType: 'task', resourceId: 'task-1', visibility: 'client',
    }))
  })
  it('fails closed with a visible state when storage is not configured', async () => {
    render(<FileLibraryScreen organizationId="org-1" client={client({
      ...snapshot, provider: { name: 'r2', configured: false },
    })} />)
    expect((await screen.findByRole('alert')).textContent).toContain('التخزين غير مهيأ')
    expect((screen.getByRole('button', { name: 'رفع آمن' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'تنزيل التسليم.pdf' })).toBeNull()
  })
})
