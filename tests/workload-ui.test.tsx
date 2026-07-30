// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkloadScreen } from '../apps/web/src/features/workload/WorkloadPage'
import type {
  WorkloadClient, WorkloadScope, WorkloadSnapshot,
} from '../apps/web/src/features/workload/client'

afterEach(cleanup)
const ar = {
  title: '\u0639\u0628\u0621 \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u0633\u0639\u0629',
  unknownNote: '\u062a\u0648\u062c\u062f \u0645\u0647\u0627\u0645 \u0628\u0644\u0627 \u062a\u0642\u062f\u064a\u0631\u061b \u0644\u0645 \u062a\u064f\u0639\u0627\u0645\u0644 \u0643\u0635\u0641\u0631.',
  rebuild: '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062d\u0633\u0627\u0628',
}
const scope: WorkloadScope = { type: 'team', id: 'team-1', label: '\u0641\u0631\u064a\u0642 \u0627\u0644\u062a\u0635\u0645\u064a\u0645' }
const snapshot: WorkloadSnapshot = {
  periodStart: '2026-08-03', periodEnd: '2026-08-09', scope,
  availableScopes: [scope],
  capabilities: { viewEmployeeNames: true, rebuild: true },
  summary: {
    knownPeople: 1, unknownPeople: 1, overallocatedPeople: 0,
    totalAvailableMinutes: 1_920, totalAllocatedMinutes: 1_200,
  },
  rows: [{
    userId: 'user-1', displayName: '\u0633\u0627\u0631\u0629 \u0623\u062d\u0645\u062f',
    status: 'unknown', scheduledMinutes: 2_400, absenceMinutes: 480,
    availableMinutes: 1_920, allocatedMinutes: 1_200, remainingMinutes: 720,
    utilizationPercent: null, assignmentCount: 2, unknownAssignmentCount: 1,
    overlapCount: 1, reasons: ['estimate_unknown', 'assignment_overlap'],
    calculatedAt: '2026-08-01T10:00:00.000Z',
  }],
}
function client(value = snapshot): WorkloadClient {
  return {
    load: vi.fn().mockResolvedValue(value),
    rebuild: vi.fn().mockResolvedValue(undefined),
  }
}
describe('workload UI', () => {
  it('renders an accessible RTL capacity view and labels unknown data', async () => {
    const view = render(<WorkloadScreen organizationId="org-1" client={client()} initialScope={scope} initialPeriodStart="2026-08-03" />)
    expect(await screen.findByRole('heading', { name: ar.title })).toBeTruthy()
    expect(screen.getByText(ar.unknownNote)).toBeTruthy()
    expect(screen.getByText('\u0633\u0627\u0631\u0629 \u0623\u062d\u0645\u062f')).toBeTruthy()
    expect((await axe(view.container)).violations).toEqual([])
  })
  it('rebuilds only through the trusted client with explicit scope and period', async () => {
    const api = client()
    render(<WorkloadScreen organizationId="org-1" client={api} initialScope={scope} initialPeriodStart="2026-08-03" />)
    await screen.findByRole('heading', { name: ar.title })
    fireEvent.click(screen.getByRole('button', { name: ar.rebuild }))
    await waitFor(() => expect(api.rebuild).toHaveBeenCalledWith(
      'org-1', scope, '2026-08-03', '2026-08-09',
    ))
  })
  it('redacts employee names when the projection capability denies them', async () => {
    render(<WorkloadScreen organizationId="org-1" client={client({
      ...snapshot, capabilities: { ...snapshot.capabilities, viewEmployeeNames: false },
    })} initialScope={scope} initialPeriodStart="2026-08-03" />)
    await screen.findByRole('heading', { name: ar.title })
    expect(screen.queryByText('\u0633\u0627\u0631\u0629 \u0623\u062d\u0645\u062f')).toBeNull()
    expect(screen.getByText('ID er-1')).toBeTruthy()
  })
})
