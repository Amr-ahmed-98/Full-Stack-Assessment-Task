'use client';

import { useMemo, useState } from 'react';
import {
  CaretUpDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react/dist/ssr';
import { toast } from 'sonner';
import { isElevatedOrganizationRole, ProjectRole, type TaskDetail } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/features/auth/hooks';
import { useProject, useProjectMembers } from '@/features/projects/hooks';
import { useUpdateTaskAssignee } from '../hooks';

/** Below this, a plain list is faster to scan than a search box. */
const SEARCH_THRESHOLD = 6;

interface AssigneeSelectorProps {
  task: TaskDetail;
  projectId: string;
}

export function AssigneeSelector({ task, projectId }: AssigneeSelectorProps) {
  const [search, setSearch] = useState('');
  const { data: currentUser, isPending: isUserPending } = useCurrentUser();
  const { data: project, isPending: isProjectPending } = useProject(projectId);
  const {
    data: members,
    isPending: isMembersPending,
    isError,
    error,
  } = useProjectMembers(projectId);
  const updateAssignee = useUpdateTaskAssignee(task.id, projectId);

  const isPending = isUserPending || isProjectPending || isMembersPending;

  // Rule #2: OWNER/ADMIN on the org, or PROJECT_MANAGER on the project, may
  // assign anyone. A regular member may only touch their own assignment
  // (mirrors canManage() on the backend — see project-access.service.ts).
  const ownMembership = members?.find((member) => member.user.id === currentUser?.id);
  const orgRole = currentUser?.organizations.find((org) => org.id === project?.organizationId)
    ?.role;
  const canManage =
    isElevatedOrganizationRole(orgRole) || ownMembership?.role === ProjectRole.PROJECT_MANAGER;

  // Rule #3: unassigning follows the same split — managers can clear anyone,
  // a regular member can only clear a task currently assigned to themselves.
  const canUnassign = canManage || task.assignee?.id === currentUser?.id;

  const selectableMembers = useMemo(() => {
    const all = members ?? [];
    if (canManage) {
      return all;
    }
    return all.filter((member) => member.user.id === currentUser?.id);
  }, [members, canManage, currentUser?.id]);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) {
      return selectableMembers;
    }
    const term = search.trim().toLowerCase();
    return selectableMembers.filter((member) => member.user.name.toLowerCase().includes(term));
  }, [selectableMembers, search]);

  if (isPending) {
    return <Skeleton className="h-8 w-full" />;
  }

  if (isError) {
    return (
      <p className="text-[12px] text-danger" role="alert">
        {error.message}
      </p>
    );
  }

  const isDisabled = updateAssignee.isPending || selectableMembers.length === 0;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setSearch('');
        }
      }}
    >
      <DropdownMenuTrigger
        aria-label="Assignee"
        disabled={isDisabled}
        className={cn(
          'inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground',
          'hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {task.assignee ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar user={task.assignee} size="sm" />
            <span className="truncate">{task.assignee.name}</span>
          </span>
        ) : (
          <span className="text-subtle-foreground">Unassigned</span>
        )}
        <CaretUpDownIcon size={13} className="shrink-0 text-subtle-foreground" />
      </DropdownMenuTrigger>
      
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        {selectableMembers.length > SEARCH_THRESHOLD ? (
          <div className="relative mb-1 px-1 pt-1">
            <MagnifyingGlassIcon
              size={13}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle-foreground"
            />
            <Input
              autoFocus
              placeholder="Search members..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                // Let Escape bubble so the dropdown can still close on it;
                // everything else must NOT reach Radix's roving-focus /
                // typeahead handling on the content, or keystrokes get eaten.
                if (event.key !== 'Escape') {
                  event.stopPropagation();
                }
              }}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        ) : null}

        {canUnassign ? (
          <>
            <DropdownMenuItem
              onSelect={() =>
                updateAssignee.mutate(null, {
                  onError: (mutationError) => toast.error(mutationError.message),
                })
              }
            >
              <XIcon size={14} className="text-subtle-foreground" />
              Unassigned
              {!task.assignee ? (
                <CheckIcon size={13} weight="bold" className="ml-auto text-primary" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {filteredMembers.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-subtle-foreground">No members found.</p>
        ) : (
          filteredMembers.map((member) => (
            <DropdownMenuItem
              key={member.id}
              onSelect={() =>
                updateAssignee.mutate(member.user.id, {
                  onError: (mutationError) => toast.error(mutationError.message),
                })
              }
            >
              <Avatar user={member.user} size="sm" />
              <span className="truncate">{member.user.name}</span>
              {task.assignee?.id === member.user.id ? (
                <CheckIcon size={13} weight="bold" className="ml-auto shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}