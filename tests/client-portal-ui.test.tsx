// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'jest-axe'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { PortalDashboardScreen,PortalProjectScreen } from '../apps/web/src/features/portal/ClientPortalPage'
import type { PortalClient } from '../apps/web/src/features/portal/client'
afterEach(cleanup)
const api:PortalClient={dashboard:vi.fn().mockResolvedValue({clientId:'client-1',projects:[{id:'project-1',name:'Project One',code:'P1',status:'active',startsOn:null,dueOn:null}],pendingApprovals:[],deliveries:[]}),project:vi.fn().mockResolvedValue({project:{id:'project-1',name:'Project One',code:'P1',status:'active',startsOn:null,dueOn:null},tasks:[{id:'task-1',title:'Visible task',status:'active',dueAt:null}],comments:[{id:'c1',body:'Client comment',createdAt:null}],files:[{id:'f1',displayName:'Delivery.pdf',latestVersionNumber:1}]}),createRequest:vi.fn(),decideApproval:vi.fn(),requestDownload:vi.fn()}
describe('client portal UI',()=>{
  it('renders an accessible mobile-safe RTL dashboard',async()=>{const view=render(<MemoryRouter><PortalDashboardScreen organizationId="org-1" slug="zamam" client={api}/></MemoryRouter>);expect(await screen.findByRole('heading',{name:'\u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0639\u0645\u064a\u0644'})).toBeTruthy();expect(view.container.querySelector('main')?.getAttribute('dir')).toBe('rtl');expect((await axe(view.container)).violations).toEqual([])})
  it('shows only server-projected project fields and signed-download command',async()=>{const view=render(<PortalProjectScreen organizationId="org-1" projectId="project-1" client={api}/>);expect(await screen.findByText('Visible task')).toBeTruthy();expect(screen.getByRole('button',{name:/Delivery.pdf/})).toBeTruthy();expect(view.container.textContent).not.toContain('internal');expect((await axe(view.container)).violations).toEqual([])})
})
