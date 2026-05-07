/**
 * Subset of Bitrix24 REST shapes we actually consume. Fields are typed as
 * `string` because Bitrix returns numbers as strings throughout.
 */

export type BxUser = {
  ID: string;
  ACTIVE: boolean | string;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: string;
  WORK_POSITION?: string;
  TIME_ZONE?: string;
  PERSONAL_PHOTO?: string;
};

export type BxWorkgroup = {
  ID: string;
  NAME: string;
  DESCRIPTION?: string;
  CLOSED?: 'Y' | 'N';
  DATE_CREATE?: string;
  ACTIVE?: 'Y' | 'N';
  OWNER_ID?: string;
};

/**
 * Bitrix task. The REST method `tasks.task.list` returns the new format with
 * camelCase fields; the legacy `task.item.list` uses UPPER_CASE. We use the
 * new format.
 */
export type BxTask = {
  id: string;
  title: string;
  description?: string;
  status: string; // 1..7, see TASK_STATUS_MAP
  priority?: string; // 0=low, 1=medium, 2=high
  groupId?: string | null; // workgroup id, '0' or null when standalone
  responsibleId?: string;
  createdBy?: string;
  createdDate?: string;
  changedDate?: string;
  closedDate?: string | null;
  deadline?: string | null;
  startDatePlan?: string | null;
  durationPlan?: string | null;
  parentId?: string | null;
  /**
   * UF_TASK_WEBDAV_FILES — task-level attachment ids (disk.attachedObject.ID).
   * Bitrix returns this as `ufTaskWebdavFiles` in the camelCase response shape.
   * Empty array when the task has no files.
   */
  ufTaskWebdavFiles?: Array<string | number> | null;
};
