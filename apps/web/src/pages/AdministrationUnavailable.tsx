import { LockKeyhole } from 'lucide-react'
import { Link } from 'react-router-dom'

export function AdministrationUnavailable() {
  return (
    <main dir="rtl" className="min-h-screen bg-gray-50 grid place-items-center p-6">
      <section className="max-w-md border border-gray-200 bg-white p-7 text-right shadow-sm">
        <LockKeyhole className="text-amber-700" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold">الإدارة محمية مؤقتاً</h1>
        <p className="mt-3 leading-7 text-gray-600">ستتاح هذه المساحة بعد تفعيل صلاحيات backend الموثوقة. لم تُستخدم أدوار الواجهة القديمة لمنح الوصول.</p>
        <Link to="/workspace" className="mt-6 inline-block font-semibold text-teal-800">العودة إلى مساحة العمل</Link>
      </section>
    </main>
  )
}
