export interface LegacyDriveFolderResult {
  success: boolean
  folderId?: string
  folderUrl?: string
  errorCode?: 'NOT_CONFIGURED'
}

export const GoogleDriveService = {
  createFolder: createTaskFolder,
  uploadFile: uploadFileToDrive,
}

export async function createTaskFolder(taskTitle: string): Promise<LegacyDriveFolderResult> {
  void taskTitle
  return { success: false, errorCode: 'NOT_CONFIGURED' }
}

export async function uploadFileToDrive(
  file: File,
  folderId: string,
  accessToken?: string,
): Promise<never> {
  void file
  void folderId
  void accessToken
  throw new Error('GOOGLE_DRIVE_NOT_CONFIGURED')
}
