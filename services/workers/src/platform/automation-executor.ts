import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AutomationActionExecutor } from '../automation-run.js'

const id = /^[A-Za-z0-9_-]{2,128}$/
const tenantPath = (organizationId: string, kind: string, docId: string) => `v2Organizations/${organizationId}/${kind}/${docId}`
const deterministicId = (...parts: string[]) => createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40)

/**
 * Executes the three allowlisted low-risk automation actions (AUTOMATION_ACTION_CATALOG in
 * packages/domain). Each write is idempotent on the action's idempotencyKey so a redelivered
 * automation run does not duplicate the effect. `task.add_tag` uses a plain string array on the task
 * document — packages/domain's Task entity has no dedicated tag-join collection yet (a schema gap, not
 * something to invent a full tagging feature for here).
 */
export function createFirestoreAutomationActionExecutor(firestore: Firestore): AutomationActionExecutor {
  return {
    async execute(input) {
      if (input.action.type === 'notification.create') {
        const recipientUserId = input.action.arguments.recipientUserId
        const titleKey = input.action.arguments.titleKey
        if (!recipientUserId || !id.test(recipientUserId) || !titleKey) throw new Error('AUTOMATION_ACTION_ARGUMENTS_INVALID')
        const notificationId = `automation-${deterministicId(input.idempotencyKey)}`
        const path = tenantPath(input.organizationId, 'notification', notificationId)
        await firestore.doc(path).set({
          organizationId: input.organizationId, schemaVersion: 1, version: 1,
          recipientUserId, eventType: 'automation.triggered', dedupeKey: input.idempotencyKey,
          titleKey, status: 'unread', deliveryState: 'in_app_only', inAppVisible: true,
          locale: 'ar', visibility: 'internal',
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        return { resourceType: 'notification', resourceId: notificationId }
      }
      if (input.action.type === 'task.add_watcher') {
        const taskId = input.action.arguments.taskId
        const userId = input.action.arguments.userId
        if (!taskId || !id.test(taskId) || !userId || !id.test(userId)) throw new Error('AUTOMATION_ACTION_ARGUMENTS_INVALID')
        const watcherId = deterministicId(taskId, userId)
        const path = tenantPath(input.organizationId, 'task_watcher', watcherId)
        await firestore.doc(path).set({
          organizationId: input.organizationId, schemaVersion: 1, version: 1,
          taskId, userId, source: 'automation', status: 'active',
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        return { resourceType: 'task_watcher', resourceId: watcherId }
      }
      const taskId = input.action.arguments.taskId
      const tag = input.action.arguments.tag
      if (!taskId || !id.test(taskId) || !tag || tag.length > 40) throw new Error('AUTOMATION_ACTION_ARGUMENTS_INVALID')
      const taskPath = tenantPath(input.organizationId, 'task', taskId)
      const snapshot = await firestore.doc(taskPath).get()
      if (!snapshot.exists || snapshot.data()?.organizationId !== input.organizationId) throw new Error('ENTITY_NOT_FOUND')
      await firestore.doc(taskPath).update({ tags: FieldValue.arrayUnion(tag), updatedAt: FieldValue.serverTimestamp() })
      return { resourceType: 'task', resourceId: taskId }
    },
  }
}
