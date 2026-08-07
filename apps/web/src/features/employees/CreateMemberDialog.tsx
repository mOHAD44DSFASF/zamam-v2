import { Check, Copy, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { CreateMemberForm, CreateMemberResult } from './client'

/**
 * Area 1's primary member-creation entry point — rendered as an inline modal from the Owner/Manager
 * dashboard (see app/DashboardPage.tsx). Two stages: the form, then a one-time password-reveal screen
 * (the backend never returns the plaintext password again after this response) with a copy button, matching
 * how bootstrap already displays the owner's one-time password.
 */
export function CreateMemberDialog({
  departments,
  onClose,
  onSubmit,
}: {
  departments: readonly { id: string; name: string }[]
  onClose: () => void
  onSubmit: (input: CreateMemberForm) => Promise<CreateMemberResult>
}) {
  const titleId = useId()
  const firstInput = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreateMemberResult | null>(null)
  const [copied, setCopied] = useState(false)

  if (created) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="my-6 w-full max-w-md rounded-lg bg-white p-6 shadow-xl" dir="rtl">
          <h2 id={titleId} className="text-lg font-black">تم إنشاء العضو</h2>
          <p className="mt-2 text-sm text-gray-600">
            انسخ كلمة المرور المؤقتة وأرسلها للعضو بأمان — لن تظهر مرة أخرى. سيُطلب منه تعيين كلمة مرور جديدة عند أول تسجيل دخول.
          </p>
          <div className="mt-4 flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2.5" dir="ltr">
            <code className="flex-1 select-all break-all text-sm font-bold">{created.temporaryPassword}</code>
            <button
              type="button"
              aria-label="نسخ كلمة المرور"
              onClick={() => { void navigator.clipboard.writeText(created.temporaryPassword).then(() => setCopied(true)) }}
              className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-gray-200"
            >
              {copied ? <Check className="size-4 text-green-700" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            </button>
          </div>
          {copied && <p role="status" className="mt-2 text-xs font-bold text-green-700">تم النسخ.</p>}
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white">تم</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        dir="rtl"
        className="my-6 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          setSubmitting(true)
          setError('')
          try {
            const result = await onSubmit({
              email: String(data.get('email')),
              displayName: String(data.get('displayName')),
              firstName: String(data.get('firstName')),
              employeeNumber: String(data.get('employeeNumber')),
              employmentType: data.get('employmentType') === 'contractor' ? 'contractor' : 'employee',
              primaryDepartmentId: String(data.get('primaryDepartmentId')),
              jobTitle: String(data.get('jobTitle')),
              startDate: String(data.get('startDate')),
              locale: 'ar',
              timezone: 'Africa/Cairo',
              whatsappPhone: String(data.get('whatsappPhone')),
              role: (data.get('role') === 'DepartmentLead' || data.get('role') === 'Manager') ? data.get('role') as 'DepartmentLead' | 'Manager' : 'Employee',
            })
            setCreated(result)
          } catch {
            setError('تعذر إنشاء العضو. تحقق من البيانات وحاول مرة أخرى.')
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-black">إضافة عضو</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 place-items-center rounded-md hover:bg-gray-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <p className="mt-2 text-sm text-gray-600">يُنشأ الحساب فورًا بكلمة مرور مؤقتة تظهر لك مرة واحدة بعد الإرسال.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">الاسم الكامل<input ref={firstInput} name="displayName" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">الاسم الأول<input name="firstName" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">البريد الإلكتروني<input name="email" type="email" required dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
          <label className="text-sm font-semibold">رقم واتساب<input name="whatsappPhone" type="tel" required placeholder="+9665xxxxxxxx" dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
          <label className="text-sm font-semibold">رقم الموظف<input name="employeeNumber" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}" dir="ltr" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-left" /></label>
          <label className="text-sm font-semibold">المسمى الوظيفي<input name="jobTitle" required minLength={2} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">نوع العلاقة<select name="employmentType" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"><option value="employee">موظف</option><option value="contractor">متعاون خارجي</option></select></label>
          <label className="text-sm font-semibold">القسم الأساسي<select name="primaryDepartmentId" required className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2">{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="text-sm font-semibold">تاريخ البدء<input name="startDate" type="date" required className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-semibold">الدور<select name="role" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"><option value="Employee">موظف</option><option value="DepartmentLead">قائد قسم (إنشاء مهام لقسمه فقط)</option><option value="Manager">مدير (إنشاء مهام في كل الأقسام)</option></select></label>
        </div>
        {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 font-semibold">إلغاء</button>
          <button type="submit" disabled={submitting || departments.length === 0} className="rounded-md bg-teal-800 px-4 py-2 font-bold text-white disabled:opacity-50">{submitting ? 'جارٍ الإنشاء...' : 'إنشاء العضو'}</button>
        </div>
      </form>
    </div>
  )
}
