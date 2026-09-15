// activity file put in shared because frontend and backend will use this file because they need to know what activity will look like
// One source and no duplication 


import type { UserSummary } from './api';

export enum TaskActivityType {
    TASK_ASSIGNEE_CHANGED = 'TASK_ASSIGNEE_CHANGED',
}

export interface TaskAssigneeChangedMetadata {
    from: string | null;
    to: string | null;
}

export interface TaskActivityEntry {
    id: string;
    type: TaskActivityType;
    task: string;
    actor: UserSummary;
    metadata: TaskAssigneeChangedMetadata;
    createdAt: string;
}