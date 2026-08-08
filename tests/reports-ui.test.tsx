// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsScreen } from '../apps/web/src/features/reports/ReportsPage'
import type { ReportClient, ReportSnapshot } from '../apps/web/src/features/reports/client'
afterEach(cleanup)
const title = '\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631 \u0648\u0645\u0624\u0634\u0631\u0627\u062a \u0627\u0644\u0623\u062f\u0627\u0621'
const snapshot: ReportSnapshot = { periodStart: '2026-08-01', periodEnd: '2026-08-31', metrics: [{ id: 'm-1', name: '\u0646\u0633\u0628\u0629 \u0627\u0644\u0625\u0646\u062c\u0627\u0632 \u0641\u064a \u0627\u0644\u0645\u0648\u0639\u062f', value: 75, unit: 'percent', definitionVersion: 2, cutoffAt: '2026-09-01', status: 'complete', visibility: 'operational' }, { id: 'm-2', name: '\u0623\u062f\u0627\u0621 \u0627\u0644\u0641\u0631\u062f', value: 80, unit: 'percent', definitionVersion: 1, cutoffAt: '2026-09-01', status: 'complete', visibility: 'performance_sensitive' }], exportJobs: [], capabilities: { export: true, viewPerformance: false, viewFinancial: false }, allowedExportFields: [{ key: 'metric', label: '\u0627\u0644\u0645\u0624\u0634\u0631' }, { key: 'value', label: '\u0627\u0644\u0642\u064a\u0645\u0629' }] }
const client = (): ReportClient => ({ load: vi.fn().mockResolvedValue(snapshot), requestExport: vi.fn().mockResolvedValue(undefined) })
describe('reports UI', () => {
  it('renders accessible RTL metrics and hides sensitive performance', async () => { const view = render(<MemoryRouter><ReportsScreen organizationId="org-1" client={client()} periodStart="2026-08-01" /></MemoryRouter>); expect(await screen.findByRole('heading', { name: title })).toBeTruthy(); expect(screen.queryByText('\u0623\u062f\u0627\u0621 \u0627\u0644\u0641\u0631\u062f')).toBeNull(); expect((await axe(view.container)).violations).toEqual([]) })
  it('requests only server-advertised selected fields', async () => { const api = client(); render(<MemoryRouter><ReportsScreen organizationId="org-1" client={api} periodStart="2026-08-01" /></MemoryRouter>); await screen.findByRole('heading', { name: title }); fireEvent.click(screen.getByRole('button', { name: '\u0637\u0644\u0628 \u062a\u0635\u062f\u064a\u0631 CSV' })); await waitFor(() => expect(api.requestExport).toHaveBeenCalledWith('org-1', expect.objectContaining({ requestedFields: ['metric','value'], scopeType: 'organization', scopeId: 'org-1' }))) })
})
