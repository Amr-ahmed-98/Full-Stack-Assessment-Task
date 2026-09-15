# ProjectFlow

ProjectFlow is a lightweight project and task tracker for software teams.
Organizations own projects, projects own tasks, and tasks carry a status, a
priority and a discussion thread.

It is a TypeScript monorepo: a NestJS + MongoDB API and a Next.js App Router
frontend, sharing a small package of domain types and enums.

---

## Technology stack

| Area         | Choice                                           |
| ------------ | ------------------------------------------------ |
| Monorepo     | pnpm workspaces + Turborepo                      |
| Language     | TypeScript 5.9                                   |
| API          | NestJS 11, Mongoose 8, MongoDB                   |
| Auth         | JWT bearer tokens, bcrypt password hashing       |
| Web          | Next.js 16 (App Router), React 19                |
| Styling      | Tailwind CSS 4, Radix primitives, Phosphor Icons |
| Server state | TanStack Query 5                                 |
| Forms        | React Hook Form + Zod                            |
| Testing      | Jest, Supertest, mongodb-memory-server           |

---

## Prerequisites

- **Node.js 20.19+** (22 or 24 recommended)
- **pnpm 10+** — `npm install -g pnpm`
- **MongoDB 7+** running locally

On macOS:

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

Any reachable MongoDB works — point `MONGODB_URI` wherever you like.

---

## Installation

```bash
pnpm install
```

## Environment setup

Configuration lives in a single `.env` file at the repository root; both apps
read it.

```bash
cp .env.example .env
```

| Variable              | Purpose                          | Default                                 |
| --------------------- | -------------------------------- | --------------------------------------- |
| `MONGODB_URI`         | MongoDB connection string        | `mongodb://127.0.0.1:27017/projectflow` |
| `JWT_SECRET`          | Signing secret for access tokens | — (required)                            |
| `JWT_EXPIRES_IN`      | Access token lifetime            | `7d`                                    |
| `API_PORT`            | Port the API listens on          | `4732`                                  |
| `WEB_ORIGIN`          | Origin allowed by CORS           | `http://localhost:3742`                 |
| `NEXT_PUBLIC_API_URL` | API base URL used by the browser | `http://localhost:4732`                 |

The API refuses to boot if `MONGODB_URI` or `JWT_SECRET` is missing.

## Database

Make sure MongoDB is running, then load development data:

```bash
pnpm seed
```

The seed is repeatable — it clears the ProjectFlow collections and reinserts a
fresh organization, users, projects, tasks and comments.

## Running the apps

```bash
pnpm dev
```

- Web — <http://localhost:3742>
- API — <http://localhost:4732>

Both apps deliberately avoid the usual 3000/4000 defaults so they do not clash
with other projects. To move the web app, set `WEB_PORT` in your shell and
update `WEB_ORIGIN` in `.env` to match, so CORS keeps working:

```bash
WEB_PORT=3800 pnpm --filter @projectflow/web dev
```

The API port comes from `API_PORT` in `.env`; change `NEXT_PUBLIC_API_URL` to
match if you move it.

Run one at a time if you prefer:

```bash
pnpm --filter @projectflow/api dev
pnpm --filter @projectflow/web dev
```

## From a clean checkout

```bash
pnpm install
cp .env.example .env
pnpm seed
pnpm dev
```

---

## Commands

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Run the API and web app in watch mode      |
| `pnpm build`     | Build every package and app                |
| `pnpm lint`      | ESLint across the workspace                |
| `pnpm typecheck` | TypeScript project-wide, no emit           |
| `pnpm test`      | API test suite (uses an in-memory MongoDB) |
| `pnpm seed`      | Reset and reload development data          |
| `pnpm format`    | Prettier write                             |

`pnpm test` does not need a running MongoDB — it starts a throwaway in-memory
server for the duration of the run. The first run downloads a MongoDB binary
(around 100 MB) and caches it.

---

## Development credentials

