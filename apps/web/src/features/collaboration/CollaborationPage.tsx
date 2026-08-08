import { Bell, BellOff, LoaderCircle, MessageSquare, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import {
  collaborationClient,
  type CollaborationClient,
  type CollaborationSnapshot,
} from './client'

const reactionLabels = {
  like: 'إعجاب',
  celebrate: 'احتفاء',
  support: 'دعم',
  insightful: 'مفيد',
} as const

export function CollaborationScreen({
  organizationId,
  resourceType,
  resourceId,
  client,
}: {
  organizationId: string
  resourceType: 'task' | 'project'
  resourceId: string
  client: CollaborationClient
}) {
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [body, setBody] = useState('')
  const [commentVisibility, setCommentVisibility] = useState<'internal' | 'client'>('internal')
  const [mentions, setMentions] = useState<readonly string[]>([])
  const load = useCallback(async () => {
    setStatus('loading')
    try { setSnapshot(await client.load(organizationId, resourceType, resourceId)); setStatus('ready') }
    catch { setStatus('error') }
  }, [client, organizationId, resourceId, resourceType])
  useEffect(() => {
    let active = true
    client.load(organizationId, resourceType, resourceId).then(
      (value) => {
        if (!active) return
        setSnapshot(value)
        setCommentVisibility(value.capabilities.createInternal ? 'internal' : 'client')
        setStatus('ready')
      },
      () => { if (active) setStatus('error') },
    )
    return () => { active = false }
  }, [client, organizationId, resourceId, resourceType])
  if (status === 'loading') return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary"><p role="status"><LoaderCircle className="inline size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل المحادثة...</p></main>
  if (status === 'error' || !snapshot) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas"><h1 className="text-text-primary">تعذر تحميل التعاون</h1></main>
  const canCreate = commentVisibility === 'internal'
    ? snapshot.capabilities.createInternal
    : snapshot.capabilities.createClient
  const submit = async () => {
    if (!body.trim() || !canCreate) return
    await client.create(organizationId, {
      resourceType, resourceId, body: body.trim(), visibility: commentVisibility,
      mentionedUserIds: mentions,
    })
    setBody(''); setMentions([]); await load()
  }
  return <main dir="rtl" className="min-h-screen bg-canvas text-text-primary">
    <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-6"><div><p className="text-sm font-bold text-brand-300">التعاون</p><h1 className="text-2xl font-black">{snapshot.resource.title}</h1></div>{resourceType === 'task' && snapshot.capabilities.watch && <button onClick={() => void client.setWatch(organizationId, resourceId, !snapshot.watched).then(load)} className="inline-flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 font-bold hover:bg-surface-hover">{snapshot.watched ? <BellOff className="size-4" aria-hidden="true" /> : <Bell className="size-4" aria-hidden="true" />}{snapshot.watched ? 'إلغاء المتابعة' : 'متابعة'}</button>}</div></header>
    <div className="mx-auto max-w-4xl px-5 py-6">
      <section aria-labelledby="comments-heading" className="space-y-3"><h2 id="comments-heading" className="text-lg font-black">التعليقات</h2>{snapshot.comments.map((comment) => <article key={comment.id} className="border border-border-subtle bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{comment.authorName}</h3><p className="mt-1 text-xs text-text-tertiary">{comment.createdAt}{comment.editedAt ? ' · معدّل' : ''} · {comment.visibility === 'internal' ? 'داخلي' : 'ظاهر للعميل'}{comment.locked ? ' · مقفل كدليل' : ''}</p></div>{comment.mine && snapshot.capabilities.deleteOwn && !comment.locked && <button aria-label={`حذف تعليق ${comment.authorName}`} title="حذف التعليق" onClick={() => void client.tombstone(organizationId, comment.id, comment.version).then(load)} className="grid size-9 place-items-center rounded-md border border-border-strong text-danger hover:bg-danger-subtle"><Trash2 className="size-4" aria-hidden="true" /></button>}</div>
        <p className="mt-4 whitespace-pre-wrap">{comment.body}</p>
        {comment.mentions.length > 0 && <p className="mt-3 text-xs text-brand-300">إشارة إلى: {comment.mentions.map(({ displayName }) => displayName).join('، ')}</p>}
        {snapshot.capabilities.react && <div aria-label={`تفاعلات تعليق ${comment.authorName}`} className="mt-4 flex flex-wrap gap-2">{comment.reactions.map((reaction) => <button key={reaction.type} aria-pressed={reaction.selected} onClick={() => void client.setReaction(organizationId, comment.id, reaction.type, !reaction.selected).then(load)} className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover aria-pressed:bg-brand-subtle">{reactionLabels[reaction.type]} {reaction.count}</button>)}</div>}
      </article>)}{snapshot.comments.length === 0 && <div className="border border-border-subtle bg-surface p-10 text-center text-text-tertiary"><MessageSquare className="mx-auto mb-3 size-7" aria-hidden="true" />لا توجد تعليقات بعد.</div>}</section>
      {(snapshot.capabilities.createInternal || snapshot.capabilities.createClient) && <form onSubmit={(event) => { event.preventDefault(); void submit() }} className="mt-6 border border-border-subtle bg-surface p-5"><h2 className="font-black">إضافة تعليق</h2>{snapshot.capabilities.createInternal && snapshot.capabilities.createClient && <fieldset className="mt-4"><legend className="text-sm font-bold">القناة</legend><div className="mt-2 flex gap-4"><label><input type="radio" name="visibility" value="internal" checked={commentVisibility === 'internal'} onChange={() => setCommentVisibility('internal')} /> داخلي</label><label><input type="radio" name="visibility" value="client" checked={commentVisibility === 'client'} onChange={() => setCommentVisibility('client')} /> ظاهر للعميل</label></div></fieldset>}<label className="mt-4 block text-sm font-bold">التعليق<textarea required maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} className="mt-2 min-h-28 w-full rounded-md border border-border-strong bg-canvas p-3 text-text-primary" /></label>{snapshot.mentionCandidates.length > 0 && <fieldset className="mt-4"><legend className="text-sm font-bold">الإشارات</legend><div className="mt-2 flex flex-wrap gap-3">{snapshot.mentionCandidates.map((candidate) => <label key={candidate.userId} className="text-sm"><input type="checkbox" checked={mentions.includes(candidate.userId)} onChange={(event) => setMentions(event.target.checked ? [...mentions, candidate.userId] : mentions.filter((id) => id !== candidate.userId))} /> {candidate.displayName}</label>)}</div></fieldset>}<button disabled={!canCreate} type="submit" className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary hover:bg-brand-400 disabled:opacity-50"><Send className="size-4" aria-hidden="true" /> إرسال</button></form>}
    </div>
  </main>
}

export function CollaborationPage() {
  const { organizationId } = useTenant()
  const { taskId = '' } = useParams()
  if (!organizationId || !taskId) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary">نطاق التعاون غير صالح.</main>
  return <CollaborationScreen organizationId={organizationId} resourceType="task" resourceId={taskId} client={collaborationClient} />
}
