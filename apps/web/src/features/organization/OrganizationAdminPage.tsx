import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Building2, Plus, RefreshCw, UsersRound, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import {
  organizationDirectoryClient,
  type OrganizationDirectoryClient,
  type OrganizationDirectorySnapshot,
} from './client'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

const fieldLabel = 'block text-label font-semibold text-text-secondary'
const fieldInput = 'mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2.5 text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400'

type CreateMode = 'department' | 'team' | null

function CreateDialog({
  mode,
  snapshot,
  onClose,
  onSubmit,
}: {
  mode: Exclude<CreateMode, null>
  snapshot: OrganizationDirectorySnapshot
  onClose: () => void
  onSubmit: (input: { name: string; code: string; departmentId?: string }) => Promise<void>
}) {
  const headingId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [departmentId, setDepartmentId] = useState(snapshot.departments[0]?.id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => nameRef.current?.focus(), [])
  useEscapeToClose(onClose)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <form
        dir="rtl"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in"
        onSubmit={async (event) => {
          event.preventDefault()
          setSubmitting(true)
          setError('')
          try {
            await onSubmit({ name, code, ...(mode === 'team' ? { departmentId } : {}) })
            onClose()
          } catch {
            setError('تعذر حفظ البيانات. راجع القيم أو أعد المحاولة.')
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={headingId} className="text-h1 font-extrabold text-text-primary">{mode === 'department' ? 'إضافة قسم' : 'إضافة فريق'}</h2>
          <button type="button" onClick={onClose} className="grid size-9 cursor-pointer place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary" aria-label="إغلاق">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {mode === 'team' && (
            <label className={fieldLabel}>
              القسم
              <select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={`${fieldInput} cursor-pointer`}>
                {snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
          )}
          <label className={fieldLabel}>
            الاسم
            <input ref={nameRef} required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className={fieldInput} />
          </label>
          <label className={fieldLabel}>
            الرمز
            <input required dir="ltr" pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,31}" value={code} onChange={(event) => setCode(event.target.value)} className={`${fieldInput} text-left`} />
          </label>
        </div>
        {error && <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-label font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-strong px-4 py-2 font-semibold text-text-primary transition-colors hover:bg-surface-hover">إلغاء</button>
          <button type="submit" disabled={submitting || (mode === 'team' && !departmentId)} className="cursor-pointer rounded-md bg-brand-500 px-4 py-2 font-semibold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function OrganizationDirectoryScreen({
  organizationId,
  client,
  hideHeader = false,
}: {
  organizationId: string
  client: OrganizationDirectoryClient
  hideHeader?: boolean
}) {
  const [snapshot, setSnapshot] = useState<OrganizationDirectorySnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [mode, setMode] = useState<CreateMode>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setSnapshot(await client.load(organizationId))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [client, organizationId])

  useEffect(() => {
    let active = true
    client.load(organizationId).then(
      (value) => {
        if (!active) return
        setSnapshot(value)
        setStatus('ready')
      },
      () => {
        if (active) setStatus('error')
      },
    )
    return () => { active = false }
  }, [client, organizationId])

  if (status === 'loading') {
    return <main dir="rtl" className="min-h-screen bg-canvas">
      <p role="status" className="sr-only">جارٍ تحميل الهيكل التنظيمي...</p>
      <div className="animate-pulse" aria-hidden="true">
        <header className="border-b border-border-subtle bg-surface"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
          <div><div className="h-4 w-16 rounded-sm bg-surface-hover" /><div className="mt-2 h-8 w-48 rounded-md bg-surface-hover" /></div>
          <div className="flex gap-2"><div className="h-10 w-28 rounded-md bg-surface-hover" /><div className="h-10 w-28 rounded-md bg-surface-hover" /></div>
        </div></header>
        <div className="mx-auto max-w-6xl px-5 py-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 rounded-md border border-border-subtle bg-surface" />)}</div>
        </div>
      </div>
    </main>
  }
  if (status === 'error' || !snapshot) {
    return (
      <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas p-6">
        <section className="max-w-lg text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-danger-subtle"><AlertTriangle className="size-7 text-danger" aria-hidden="true" /></div>
          <h1 className="mt-4 text-h1 font-extrabold text-text-primary">تعذر تحميل الإدارة</h1>
          <p className="mt-2 text-body text-text-secondary">الخدمة الموثوقة غير متاحة أو لا تملك صلاحية عرض الهيكل التنظيمي.</p>
          <button type="button" onClick={() => void load()} className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-semibold text-text-primary transition-colors hover:bg-surface-hover">
            <RefreshCw className="size-4" aria-hidden="true" /> إعادة المحاولة
          </button>
        </section>
      </main>
    )
  }

  const teamsByDepartment = new Map(snapshot.departments.map((department) => [
    department.id,
    snapshot.teams.filter((team) => team.departmentId === department.id),
  ]))

  return (
    <main dir="rtl" className="min-h-screen bg-canvas">
      {hideHeader
        ? <div className="mx-auto flex max-w-7xl flex-wrap justify-end gap-2 px-5 pt-6">
            {snapshot.capabilities.createDepartment && (
              <button type="button" onClick={() => setMode('department')} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98]">
                <Plus className="size-4" aria-hidden="true" /> قسم
              </button>
            )}
            {snapshot.capabilities.createTeam && (
              <button type="button" onClick={() => setMode('team')} disabled={snapshot.departments.length === 0} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="size-4" aria-hidden="true" /> فريق
              </button>
            )}
          </div>
        : <header className="border-b border-border-subtle bg-surface">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6">
              <div>
                <p className="text-label font-semibold text-brand-300">الإدارة</p>
                <h1 className="mt-1 text-display font-extrabold text-text-primary">{snapshot.organization.name}</h1>
                <p className="mt-1 text-body text-text-secondary">{snapshot.organization.timezone}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {snapshot.capabilities.createDepartment && (
                  <button type="button" onClick={() => setMode('department')} className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98]">
                    <Plus className="size-4" aria-hidden="true" /> قسم
                  </button>
                )}
                {snapshot.capabilities.createTeam && (
                  <button type="button" onClick={() => setMode('team')} disabled={snapshot.departments.length === 0} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-4 py-2 font-bold text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
                    <Plus className="size-4" aria-hidden="true" /> فريق
                  </button>
                )}
              </div>
            </div>
          </header>}

      <div className="mx-auto max-w-7xl px-5 py-7">
        <div className="grid grid-cols-2 gap-4 border-b border-border-subtle pb-6 sm:max-w-md">
          <div><p className="text-label text-text-secondary">الأقسام</p><p className="mt-1 text-display font-extrabold text-text-primary">{snapshot.departments.length}</p></div>
          <div><p className="text-label text-text-secondary">الفرق</p><p className="mt-1 text-display font-extrabold text-text-primary">{snapshot.teams.length}</p></div>
        </div>

        {snapshot.departments.length === 0 ? (
          <section className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="grid size-14 place-items-center rounded-full bg-surface-hover"><Building2 className="size-7 text-text-tertiary" aria-hidden="true" /></div>
            <h2 className="text-h2 font-bold text-text-primary">لا توجد أقسام بعد</h2>
            <p className="max-w-sm text-body text-text-secondary">يظهر الهيكل هنا بعد إنشاء أول قسم من مستخدم مخول.</p>
            {snapshot.capabilities.createDepartment && <button type="button" onClick={() => setMode('department')} className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98]"><Plus className="size-4" aria-hidden="true" /> إنشاء أول قسم</button>}
          </section>
        ) : (
          <div className="mt-7 space-y-7">
            {snapshot.departments.map((department) => (
              <section key={department.id} aria-labelledby={`department-${department.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-subtle text-brand-300"><Building2 className="size-5" aria-hidden="true" /></span>
                    <div>
                      <h2 id={`department-${department.id}`} className="font-extrabold text-text-primary">{department.name}</h2>
                      <p className="text-label text-text-secondary"><span dir="ltr">{department.code}</span> · {department.managerName ?? 'لا يوجد مدير معين'}</p>
                    </div>
                  </div>
                  <span className="text-label font-semibold text-text-secondary">{department.activeTeamCount} فريق</span>
                </div>
                <div className="divide-y divide-border-subtle rounded-md border border-t-0 border-border-subtle bg-surface">
                  {(teamsByDepartment.get(department.id) ?? []).map((team) => (
                    <div key={team.id} className="grid gap-3 px-4 py-4 transition-colors hover:bg-surface-hover sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div className="flex items-center gap-3">
                        <UsersRound className="size-5 shrink-0 text-text-tertiary" aria-hidden="true" />
                        <div><p className="font-bold text-text-primary">{team.name}</p><p dir="ltr" className="text-left text-caption text-text-tertiary">{team.code}</p></div>
                      </div>
                      <p className="text-body text-text-secondary">{team.leaderName ?? 'دون قائد'}</p>
                      <p className="text-body font-semibold text-text-primary">{team.activeMemberCount} عضو</p>
                    </div>
                  ))}
                  {(teamsByDepartment.get(department.id) ?? []).length === 0 && <p className="px-4 py-5 text-body text-text-secondary">لا توجد فرق نشطة في هذا القسم.</p>}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {mode && (
        <CreateDialog
          mode={mode}
          snapshot={snapshot}
          onClose={() => setMode(null)}
          onSubmit={async (input) => {
            if (mode === 'department') await client.createDepartment(organizationId, { name: input.name, code: input.code })
            else await client.createTeam(organizationId, { departmentId: input.departmentId ?? '', name: input.name, code: input.code })
            await load()
          }}
        />
      )}
    </main>
  )
}

export function OrganizationAdminPage() {
  useAuth()
  const { organizationId } = useTenant()
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center bg-canvas text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  return <OrganizationDirectoryScreen organizationId={organizationId} client={organizationDirectoryClient} />
}
