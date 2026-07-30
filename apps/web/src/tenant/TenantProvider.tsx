import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../auth/auth-context'
import { TenantContext } from './tenant-context'

const storageKey = 'zamam.selectedOrganizationId'

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const availableOrganizationIds = useMemo(
    () => session?.memberships.filter(({ status }) => status === 'active').map(({ organizationId }) => organizationId) ?? [],
    [session],
  )
  const [requested, setRequested] = useState(() => {
    try { return window.sessionStorage.getItem(storageKey) } catch { return null }
  })
  const organizationId = requested && availableOrganizationIds.includes(requested)
    ? requested
    : availableOrganizationIds[0] ?? null

  const selectOrganization = useCallback((next: string) => {
    if (!availableOrganizationIds.includes(next)) throw new Error('CROSS_ORGANIZATION_DENIED')
    window.sessionStorage.setItem(storageKey, next)
    setRequested(next)
  }, [availableOrganizationIds])

  const value = useMemo(
    () => ({ organizationId, availableOrganizationIds, selectOrganization }),
    [organizationId, availableOrganizationIds, selectOrganization],
  )
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

