import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Building2, LoaderCircle, Plus, RefreshCw, UsersRound, X } from 'lucide-react'
import { useAuth } from '../../auth/auth-context'
import { useTenant } from '../../tenant/tenant-context'
import {
  organizationDirectoryClient,
  type OrganizationDirectoryClient,
  type OrganizationDirectorySnapshot,
} from './client'

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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <form
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
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
          <h2 id={headingId} className="text-lg font-bold">{mode === 'department' ? 'إضافة قسم' : 'إضافة فريق'}</h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-md hover:bg-gray-100" aria-label="إغلاق">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {mode === 'team' && (
            <label className="block text-sm font-semibold">
              القسم
              <select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2">
                {snapshot.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-semibold">
            الاسم
            <input ref={nameRef} required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>
          <label className="block text-sm font-semibold">
            الرمز
            <input required dir="ltr" pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" />
          </label>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 font-semibold">إلغاء</button>
          <button type="submit" disabled={submitting || (mode === 'team' && !departmentId)} className="rounded-md bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50">
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
}: {
  organizationId: string
  client: OrganizationDirectoryClient
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
    return <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50"><p role="status" className="flex items-center gap-3"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> جارٍ تحميل الهيكل التنظيمي...</p></main>
  }
  if (status === 'error' || !snapshot) {
    return (
      <main dir="rtl" className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <section className="max-w-lg text-center">
          <AlertTriangle className="mx-auto size-8 text-amber-700" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold">تعذر تحميل الإدارة</h1>
          <p className="mt-2 text-gray-600">الخدمة الموثوقة غير متاحة أو لا تملك صلاحية عرض الهيكل التنظيمي.</p>
          <button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold">
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
    <main dir="rtl" className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6">
          <div>
            <p className="text-sm font-semibold text-teal-800">الإدارة</p>
            <h1 className="mt-1 text-2xl font-black">{snapshot.organization.name}</h1>
            <p className="mt-1 text-sm text-gray-500">{snapshot.organization.timezone}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {snapshot.capabilities.createDepartment && (
              <button type="button" onClick={() => setMode('department')} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 font-bold text-white">
                <Plus className="size-4" aria-hidden="true" /> قسم
              </button>
            )}
            {snapshot.capabilities.createTeam && (
              <button type="button" onClick={() => setMode('team')} disabled={snapshot.departments.length === 0} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 font-bold disabled:opacity-50">
                <Plus className="size-4" aria-hidden="true" /> فريق
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-7">
        <div className="grid grid-cols-2 gap-4 border-b border-gray-200 pb-6 sm:max-w-md">
          <div><p className="text-sm text-gray-500">الأقسام</p><p className="mt-1 text-2xl font-black">{snapshot.departments.length}</p></div>
          <div><p className="text-sm text-gray-500">الفرق</p><p className="mt-1 text-2xl font-black">{snapshot.teams.length}</p></div>
        </div>

        {snapshot.departments.length === 0 ? (
          <section className="py-20 text-center">
            <Building2 className="mx-auto size-10 text-gray-400" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-bold">لا توجد أقسام بعد</h2>
            <p className="mt-2 text-gray-500">يظهر الهيكل هنا بعد إنشاء أول قسم من مستخدم مخول.</p>
          </section>
        ) : (
          <div className="mt-7 space-y-7">
            {snapshot.departments.map((department) => (
              <section key={department.id} aria-labelledby={`department-${department.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-md bg-teal-50 text-teal-800"><Building2 className="size-5" aria-hidden="true" /></span>
                    <div>
                      <h2 id={`department-${department.id}`} className="font-black">{department.name}</h2>
                      <p className="text-sm text-gray-500"><span dir="ltr">{department.code}</span> · {department.managerName ?? 'لا يوجد مدير معين'}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-gray-600">{department.activeTeamCount} فريق</span>
                </div>
                <div className="divide-y divide-gray-100 bg-white">
                  {(teamsByDepartment.get(department.id) ?? []).map((team) => (
                    <div key={team.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div className="flex items-center gap-3">
                        <UsersRound className="size-5 text-gray-500" aria-hidden="true" />
                        <div><p className="font-bold">{team.name}</p><p dir="ltr" className="text-left text-xs text-gray-500">{team.code}</p></div>
                      </div>
                      <p className="text-sm text-gray-600">{team.leaderName ?? 'دون قائد'}</p>
                      <p className="text-sm font-semibold">{team.activeMemberCount} عضو</p>
                    </div>
                  ))}
                  {(teamsByDepartment.get(department.id) ?? []).length === 0 && <p className="px-4 py-5 text-sm text-gray-500">لا توجد فرق نشطة في هذا القسم.</p>}
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
  if (!organizationId) return <main dir="rtl" className="min-h-screen grid place-items-center">لا توجد عضوية مؤسسة نشطة.</main>
  return <OrganizationDirectoryScreen organizationId={organizationId} client={organizationDirectoryClient} />
}