Seeded accounts, all sharing the password `Password123!`:

| Name         | Email                 | Access                    |
| ------------ | --------------------- | ------------------------- |
| Ammar Yaser  | `ammar@example.com`   | Organization owner        |
| Sarah Ahmed  | `sarah@example.com`   | Organization admin        |
| Ahmed Hassan | `ahmed@example.com`   | Project manager on `ENG`  |
| Magd Ali     | `magd@example.com`    | Member of `ENG` and `WEB` |
| Outside User | `outside@example.com` | No organization           |

These are local development accounts only.

---

## Architecture

```
projectflow/
├── apps/
│   ├── api/                     NestJS API
│   │   ├── src/
│   │   │   ├── auth/            register / login / current user
│   │   │   ├── users/
│   │   │   ├── organizations/
│   │   │   ├── organization-members/
│   │   │   ├── projects/        projects + ProjectAccessService
│   │   │   ├── project-members/
│   │   │   ├── tasks/
│   │   │   ├── comments/
│   │   │   ├── common/          guards, decorators, filters, shared DTOs
│   │   │   └── database/seed.ts
│   │   └── test/                e2e suites and fixtures
│   │
│   └── web/                     Next.js App Router frontend
│       └── src/
│           ├── app/             routes and layouts
│           ├── components/      design system primitives + app shell
│           ├── features/        auth, projects, tasks, comments
│           ├── lib/             API client, query keys, formatting
│           └── providers/       TanStack Query provider
│
└── packages/
    ├── shared/                  enums, constants, API response types
    ├── eslint-config/           flat ESLint configs
    └── tsconfig/                base TypeScript configs
```

### API layering

Each module follows the same shape: controller → service → Mongoose model, with
DTOs validating input at the boundary. Controllers stay thin; business rules
live in services.

### Domain model

```
User
Organization        ── OrganizationMember ── User      (OWNER | ADMIN | MEMBER)
Organization  ── Project
Project             ── ProjectMember      ── User      (PROJECT_MANAGER | MEMBER)
Project       ── Task ── Comment
```

Membership is stored in its own collection rather than as arrays on the parent
document, so it can be indexed and queried directly. Both membership
collections carry a unique compound index on their two foreign keys.

Tasks are numbered per project and identified by a human-readable key derived
from the project key: `ENG-1`, `ENG-2`, `WEB-1`.

### Authorization

`ProjectAccessService` answers "may this user touch this project?" in one
place. Access comes from either an elevated organization role (`OWNER` or
`ADMIN`, which grants access to every project in the organization) or an
explicit project membership row. `assertCanView` gates reads, `assertCanManage`
gates configuration and membership changes.

Authentication is a JWT bearer token. `JwtAuthGuard` is registered globally;
routes opt out with the `@Public()` decorator.

### API surface

```
POST   /auth/register
POST   /auth/login
GET    /auth/me

GET    /organizations

GET    /projects
POST   /projects
GET    /projects/:projectId
GET    /projects/:projectId/members
POST   /projects/:projectId/members

GET    /projects/:projectId/tasks
POST   /projects/:projectId/tasks
GET    /tasks/:taskId
PATCH  /tasks/:taskId
PATCH  /tasks/:taskId/status
PATCH  /tasks/:taskId/assignee
GET    /tasks/:taskId/activity
DELETE /tasks/:taskId

GET    /tasks/:taskId/comments
POST   /tasks/:taskId/comments
```

`PATCH /tasks/:taskId/assignee` assigns or clears a task's assignee
(`{ "assigneeId": string | null }`), enforcing project membership and the
manager/self-only role rule (see Technical Decisions below). Every
successful change writes a `task_activities` record, readable via
`GET /tasks/:taskId/activity` (paginated, newest first).

Errors share one shape:

```json
{
  "statusCode": 403,
  "message": "You do not have access to this project",
  "error": "Forbidden"
}
```

### Frontend

