import { Bot, Check, LoaderCircle, Send, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '../../tenant/tenant-context'
import { aiClient, type AIClassification, type AIClient, type AIPurpose, type AISnapshot } from './client'

const t = {
  title: '\u0645\u0633\u0627\u0639\u062f ZAMAM',
  subtitle: '\u064a\u0646\u0634\u0626 \u0645\u0644\u062e\u0635\u0627\u062a \u0648\u0645\u0633\u0648\u062f\u0627\u062a \u0648\u0645\u0642\u062a\u0631\u062d\u0627\u062a \u062a\u062d\u062a\u0627\u062c \u0645\u0648\u0627\u0641\u0642\u0629 \u0628\u0634\u0631\u064a\u0629.',
  disabled: '\u0645\u0632\u0648\u062f AI \u063a\u064a\u0631 \u0645\u0647\u064a\u0623. \u0644\u0646 \u062a\u063a\u0627\u062f\u0631 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0646\u0638\u0627\u0645.',
  content: '\u0627\u0644\u0645\u062d\u062a\u0648\u0649',
  send: '\u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628',
  history: '\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0648\u0627\u0644\u0645\u0642\u062a\u0631\u062d\u0627\u062a',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0637\u0644\u0628\u0627\u062a AI.',
  approve: '\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u0642\u062a\u0631\u062d',
  reject: '\u0631\u0641\u0636 \u0627\u0644\u0645\u0642\u062a\u0631\u062d',
  error: '\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0645\u0633\u0627\u0639\u062f AI.',
  noTenant: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0639\u0636\u0648\u064a\u0629 \u0645\u0624\u0633\u0633\u0629 \u0646\u0634\u0637\u0629.',
}
export function AIAssistantScreen({ organizationId, client }: { organizationId: string; client: AIClient }) {
  const [snapshot, setSnapshot] = useState<AISnapshot | null>(null)
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading')
  const [content, setContent] = useState('')
  const [purpose, setPurpose] = useState<AIPurpose>('summarize')
  const [classification, setClassification] = useState<AIClassification>('internal')
  const load = useCallback(async()=>{setStatus('loading');try{setSnapshot(await client.load(organizationId));setStatus('ready')}catch{setStatus('error')}},[client,organizationId])
  useEffect(()=>{let active=true;client.load(organizationId).then(value=>{if(active){setSnapshot(value);setStatus('ready')}},()=>{if(active)setStatus('error')});return()=>{active=false}},[client,organizationId])
  if(status==='loading') return <main dir="rtl" className="grid min-h-screen place-items-center"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true"/> \u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644...</p></main>
  if(status==='error'||!snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center"><h1>{t.error}</h1></main>
  const submit=async()=>{await client.request(organizationId,{id:crypto.randomUUID(),purpose,content,classification});setContent('');await load()}
  const decide=async(proposalId:string,expectedVersion:number,decision:'approved'|'rejected',expectedHash:string)=>{await client.decide(organizationId,{proposalId,expectedVersion,decision,expectedHash});await load()}
  return <main dir="rtl" className="min-h-screen bg-gray-50 text-gray-950"><header className="border-b bg-white"><div className="mx-auto max-w-5xl px-5 py-6"><h1 className="flex items-center gap-2 text-2xl font-black"><Bot className="size-6 text-teal-800" aria-hidden="true"/>{t.title}</h1><p className="mt-1 text-sm text-gray-600">{t.subtitle}</p></div></header><div className="mx-auto max-w-5xl space-y-6 px-5 py-6">
    {(!snapshot.policy.enabled||snapshot.provider.mode==='disabled')&&<div role="alert" className="flex gap-3 border border-amber-300 bg-amber-50 p-4 text-amber-950"><ShieldAlert className="size-5 shrink-0" aria-hidden="true"/><p>{t.disabled}</p></div>}
    {snapshot.capabilities.request&&snapshot.policy.enabled&&snapshot.provider.mode!=='disabled'&&<section className="border bg-white p-5" aria-label={t.send}><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">\u0627\u0644\u063a\u0631\u0636<select value={purpose} onChange={e=>setPurpose(e.target.value as AIPurpose)} className="mt-1 w-full rounded-md border p-2"><option value="summarize">\u062a\u0644\u062e\u064a\u0635</option><option value="draft">\u0645\u0633\u0648\u062f\u0629</option><option value="suggest_actions">\u0627\u0642\u062a\u0631\u0627\u062d \u0625\u062c\u0631\u0627\u0621\u0627\u062a</option></select></label><label className="text-sm font-bold">\u0627\u0644\u062a\u0635\u0646\u064a\u0641<select value={classification} onChange={e=>setClassification(e.target.value as AIClassification)} className="mt-1 w-full rounded-md border p-2">{snapshot.policy.allowedClassifications.map(value=><option key={value} value={value}>{value}</option>)}</select></label></div><label className="mt-4 block text-sm font-bold">{t.content}<textarea value={content} onChange={e=>setContent(e.target.value)} maxLength={20000} rows={6} className="mt-1 w-full rounded-md border p-3" /></label><button disabled={!content.trim()} onClick={()=>void submit()} className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50"><Send className="size-4" aria-hidden="true"/>{t.send}</button></section>}
    <section aria-labelledby="ai-history"><h2 id="ai-history" className="text-lg font-black">{t.history}</h2><div className="mt-3 space-y-3">{snapshot.requests.map(request=><article key={request.id} className="border bg-white p-4"><div className="flex justify-between gap-3"><h3 className="font-black">{request.purpose}</h3><span className="text-xs text-gray-500">{request.status}</span></div>{request.summary&&<p className="mt-2 text-sm">{request.summary}</p>}<div className="mt-3 space-y-2">{request.proposals.map(proposal=><div key={proposal.id} className="border-r-4 border-r-amber-500 bg-amber-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{proposal.description}</p><span className="text-xs">{proposal.riskLevel}</span></div>{proposal.status==='proposed'&&snapshot.capabilities.approveProposal&&<div className="mt-2 flex gap-2"><button aria-label={`${t.approve}: ${proposal.description}`} onClick={()=>void decide(proposal.id,proposal.version,'approved',proposal.argumentsHash)} className="grid size-9 place-items-center rounded-md border bg-white"><Check className="size-4" aria-hidden="true"/></button><button aria-label={`${t.reject}: ${proposal.description}`} onClick={()=>void decide(proposal.id,proposal.version,'rejected',proposal.argumentsHash)} className="grid size-9 place-items-center rounded-md border bg-white"><X className="size-4" aria-hidden="true"/></button></div>}</div>)}</div></article>)}{snapshot.requests.length===0&&<div className="border bg-white p-10 text-center text-gray-500">{t.empty}</div>}</div></section>
  </div></main>
}
export function AIAssistantPage(){const{organizationId}=useTenant();if(!organizationId)return<main dir="rtl">{t.noTenant}</main>;return<AIAssistantScreen organizationId={organizationId} client={aiClient}/>}
