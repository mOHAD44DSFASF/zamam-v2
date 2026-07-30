// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach,describe,expect,it,vi } from 'vitest'
import { AutomationScreen } from '../apps/web/src/features/automations/AutomationPage'
import type { AutomationClient } from '../apps/web/src/features/automations/client'
afterEach(cleanup)
describe('automation UI',()=>{it('shows bounded policy and traceable runs in RTL',async()=>{const client:AutomationClient={load:vi.fn().mockResolvedValue({automations:[{id:'a1',name:'Reminder',status:'active',triggerType:'task.overdue',definitionVersion:1,actionCount:1,version:1}],runs:[{id:'run-1',automationId:'a1',status:'failed',attemptCount:3,startedAt:null,completedAt:null,errorCode:'RATE_LIMITED'}],capabilities:{create:true,manage:true,publish:true,cancel:true},limits:{maxActions:5,maxDepth:3,hourlyRuns:100}}),setStatus:vi.fn()};const view=render(<AutomationScreen organizationId="org-1" client={client}/>);expect(await screen.findByText('Reminder')).toBeTruthy();expect(screen.getByText('RATE_LIMITED')).toBeTruthy();expect(view.container.querySelector('main')?.getAttribute('dir')).toBe('rtl');expect((await axe(view.container)).violations).toEqual([])})})