Routes are thin; the work happens in `features/`. Server state is owned by
TanStack Query — query keys live in `lib/query-keys.ts` so invalidation stays
predictable — and local UI state stays in React. The API client in
`lib/api-client.ts` centralises the base URL, the auth header and error
parsing.

Components are server components by default; `"use client"` is added only where
interactivity or hooks require it.

---

## Testing

```bash
pnpm test
```

Runs the API's e2e suite (Jest + Supertest) against an in-memory MongoDB
(`mongodb-memory-server`) — no local database needed, and nothing touches
your real `MONGODB_URI`. First run downloads a MongoDB binary (~100 MB) and
caches it; needs network access to `fastdl.mongodb.org`.

Coverage includes: registration/login/auth guards, organization and project
membership access rules, task CRUD and filtering, comments, and the task
assignment feature end to end — self-assignment, manager-assigns-another,
regular-member-blocked-from-assigning-others, outsider-blocked-from-being-
assigned, unassign permissions, activity records created on every assignee
change (including unassign), activity access blocked for non-members, the
status-update authorization fix, and a concurrency test that fires
simultaneous task creations and asserts no two get the same number.

The frontend has no automated tests yet — see Known Limitations.

---

## Technical Decisions

**Assignee gets its own endpoint (`PATCH /tasks/:taskId/assignee`), not
folded into the general task `PATCH`.** Matches the existing `status`
endpoint's pattern, and assignment carries enough of its own business logic
(membership + role rules, activity logging) to be worth isolating.

**Task activity is its own MongoDB collection (`task_activities`), not an
array on `Task`.** Activity is append-only and unbounded over a task's
lifetime; embedding it would bloat the task document and make it harder to
index, paginate, and eventually archive independently.

**Concurrent task numbering uses an atomic per-project counter, not the
original `countDocuments` + 1.** `findOneAndUpdate` with `$inc` is a single
indivisible operation in MongoDB — concurrent requests are serialized by the
database, so two requests can never read the same "next" number. A unique
index on `{ projectId, number }` is a second line of defense in case a bug
elsewhere ever bypasses the counter.

**Activity actor/from/to resolution is batched, not per-record.** Reading a
page of activity collects every referenced user id first (actor, previous
assignee, new assignee), dedupes, and resolves them in one query — avoids an
N+1 query pattern on a list endpoint.

**Frontend assignee changes are optimistic with rollback.** The task's
assignee updates in the UI immediately on selection and reverts if the API
rejects the change, so permission or membership errors don't leave the UI
stuck on a loading state.

**Reused `canManage()` instead of writing new permission logic.** Rule #2
("OWNER/ADMIN/PROJECT_MANAGER may assign anyone") is exactly what the
existing `ProjectAccessService.canManage()` already checks — assignment
rules build on it rather than duplicating the role logic.

---

## Known Limitations

- **No refresh-token flow.** The JWT access token is the only credential and
  there's no revocation list; a leaked token stays valid until it naturally
  expires. Acceptable for this assessment's scope, not for production.
- **The manager/self-only permission check is duplicated.** The frontend
  (`AssigneeSelector`) re-derives the same rule the backend enforces, to
  decide what to show and enable. The backend still enforces the real check —
  this is a UI-consistency risk, not a security gap — but if the rule
  changes, both places need updating.
- **Activity pagination is offset-based (`skip`/`limit`), not cursor-based.**
  Fine at the volumes a single task accumulates today; would need to move to
  cursor pagination before activity volume grows much further (see the
  Scaling section in `ASSESSMENT_NOTES.md`).
- **No frontend automated tests.** The backend has full e2e coverage of the
  new feature and both bug fixes; the web app's optimistic-update logic and
  permission gating are currently only verified manually.
- **The activity feed doesn't update in real time for other viewers.** A
  second person looking at the same task only sees a new activity entry
  after their own next refetch, not the moment it happens.

See `ASSESSMENT_NOTES.md` for the full reasoning behind these and the
scaling plan for the activity system.