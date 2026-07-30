import { createContext, useContext } from 'react'

export interface TenantContextValue {
  organizationId: string | null
  availableOrganizationIds: readonly string[]
  selectOrganization: (organizationId: string) => void
}

export const TenantContext = createContext<TenantContextValue | null>(null)

export function useTenant() {
  const value = useContext(TenantContext)
  if (!value) throw new Error('useTenant must be used within TenantProvider')
  return value
}

