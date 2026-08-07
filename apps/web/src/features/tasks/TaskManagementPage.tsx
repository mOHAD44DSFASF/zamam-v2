import { useSearchParams } from 'react-router-dom'
import { useTenant } from '../../tenant/tenant-context'
import { taskClient } from './client'
import { TaskManagementScreen, type TaskView } from './TasksListView'

export { TaskManagementScreen, type TaskView } from './TasksListView'
export { TaskEditor, type EditorInput } from './TaskEditor'
export { TaskDetails, StepPipeline, WhatsappReminderButton } from './TaskDetailPipeline'

export function TaskManagementPage() {
  const { organizationId } = useTenant()
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view')
  const view: TaskView = rawView === 'board' || rawView === 'calendar' || rawView === 'timeline' ? rawView : 'list'
  // Lets any other screen (the dashboards' task cards, the WhatsApp-transition prompt) deep-link straight
  // into a specific task's pipeline instead of dead-ending — see dashboard/shared.tsx's TaskRowCard.
  const initialTaskId = params.get('task') ?? undefined
  const openSendBackFor = params.get('sendback') === '1' ? initialTaskId : undefined
  if (!organizationId) return <main dir="rtl" className="grid min-h-screen place-items-center text-text-secondary">لا توجد عضوية مؤسسة نشطة.</main>
  return <TaskManagementScreen
    organizationId={organizationId} client={taskClient} view={view}
    initialTaskId={initialTaskId} openSendBackFor={openSendBackFor}
    onViewChange={(next) => {
      const updated = new URLSearchParams(params)
      updated.set('view', next)
      setParams(updated, { replace: true })
    }}
  />
}
