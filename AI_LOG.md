# AI Usage Log

## Tools Used

- **Claude** (chat) — backend feature implementation, bug investigation and
  fixes, tests, and documentation (`ASSESSMENT_NOTES.md`, `BUG_REPORT.md`,
  `README.md`).


## How I Used Them

- Read through the existing codebase with Claude first (schema, services,
  controllers, access-control layer) before writing anything, to match
  existing patterns instead of inventing new ones.
- Backend feature work (assignee field, assignment rules, activity schema
  and endpoint) was built step by step: one small piece at a time (schema →
  endpoint → activity logging → activity read endpoint), typechecked after
  each step, committed separately.
- Used AI to help investigate the two required bugs: read the actual
  `tasks.service.ts` methods side by side to spot which one skipped the
  authorization check the others all had, and to reason through why the
  original task-numbering logic could race under concurrent requests.
- Used AI to draft the e2e test file covering the new rules, then ran it
  (typecheck + attempted execution) to catch real issues rather than
  trusting the draft blind — this caught the missing `assignee` field in
  the API's serialization layer that would have made the tests fail.
- Used AI to draft `ASSESSMENT_NOTES.md`, `BUG_REPORT.md`, and this file,
  then reviewed and edited for accuracy against what was actually built.

## Suggestions I Rejected

- Claude's first pass at the concurrency fix suggested `cross-env-shell`
  to work around a Windows dev-server port issue (unrelated to the
  concurrency bug itself, but hit during setup). That didn't actually work —
  `cross-env-shell` still spawns through the OS shell, and Windows'
  `cmd.exe`/PowerShell don't understand the bash-style `${VAR:-default}`
  syntax being used, so the broken command just got passed through
  unexpanded. Replaced it with a small Node script that picks the port in
  JavaScript instead of shell syntax, which is genuinely cross-platform.
- Rejected folding the assignee update into the existing general
  `PATCH /tasks/:taskId` endpoint (a plausible simpler-looking option) in
  favor of a dedicated `PATCH /tasks/:taskId/assignee` endpoint, because the
  existing codebase already isolates `status` updates the same way, and
  assignment carries enough of its own rules to justify its own endpoint
  rather than one method doing several unrelated things.


## Generated Code I Modified

- An early edit accidentally deleted the `task.status = dto.status;` line
  and the method signature line of `updateStatus` while inserting the new
  `updateAssignee` method nearby (a find-and-replace anchor matched more of
  the file than intended). Caught it by actually running `tsc --noEmit`
  instead of assuming the edit was correct, and restored the missing lines.
- The first version of the activity-page serializer resolved each record's
  actor with a separate database call in a loop. Rewrote it to collect every
  user id referenced on the page (actor, previous assignee, new assignee)
  into a single `Set`, then resolve them all in one batched query — the
  brief explicitly calls out avoiding N+1 queries on this endpoint.
