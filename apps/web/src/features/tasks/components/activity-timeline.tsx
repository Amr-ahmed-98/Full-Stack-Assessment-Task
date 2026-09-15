'use client';

import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr';
import { TaskActivityType, type TaskActivityEntry, type UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

/** "themselves" whenever the referenced person is the actor — matches how a
 * person would narrate their own log entry, independent of who's reading it. */
function describePerson(person: UserSummary | null, actor: UserSummary): string {
  if (!person) {
    return 'no one';
  }
  return person.id === actor.id ? 'themselves' : person.name;
}

function describeActivity(entry: TaskActivityEntry): string {
  const { actor, from, to } = entry;

  switch (entry.type) {
    case TaskActivityType.TASK_ASSIGNEE_CHANGED: {
      if (!from && to) {
        return `${actor.name} assigned ${describePerson(to, actor)}`;
      }
      if (from && !to) {
        return `${actor.name} removed the assignee`;
      }
      if (from && to) {
        return `${actor.name} changed the assignee from ${describePerson(
          from,
          actor,
        )} to ${describePerson(to, actor)}`;
      }
      return `${actor.name} updated the assignee`;
    }
    default:
      return `${actor.name} updated this task`;
  }
}

export function ActivityTimeline({ taskId }: { taskId: string }) {
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTaskActivity(taskId);

  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3" aria-label="Activity">
      <h2 className="text-sm font-semibold text-foreground">Activity</h2>

      {isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
          {error.message}
        </p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title="No activity yet"
          description="Assignee changes will show up here."
        />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2.5">
              <Avatar user={entry.actor} size="sm" />
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">
                <span className="text-foreground">{describeActivity(entry)}</span>{' '}
                <span className="text-[12px] text-subtle-foreground">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          loading={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </section>
  );
}