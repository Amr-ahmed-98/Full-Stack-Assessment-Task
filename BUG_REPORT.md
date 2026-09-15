# Bug Report

## Bug 1 — Users could modify tasks in projects they don't belong to

**Reported by support:** "Some users appear to be able to modify tasks belonging to projects they are not members of."

### Root Cause

`TasksService.updateStatus()` never checked project access. Every other task-mutating method in the same file (`create`, `update`, `remove`, `updateAssignee`) calls `projectAccessService.assertCanView()` or `assertCanManage()` before touching a task. `updateStatus` skipped this entirely — it didn't even receive the calling user's id, so there was nothing to check against. The JWT auth guard only confirms the request comes from *a* logged-in user; it says nothing about whether that user belongs to *this* project.

```ts
// before
async updateStatus(taskId: Types.ObjectId, dto: UpdateTaskStatusDto): Promise<TaskDetail> {
  const task = await this.findTaskOrFail(taskId);
  task.status = dto.status;
  await task.save();
  return this.toDetail(task);
}
```

### Impact

Any authenticated user, from any organization, could change the `status` of any task in the system, as long as they knew (or guessed/enumerated) a valid task id. No project membership, no role, no organization relationship required. Read access (`GET`) was unaffected — this was specific to the status-update mutation.

### Reproduction

1. Log in as User A, a member of Project X only.
2. Obtain the task id of a task belonging to Project Y (a project User A has no membership in — e.g. from a shared link, browser history, or brute-force of sequential ids).
3. Call `PATCH /tasks/:taskId/status` with that id and any valid status value.
4. Request succeeds (200), task in Project Y is updated. Expected: 403 Forbidden.

### Fix

Added `userId` as a parameter to `updateStatus`, passed through from `@CurrentUser('id')` in the controller (mirrors how `update()` already works), and added the same `assertCanView(task.projectId, userId)` check used everywhere else in this service before allowing the status write.

```ts
async updateStatus(taskId, userId, dto) {
  const task = await this.findTaskOrFail(taskId);
  const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);
  task.status = dto.status;
  await task.save();
  return this.toDetail(task, project);
}
```

### Regression Prevention

Added to the automated suite: a project-outsider attempting `PATCH /tasks/:taskId/status` now gets asserted as `403`, alongside the existing coverage for `update()`/`remove()`. See Testing section for the full list of authorization cases covered.

---

## Bug 2 — Concurrent task creation could assign duplicate task numbers

Not from the support report — found while implementing the assignee feature, and explicitly called out in the assessment brief as a known issue to fix.

### Root Cause

Task numbering used a read-then-write pattern with no atomicity:

```ts
const taskCount = await this.taskModel.countDocuments({ projectId });
const number = taskCount + 1;
```

Two `POST /projects/:id/tasks` requests arriving close together can both read the same `taskCount` before either has saved, so both compute the same `number` and both create a task with the same `key` (e.g. two `ENG-101`s).

### Impact

Duplicate task identifiers within a project — breaks the assumption that `ENG-101` uniquely identifies one task, which the UI and any external references (links, comments mentioning a task key) rely on.

### Reproduction

Fire two `POST /projects/:id/tasks` requests for the same project at effectively the same time (e.g. `Promise.all([...])` in a test, or two rapid clicks in the UI on a slow connection). Under the old code this reliably produces two tasks with the same `number`/`key` under load; under the fix it does not.

### Fix

Replaced the count-then-write with a dedicated `counters` collection and an atomic `findOneAndUpdate(..., { $inc: { seq: 1 } })` per project — MongoDB executes this as a single indivisible operation, so concurrent callers are serialized by the database itself rather than racing in application code. First-ever task for a project bootstraps the counter from the existing task count; if two requests race on that one-time bootstrap, the collection's unique `_id` lets only one insert win, and the loser falls back to the same atomic increment. Also added a `unique` compound index on `{ projectId, number }` at the database level as a second line of defense, so even an unforeseen bug elsewhere can't silently produce a duplicate.

### Regression Prevention

Added a concurrency test that fires multiple simultaneous task-creation calls against the same project and asserts every resulting `number` is unique. See Testing section.