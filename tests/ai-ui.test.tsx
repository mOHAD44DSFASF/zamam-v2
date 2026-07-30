// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIAssistantScreen } from '../apps/web/src/features/ai/AIAssistantPage'
import type { AIClient, AISnapshot } from '../apps/web/src/features/ai/client'
afterEach(cleanup)
const snapshot: AISnapshot={provider:{configured:false,mode:'disabled',name:'disabled'},policy:{enabled:true,proposalOnly:true,retentionHours:72,allowedClassifications:['internal']},capabilities:{request:true,approveProposal:true,viewHistory:true},requests:[]}
const client:AIClient={load:vi.fn().mockResolvedValue(snapshot),request:vi.fn(),decide:vi.fn()}
describe('AI assistant UI',()=>{
  it('fails visibly closed when no provider is configured',async()=>{const view=render(<AIAssistantScreen organizationId="org-1" client={client}/>);expect((await screen.findByRole('alert')).textContent).toContain('\u063a\u064a\u0631 \u0645\u0647\u064a\u0623');expect(screen.queryByRole('button',{name:'\u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628'})).toBeNull();expect((await axe(view.container)).violations).toEqual([])})
  it('never exposes an execute control for proposals',async()=>{const value={...snapshot,provider:{configured:true,mode:'demo' as const,name:'mock'},requests:[{id:'r1',purpose:'suggest_actions' as const,status:'completed' as const,summary:'summary',createdAt:'2026-07-30T00:00:00Z',proposals:[{id:'p1',actionType:'task.add_tag',description:'proposal',riskLevel:'low' as const,status:'proposed' as const,argumentsHash:'a'.repeat(64),version:1}]}]};render(<AIAssistantScreen organizationId="org-1" client={{...client,load:vi.fn().mockResolvedValue(value)}}/>);expect(await screen.findByText('proposal')).toBeTruthy();expect(screen.queryByRole('button',{name:/execute/i})).toBeNull()})
})
