# Assessment Notes

## Architecture

### Structure and major modules

Turborepo/pnpm monorepo, two apps + one shared package:

- `apps/api` — NestJS, one module per bounded entity: `auth`, `users`,
  `organizations`, `organization-members`, `projects`, `project-members`,
  `tasks`, `comments`. Each module owns its Mongoose schema, service, and
  controller. `common/` holds cross-cutting pieces: the global `JwtAuthGuard`,
  `AllExceptionsFilter`, the `@CurrentUser()` / `@Public()` decorators, and
  small utils (`toObjectId`, `serialize`).
- `apps/web` — Next.js App Router. Routing lives in `app/`, everything else
  is grouped by feature under `features/<feature>/` (`api.ts` for HTTP calls,
  `hooks.ts` for TanStack Query wiring, `components/` for UI). Cross-feature
  bits (query-key registry, formatters, the fetch wrapper) sit in `lib/`.
- `packages/shared` — types, enums and label maps (`TaskStatus`,
  `ProjectRole`, `TaskActivityType`, `ApiErrorBody`, ...) imported by both
  apps, so a shape only has one definition.

### Where business logic lives

In the API's service layer, not the controllers. Controllers stay thin
(DTO validation via decorators, pull `userId` off `@CurrentUser()`, call one
service method, return). All the actual rules — project access, role checks,
Rule #1/#2/#3 for assignment, activity-record creation, the counter
increment — live in `*.service.ts`. `ProjectAccessService` in particular is
the single place that answers "can this user touch this project", and every
task-mutating method in `TasksService` routes through it
(`assertCanView` / `assertCanManage`) rather than re-deriving access itself.

### Frontend ↔ backend, and server state

Plain REST over `fetch`, wrapped in one function (`apiRequest` in
`lib/api-client.ts`) that attaches the bearer token, sets JSON headers, and
normalizes every non-2xx response into a typed `ApiError`. No GraphQL, no
codegen — request/response shapes come from `@projectflow/shared`.

