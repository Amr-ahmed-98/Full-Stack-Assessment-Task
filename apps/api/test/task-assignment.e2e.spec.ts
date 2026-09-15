import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { OrganizationRole, ProjectRole, TaskActivityType } from '@projectflow/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import {
    addOrganizationMember,
    addProjectMember,
    authHeader,
    createOrganization,
    createProject,
    createTask,
    registerUser,
    type TestUser,
} from './utils/fixtures';

describe('Task assignment', () => {
    let app: INestApplication;
    let connection: Connection;

    let manager: TestUser; // PROJECT_MANAGER on the project
    let memberA: TestUser; // regular MEMBER, project member
    let memberB: TestUser; // regular MEMBER, project member (assignment target)
    let outsider: TestUser; // not a project member at all

    let organizationId: string;
    let projectId: string;
    let projectKey: string;

    beforeAll(async () => {
        ({ app, connection } = await createTestApp());
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await resetDatabase(connection);

        manager = await registerUser(app, 'Ammar Yaser', 'ammar@example.com');
        memberA = await registerUser(app, 'Magd Ali', 'magd@example.com');
        memberB = await registerUser(app, 'Ahmed Samir', 'ahmed@example.com');
        outsider = await registerUser(app, 'Outside User', 'outside@example.com');

        organizationId = await createOrganization(connection, 'Acme Software', 'acme-software', manager.id);
        await addOrganizationMember(connection, organizationId, manager.id, OrganizationRole.MEMBER);
        await addOrganizationMember(connection, organizationId, memberA.id, OrganizationRole.MEMBER);
        await addOrganizationMember(connection, organizationId, memberB.id, OrganizationRole.MEMBER);

        projectKey = 'ENG';
        projectId = await createProject(connection, organizationId, 'Internal Platform', projectKey, manager.id);

        await addProjectMember(connection, projectId, manager.id, ProjectRole.PROJECT_MANAGER);
        await addProjectMember(connection, projectId, memberA.id, ProjectRole.MEMBER);
        await addProjectMember(connection, projectId, memberB.id, ProjectRole.MEMBER);
        // outsider deliberately has no project_members row and no org membership
    });

    async function newTask(title = 'Some task'): Promise<string> {
        return createTask(connection, projectId, projectKey, 1, title, manager.id);
    }

    // ---------------------------------------------------------------------
    // Rule #1 — project membership
    // ---------------------------------------------------------------------

    it('rejects assigning a task to a user outside the project', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: outsider.id })
            .expect(403);
    });

    // ---------------------------------------------------------------------
    // Rule #2 — assignment permissions
    // ---------------------------------------------------------------------

    it('lets a regular member assign a task to themselves', async () => {
        const taskId = await newTask();

        const response = await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(memberA))
            .send({ assigneeId: memberA.id })
            .expect(200);

        expect(response.body.id).toBe(taskId);
    });

    it('lets a PROJECT_MANAGER assign a task to another member', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberB.id })
            .expect(200);
    });

    it('rejects a regular member assigning the task to someone else', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(memberA))
            .send({ assigneeId: memberB.id })
            .expect(403);
    });

    it('rejects assignment from someone outside the project entirely', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(outsider))
            .send({ assigneeId: memberA.id })
            .expect(403);
    });

    // ---------------------------------------------------------------------
    // Rule #3 — unassignment
    // ---------------------------------------------------------------------

    it('lets an authorized manager remove the current assignee', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        const response = await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: null })
            .expect(200);

        expect(response.body.id).toBe(taskId);
    });

    it('lets a member remove their own assignment but not someone else\'s', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        // memberB is not the assignee and not a manager -> forbidden
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(memberB))
            .send({ assigneeId: null })
            .expect(403);

        // memberA is the current assignee -> allowed
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(memberA))
            .send({ assigneeId: null })
            .expect(200);
    });

    // ---------------------------------------------------------------------
    // Activity log — all three transitions
    // ---------------------------------------------------------------------

    it('creates an activity record for unassigned -> assigned', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        const response = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(response.body.total).toBe(1);
        expect(response.body.items[0]).toMatchObject({
            type: TaskActivityType.TASK_ASSIGNEE_CHANGED,
            metadata: { from: null, to: memberA.id },
        });
        expect(response.body.items[0].to).toMatchObject({ email: 'magd@example.com' });
        expect(response.body.items[0].from).toBeNull();
    });

    it('creates an activity record for assigned -> different user', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberB.id })
            .expect(200);

        const response = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(response.body.total).toBe(2);
        // newest first
        expect(response.body.items[0].metadata).toEqual({ from: memberA.id, to: memberB.id });
        expect(response.body.items[1].metadata).toEqual({ from: null, to: memberA.id });
    });

    it('creates an activity record for assigned -> unassigned', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(memberA))
            .send({ assigneeId: null })
            .expect(200);

        const response = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(response.body.items[0]).toMatchObject({
            type: TaskActivityType.TASK_ASSIGNEE_CHANGED,
            metadata: { from: memberA.id, to: null },
        });
    });

    it('does not create an activity record when the assignee value does not change', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        // same assignee sent again — should be a no-op, no second activity record
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);

        const response = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(response.body.total).toBe(1);
    });

    // ---------------------------------------------------------------------
    // Activity endpoint access control + pagination
    // ---------------------------------------------------------------------

    it('rejects reading activity for someone outside the project', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .set('Authorization', authHeader(outsider))
            .expect(403);
    });

    it('paginates activity, newest first', async () => {
        const taskId = await newTask();

        // 3 transitions -> 3 activity records
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberA.id })
            .expect(200);
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: memberB.id })
            .expect(200);
        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/assignee`)
            .set('Authorization', authHeader(manager))
            .send({ assigneeId: null })
            .expect(200);

        const page1 = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .query({ page: 1, pageSize: 2 })
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(page1.body.total).toBe(3);
        expect(page1.body.items).toHaveLength(2);
        expect(page1.body.items[0].metadata).toEqual({ from: memberB.id, to: null });

        const page2 = await request(app.getHttpServer())
            .get(`/tasks/${taskId}/activity`)
            .query({ page: 2, pageSize: 2 })
            .set('Authorization', authHeader(manager))
            .expect(200);

        expect(page2.body.items).toHaveLength(1);
        expect(page2.body.items[0].metadata).toEqual({ from: null, to: memberA.id });
    });

    // ---------------------------------------------------------------------
    // Bug regression — cross-project task status mutation (Bug 1)
    // ---------------------------------------------------------------------

    it('rejects an outsider changing a task status (cross-project mutation bug)', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}/status`)
            .set('Authorization', authHeader(outsider))
            .send({ status: 'IN_PROGRESS' })
            .expect(403);
    });

    it('rejects an outsider editing task title/description (cross-project mutation bug)', async () => {
        const taskId = await newTask();

        await request(app.getHttpServer())
            .patch(`/tasks/${taskId}`)
            .set('Authorization', authHeader(outsider))
            .send({ title: 'Hijacked title' })
            .expect(403);
    });

    // ---------------------------------------------------------------------
    // Concurrency — task numbering (Bug 2)
    // ---------------------------------------------------------------------

    it('does not assign duplicate task numbers under concurrent creation', async () => {
        const attempts = 10;

        const responses = await Promise.all(
            Array.from({ length: attempts }, (_, index) =>
                request(app.getHttpServer())
                    .post(`/projects/${projectId}/tasks`)
                    .set('Authorization', authHeader(manager))
                    .send({ title: `Concurrent task ${index}` }),
            ),
        );

        for (const response of responses) {
            expect(response.status).toBe(201);
        }

        const numbers = responses.map((response) => response.body.number as number);
        const uniqueNumbers = new Set(numbers);

        expect(uniqueNumbers.size).toBe(attempts);
        expect([...uniqueNumbers].sort((a, b) => a - b)).toEqual(
            Array.from({ length: attempts }, (_, index) => index + 1),
        );
    });
});