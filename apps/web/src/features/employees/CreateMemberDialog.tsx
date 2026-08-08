import { AlertTriangle, Check, Copy, KeyRound, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CreateMemberForm, CreateMemberResult } from './client'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

/**
 * Area 1's primary member-creation entry point — rendered as an inline modal from the Owner/Manager
 * dashboard (see app/DashboardPage.tsx). Two stages: the form, then a one-time password-reveal screen
 * (the backend never returns the plaintext password again after this response) with a copy button, matching
 * how bootstrap already displays the owner's one-time password.
 */

const fieldLabel = 'text-label font-semibold text-text-secondary'
const fieldInput = 'mt-2 w-full rounded-md border border-border-strong bg-canvas px-3 py-2.5 text-body text-text-primary placeholder:text-text-tertiary transition-colors focus:border-brand-400'

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
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => { firstInput.current?.focus() }, [])
  // On the one-time password screen, closing (Escape included) is blocked until the password is copied —
  // this is the admin's only chance to grab it, so an accidental dismiss must not be possible.
  const guardedClose = useCallback(() => { if (!created || copied) onClose() }, [created, copied, onClose])
  useEscapeToClose(guardedClose)

  if (created) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* The one-time password reveal — the single most consequential moment in this flow (the admin
            gets exactly one chance to copy this correctly), so it gets a distinct visual treatment from a
            routine "saved" confirmation: a dedicated icon, a warning banner, and a bordered password well
            instead of a plain success line. */}
        <div className="my-6 w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in" dir="rtl">
          <div className="grid size-12 place-items-center rounded-full bg-success-subtle">
            <KeyRound className="size-6 text-success" aria-hidden="true" />
          </div>
          <h2 id={titleId} className="mt-4 text-h2 font-extrabold text-text-primary">تم إنشاء العضو</h2>
          <p className="mt-2 text-body text-text-secondary">
            انسخ كلمة المرور المؤقتة وأرسلها للعضو بأمان. سيُطلب منه تعيين كلمة مرور جديدة عند أول تسجيل دخول.
          </p>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-subtle px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-label font-bold text-warning">لن تظهر كلمة المرور هذه مرة أخرى — انسخها الآن.</p>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-md border-2 border-brand-400 bg-canvas px-3 py-2.5" dir="ltr">
            {/* onCopy also satisfies the gate below — if the Clipboard API write fails (permission denied,
                insecure context, browser policy), the admin can still select the text and press Ctrl+C;
                the native browser copy event fires regardless of whether our JS-driven write succeeded. */}
            <code className="flex-1 select-all break-all text-body font-bold text-text-primary" onCopy={() => setCopied(true)}>{created.temporaryPassword}</code>
            <button
              type="button"
              aria-label="نسخ كلمة المرور"
              onClick={() => {
                void navigator.clipboard.writeText(created.temporaryPassword).then(() => setCopied(true), () => setCopyFailed(true))
              }}
              className={`grid size-9 shrink-0 cursor-pointer place-items-center rounded-md transition-all active:scale-95 ${copied ? 'bg-success-subtle text-success' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}`}
            >
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            </button>
          </div>
          {copied && (
            <p role="status" className="mt-2 flex items-center gap-1.5 text-caption font-bold text-success">
              <Check className="size-3.5" aria-hidden="true" /> تم النسخ.
            </p>
          )}
          {!copied && copyFailed && (
            <p role="alert" className="mt-2 text-caption font-semibold text-warning">تعذر النسخ التلقائي — حدد النص أعلاه يدويًا ثم اضغط Ctrl+C.</p>
          )}

          <div className="mt-6 flex flex-col items-end gap-2">
            {!copied && <p className="text-caption font-semibold text-text-tertiary">انسخ كلمة المرور أولًا لتفعيل هذا الزر.</p>}
            <button
              type="button" onClick={onClose} disabled={!copied}
              className="cursor-pointer rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
            >
              تم
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        dir="rtl"
        className="my-6 w-full max-w-2xl rounded-lg border border-border-subtle bg-surface-raised p-6 shadow-float animate-panel-in"
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
          <h2 id={titleId} className="text-h1 font-extrabold text-text-primary">إضافة عضو</h2>
          <button
            type="button" onClick={onClose} aria-label="إغلاق"
            className="grid size-9 cursor-pointer place-items-center rounded-md text-text-secondary transition-all hover:bg-surface-hover hover:text-text-primary active:scale-95"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-body text-text-secondary">يُنشأ الحساب فورًا بكلمة مرور مؤقتة تظهر لك مرة واحدة بعد الإرسال.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={fieldLabel}>الاسم الكامل<input ref={firstInput} name="displayName" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>الاسم الأول<input name="firstName" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>البريد الإلكتروني<input name="email" type="email" required dir="ltr" className={`${fieldInput} text-left`} /></label>
          <label className={fieldLabel}>رقم واتساب<input name="whatsappPhone" type="tel" required placeholder="+9665xxxxxxxx" dir="ltr" className={`${fieldInput} text-left`} /></label>
          <label className={fieldLabel}>رقم الموظف<input name="employeeNumber" required pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,31}" dir="ltr" className={`${fieldInput} text-left`} /></label>
          <label className={fieldLabel}>المسمى الوظيفي<input name="jobTitle" required minLength={2} className={fieldInput} /></label>
          <label className={fieldLabel}>نوع العلاقة<select name="employmentType" className={fieldInput}><option value="employee">موظف</option><option value="contractor">متعاون خارجي</option></select></label>
          <label className={fieldLabel}>القسم الأساسي<select name="primaryDepartmentId" required className={fieldInput}>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className={fieldLabel}>تاريخ البدء<input name="startDate" type="date" required className={fieldInput} /></label>
          <label className={fieldLabel}>الدور<select name="role" className={fieldInput}><option value="Employee">موظف</option><option value="DepartmentLead">قائد قسم (إنشاء مهام لقسمه فقط)</option><option value="Manager">مدير (إنشاء مهام في كل الأقسام)</option></select></label>
        </div>
        {error && <p role="alert" className="mt-4 text-body font-semibold text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button" onClick={onClose}
            className="cursor-pointer rounded-md border border-border-strong px-4 py-2 text-body font-semibold text-text-primary transition-all hover:bg-surface-hover active:scale-[0.98]"
          >
            إلغاء
          </button>
          <button
            type="submit" disabled={submitting || departments.length === 0}
            className="cursor-pointer rounded-md bg-brand-500 px-4 py-2 text-body font-bold text-text-primary transition-all hover:bg-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {submitting ? 'جارٍ الإنشاء...' : 'إنشاء العضو'}
          </button>
        </div>
      </form>
    </div>
  )
}