Server state is entirely TanStack Query. One `QueryClient` (in
`providers/query-provider.tsx`) with `staleTime: 30s`, no refetch-on-focus,
and a retry policy that gives up immediately on 4xx (auth/permission errors
won't resolve by retrying) but retries 5xx twice. Query keys are centralized
in `lib/query-keys.ts` so invalidation targets stay consistent across
features instead of each hook inventing its own key shape. Mutations that
need instant feedback (status change, assignee change) do optimistic
`setQueryData` + rollback on error; everything else just invalidates and
refetches.

### Authentication and authorization

- **AuthN**: email/password, bcrypt (12 rounds), JWT access token, no
  refresh token. `JwtAuthGuard` is registered globally (`APP_GUARD`) and
  denies by default; routes opt out with `@Public()` (login/register only).
  The guard only proves *who* the caller is — it decodes the token and
  attaches `{ id, email }` to the request. Everything past that is authZ.
- **AuthZ**: two independent axes. **Organization role**
  (`OWNER`/`ADMIN`/`MEMBER`) grants access to *every* project in that org
  when elevated. **Project role** (`PROJECT_MANAGER`/`MEMBER`) is scoped to
  one project via a membership row. `ProjectAccessService.resolve()` fetches
  both roles for a given (project, user) pair, and two small predicates
  (`canView`, `canManage`) decide access:
  - `canView` = elevated org role OR any project-role row exists.
  - `canManage` = elevated org role OR `PROJECT_MANAGER`.
  Task assignment's Rule #2/#3 reuse `canManage` directly rather than
  reimplementing the check.

### Entity relations

```
Organization ──< OrganizationMember >── User
     │
     └──< Project ──< ProjectMember >── User
                │
                ├──< Task >── User (createdBy)
                │      │  \── User (assignee, nullable)
                │      │
                │      ├──< Comment >── User (author)
                │      └──< TaskActivity >── User (actor, + resolved from/to)
```

`TaskActivity` is its own collection rather than an embedded array on `Task`
— a task's activity history is unbounded and grows for the task's whole
life, so keeping it separate keeps the `Task` document small and lets the
activity collection scale/index/archive independently (this matters more
once the app is bigger — see Scaling below).

## Observations — risks and weaknesses

1. **No refresh-token flow.** Access tokens are the only credential and
   there's no revocation list — logout only clears the token client-side; a
   copied/leaked token stays valid until natural expiry. Fine for an
   assessment, not fine for production. *Would fix later* — real cost
   (refresh rotation, storage) not worth it for this scope.

2. **Frontend re-derives a permission rule the backend already owns.**
   `AssigneeSelector` computes `canManage` client-side (org role check +
   `ProjectRole.PROJECT_MANAGER`) to decide what to show/enable. It's the
   *same* rule as `canManage()` in `project-access.service.ts`, just written
   twice — once in Nest, once in a React component. Backend still enforces
   for real, so this is UI-only drift risk (stale disabled-state, not a
   security hole), but if the rule ever changes, two places need updating.
   *Would fix later* — worth doing if a third UI surface ever needs the same
   check; not worth a shared-package permissions module for one call site.

3. **`TaskDetail.project` only carries `{id, name, key}`, not
   `organizationId`.** Computing the assignee permission client-side needed
   the project's org, so `AssigneeSelector` fires an extra `useProject(projectId)`
   fetch purely for that field (it's usually already cached from the project
   page, so in practice it's free, but on a deep link straight to a task it's
   a genuine extra round trip). *Would fix now if I were touching the DTO
   anyway* — cheap, but didn't want to touch a shape 4+ other components
   depend on for one field.

4. **Activity `metadata` is a loosely-typed `Object` at the schema level.**
   `TaskActivitySchema` stores `metadata` as `{ type: Object }` — no Mongo-side
   validation of its shape, just the TS type (`TaskAssigneeChangedMetadata`)
   at write time. Deliberate (comment in the schema explains it: keeps room
   for future activity types without a migration), but it means a bug that
   writes a malformed `metadata` object would only surface at read time, in
   the UI. *Leave for now* — the flexibility is worth it while there's only
   one activity type; would add a discriminated-union validator once a
   second type is added.

## Code Review

Reviewing this as a submitted PR:

```ts
async assignTask(taskId: string, assigneeId: string, userId: string) {
  const task = await this.taskModel.findById(taskId);
  if (!task) { throw new NotFoundException(); }
  const user = await this.userModel.findById(assigneeId);
  if (!user) { throw new NotFoundException(); }
  task.assignee = user._id;
  await task.save();
  return task;
}
```

Would not merge. In order of severity:

- **No project-access check at all.** `userId` is accepted but never used.
  Any authenticated user — from any org, any project, no membership
  anywhere — can assign any task to any user in the system. This is worse
  than the reported production bug (that one leaked *status* edits across
  projects; this leaks *assignment* the same way, plus it's wide open by
  construction, not a missed-one-method oversight).
- **Rule #1 missing.** No check that `assigneeId` is actually a member of
  the task's project. Assigns to users who have never touched the project.
- **Rule #2 missing.** No manager/owner/admin-vs-self-only check. A regular
  member can assign anyone to anything.
- **Can't unassign.** `assigneeId: string` is required — there's no path to
  `null`, so Rule #3 (removal) isn't just unenforced, it's *unimplemented*.
- **No activity record.** The entire activity-history requirement (Part 7)
  is silently skipped — every assignment change here is invisible in the
  timeline.
- **No-op writes aren't short-circuited.** Assigning to the current assignee
  still hits `save()` (and would still log a spurious activity record, once
  logging exists) — wastes a write and would pollute the history with
  no-op entries.
- **Leaks the raw Mongoose document.** Returns `task` directly instead of a
  DTO built through the same `toDetail()`-style serialization every other
  method in this service uses — inconsistent with the rest of the codebase,
  and returns internal document internals (`__v`, full sub-documents) that
  the API shouldn't expose.
- **Unhandled cast errors.** `findById(assigneeId)` on a malformed ObjectId
  string throws a raw Mongoose `CastError`, which becomes an ugly unhandled
  500 instead of a clean 400. The rest of the codebase validates ids through
  a shared `toObjectId()` helper before this point.
- **Sequential round-trips that don't need to be.** `findById(taskId)` and
  `findById(assigneeId)` don't depend on each other — `Promise.all` saves a
  network hop to Mongo.

What I'd ask the engineer to change: add the `ProjectAccessService`
membership + role checks (Rules #1/#2/#3), accept `assigneeId: string | null`
to support unassignment, write the activity record inside the same method
(and skip the write/log entirely on a no-op), return through the existing
serialization path, and validate the id before querying. I would *not* ask
for a full rewrite beyond that — the shape of the method (load task, load
target user, assign, save, return) is fine; it's missing the rules, not
badly structured.

## Scaling the Activity System (5K → 500K users)

Current state: one MongoDB collection (`task_activities`), one compound
index (`task, createdAt desc`), offset pagination (`skip`/`limit`), synchronous
write on the same request that changes the assignee, batched actor
resolution (one extra query per page, not per row).

**What breaks first, roughly in order of when it bites:**

1. **Offset pagination degrades before anything else does.** `skip(n)` makes
   Mongo walk and discard `n` documents before returning a page. Fine at
   dozens of activity rows per task; ugly once busy tasks (or, more likely,
   an "all activity for this project" view someone eventually asks for)
   have thousands. Switch to cursor pagination: keep `(createdAt, _id)` as
   the cursor, `find({ task, $or: [{createdAt: {$lt: cursor.createdAt}}, ...] })`
   — no skip, so cost stays flat per page regardless of how deep the user
   pages. This is the first thing I'd change, and it's a compatible change
   from the frontend's point of view (`useInfiniteQuery` already models
   "give me the next page" as an opaque cursor, not a page number — swapping
   `pageParam` from a number to a cursor object doesn't touch the UI).

2. **The write path is synchronous and on the critical path of a
   user-facing request.** Right now `updateAssignee` does: check rules,
   `task.save()`, `activityModel.create()`, return — all inside the request
   that the user is waiting on. At 500K users this is still probably fine
   *latency-wise* (it's one extra insert), but it couples task-mutation
   throughput to activity-collection health, and it's the natural point to
   decouple once more activity types get added (comments, status changes,
   membership changes) and the write volume grows past what one collection
   comfortably absorbs on the same write path as the task itself. I'd move
   activity writes to an outbox-style pattern: write task + a pending
   "activity intent" in the same transaction, have a worker drain it into
   the activity collection (or a queue → collection). Not worth doing at
   current scale — worth doing once a second activity-producing feature
   ships, because that's when the "just insert it inline" approach starts
   compounding.

3. **Data grows forever if nothing retires it.** Activity is append-only and
   the brief flags it as "one of the largest datasets in the system" at
   scale — it will eventually dwarf `tasks`. Add a retention policy: keep,
   say, 12-18 months "hot" in the primary collection (covered by the
   existing index), and a scheduled job that archives older rows to cold
   storage (a `task_activities_archive` collection on cheaper storage, or an
   export to S3/equivalent as newline-delimited JSON) and removes them from
   the hot collection. Old activity is read rarely and never written to —
   ideal candidate for tiered storage. This should happen *before* it's
   urgent, since migrating a live, growing collection under pressure is
   much worse than scheduling it early.

4. **Real-time is currently "refetch after your own mutation."** The
   activity feed only updates for the person who just made the change
   (via `onSettled` invalidation) — a second person looking at the same task
   doesn't see it until they navigate away and back, or a background
   refetch happens to fire. At 500K users with more concurrent collaborators
   per task, I'd add a lightweight push (SSE or WebSocket, scoped to
   `task:{id}` rooms) that just tells other viewers "activity changed, go
   refetch" — cheap fan-out, no need to push the payload itself since the
   query cache already knows how to refetch.

5. **Caching and observability get worth it once traffic, not data size, is
   the pressure.** A hot task (lots of viewers, e.g. a widely-watched
   incident ticket) would benefit from caching its first activity page
   (Redis, short TTL, invalidated on write) rather than hitting Mongo per
   viewer. I'd add this reactively, once metrics show which endpoints are
   actually hot, rather than pre-emptively — and pair it with basic query
   latency dashboards + slow-query alerting on the activity collection
   specifically, since it's the one growing unbounded.

**What I would explicitly not reach for:** a message queue (Kafka/RabbitMQ),
event sourcing, or splitting this into a separate service. None of those
solve a problem this system actually has yet — a single well-indexed
collection with cursor pagination and a retention job covers the growth
described here. I'd revisit only if activity became genuinely multi-consumer
(e.g. a separate analytics pipeline needs every activity event, not just the
UI) — that's the point where a queue starts paying for itself instead of
just adding an op to run.

## If I Had Two More Days

Priority order — most important first:

1. **Cursor-based pagination for the activity endpoint.** Straightforward,
   backward-compatible-ish change, and the one item on this list that
   actually starts to matter before 500K users — any task with a genuinely
   long history already pays the `skip()` cost today.
2. **Collapse the duplicated `canManage` check** into one place both API and
   web can use — either export a pure function from `@projectflow/shared`
   that both sides call with their own role lookups, or accept the
   duplication is fine and add a test that fails if the two definitions
   ever diverge (cheaper, and honestly might be the better call for one
   call site).
3. **Frontend automated tests.** The backend has solid e2e coverage; the web
   app has none. I'd add: a hook test for `useUpdateTaskAssignee`'s
   optimistic-rollback path (the trickiest bit of logic on the frontend),
   and a component test for `AssigneeSelector`'s permission gating (regular
   member sees self only, manager sees everyone).
4. **Real-time activity feed** (SSE, scoped per task) — biggest visible UX
   gap once more than one person is looking at the same task at a time.
5. **Refresh tokens.** Not urgent for the assessment's scope, but the
   single-long-lived-JWT approach is the one thing here I wouldn't want in
   a real production auth system.