import type { UserSummary } from './api';


// activity file put in shared because frontend and backend will use this file because they need to know what activity will look like
// One source and no duplication

export enum TaskActivityType {
    TASK_ASSIGNEE_CHANGED = 'TASK_ASSIGNEE_CHANGED',
}

/** Raw ids as stored on the activity record. */
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
    /** Resolved users for metadata.from / metadata.to so the UI can render names directly.*/
    from: UserSummary | null;
    to: UserSummary | null;
    createdAt: string;
}

