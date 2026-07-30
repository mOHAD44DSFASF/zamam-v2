export interface LegacyUploadResult {
  success: boolean
  url?: string
  errorCode?: 'NOT_CONFIGURED'
}

export async function uploadFile(file: File, taskId: string): Promise<LegacyUploadResult> {
  void file
  void taskId
  return { success: false, errorCode: 'NOT_CONFIGURED' }
}

export const R2Service = { uploadFile }
