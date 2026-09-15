import type {
  Paginated,
  TaskActivityEntry,
  TaskDetail,
  TaskPriority,
  TaskStatus,
  TaskSummary,
} from '@projectflow/shared';
import { apiRequest } from '@/lib/api-client';

/** Recent-history panel doesn't need to page by default — one screenful is enough. */
const ACTIVITY_PAGE_SIZE = 20;

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
}

/** The board renders every column at once, so tasks are fetched in one page. */
const BOARD_PAGE_SIZE = 100;

export function fetchProjectTasks(projectId: string): Promise<Paginated<TaskSummary>> {
  return apiRequest<Paginated<TaskSummary>>(`/projects/${projectId}/tasks`, {
    query: { page: 1, pageSize: BOARD_PAGE_SIZE },
  });
}

export function fetchTask(taskId: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}`);
}

export function createTask(projectId: string, payload: CreateTaskPayload): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: payload,
  });
}

export function updateTaskStatus(taskId: string, status: TaskStatus): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: { status },
  });
}

export function updateTask(
  taskId: string,
  payload: Partial<Pick<CreateTaskPayload, 'title' | 'description' | 'priority'>>,
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: payload,
  });
}

/** `assigneeId: null` clears the assignee — same endpoint handles both directions. */
export function updateTaskAssignee(
  taskId: string,
  assigneeId: string | null,
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}/assignee`, {
    method: 'PATCH',
    body: { assigneeId },
  });
}

export function fetchTaskActivity(
  taskId: string,
  page = 1,
): Promise<Paginated<TaskActivityEntry>> {
  return apiRequest<Paginated<TaskActivityEntry>>(`/tasks/${taskId}/activity`, {
    query: { page, pageSize: ACTIVITY_PAGE_SIZE },
  });
}