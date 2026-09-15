'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  ProjectMemberEntry,
  TaskActivityEntry,
  TaskDetail,
  TaskStatus,
  TaskSummary,
} from '@projectflow/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  createTask,
  type CreateTaskPayload,
  fetchProjectTasks,
  fetchTask,
  fetchTaskActivity,
  updateTaskAssignee,
  updateTaskStatus,
} from './api';

export function useProjectTasks(projectId: string) {
  return useQuery<Paginated<TaskSummary>>({
    queryKey: queryKeys.projectTasks(projectId),
    queryFn: () => fetchProjectTasks(projectId),
    enabled: projectId.length > 0,
  });
}

export function useTask(taskId: string) {
  return useQuery<TaskDetail>({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: taskId.length > 0,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, CreateTaskPayload>({
    mutationFn: (payload) => createTask(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });
}

export function useUpdateTaskStatus(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, TaskStatus>({
    mutationFn: (status) => updateTaskStatus(taskId, status),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}

/**
 * Assignee change with an optimistic update: the task card flips to the new
 * assignee immediately, and rolls back to the previous snapshot if the API
 * rejects the change (e.g. a permission or membership rule on the backend).
 * On success we also invalidate the activity feed, since every assignee
 * change writes a new activity record.
 */
export function useUpdateTaskAssignee(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, string | null, { previousTask?: TaskDetail }>({
    mutationFn: (assigneeId) => updateTaskAssignee(taskId, assigneeId),
    onMutate: async (assigneeId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });

      const previousTask = queryClient.getQueryData<TaskDetail>(queryKeys.task(taskId));
      if (previousTask) {
        const optimisticAssignee =
          assigneeId === null
            ? null
            : (queryClient
              .getQueryData<ProjectMemberEntry[]>(
                queryKeys.projectMembers(projectId),
              )
              ?.find((member) => member.user.id === assigneeId)?.user ?? previousTask.assignee ?? null);

        queryClient.setQueryData<TaskDetail>(queryKeys.task(taskId), {
          ...previousTask,
          assignee: optimisticAssignee,
        });
      }

      return { previousTask };
    },
    onError: (_error, _assigneeId, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(queryKeys.task(taskId), context.previousTask);
      }
    },
    onSuccess: (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
      ]);
    },
  });
}

export function useTaskActivity(taskId: string) {
  return useInfiniteQuery<Paginated<TaskActivityEntry>>({
    queryKey: queryKeys.taskActivity(taskId),
    queryFn: ({ pageParam }) => fetchTaskActivity(taskId, pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: taskId.length > 0,
  });
}