import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import type { Paginated, TaskActivityEntry, TaskDetail, TaskSummary } from '@projectflow/shared';
import { TaskActivityType } from '@projectflow/shared';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';
import { toUserSummary } from '../common/utils/serialize';
import { Comment, type CommentDocument } from '../comments/schemas/comment.schema';
import { canManage, ProjectAccessService } from '../projects/project-access.service';
import { Project, type ProjectDocument } from '../projects/schemas/project.schema';
import { ProjectMembersService } from '../project-members/project-members.service';
import { UsersService } from '../users/users.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { ListTasksQueryDto } from './dto/list-tasks.dto';
import type { UpdateTaskAssigneeDto } from './dto/update-task-assignee.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { Task, type TaskDocument } from './schemas/task.schema';
import { TaskActivity, type TaskActivityDocument } from './schemas/task-activity.schema';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(TaskActivity.name) private readonly activityModel: Model<TaskActivityDocument>,
    private readonly projectAccessService: ProjectAccessService,
    private readonly projectMembersService: ProjectMembersService,
    private readonly usersService: UsersService,
  ) { }

  async findByProject(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    await this.projectAccessService.assertCanView(projectId, userId);

    const filter: FilterQuery<TaskDocument> = { projectId };
    if (query.status) {
      filter.status = query.status;
    }
    if (query.priority) {
      filter.priority = query.priority;
    }

    const [tasks, total] = await Promise.all([
      this.taskModel.find(filter).sort({ number: 1 }).skip(query.skip).limit(query.pageSize).exec(),
      this.taskModel.countDocuments(filter),
    ]);

    return {
      items: await this.toSummaries(tasks),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(
    projectId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    const { project } = await this.projectAccessService.assertCanView(projectId, userId);

    const taskCount = await this.taskModel.countDocuments({ projectId });
    const number = taskCount + 1;

    const task = await this.taskModel.create({
      projectId,
      number,
      key: `${project.key}-${number}`,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status,
      priority: dto.priority,
      createdBy: userId,
    });

    return this.toDetail(task, project);
  }

  async findOne(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const { project } = await this.projectAccessService.assertCanView(task.projectId, userId);

    return this.toDetail(task, project);
  }

  async update(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    const access = await this.projectAccessService.assertCanView(task.projectId, userId);

    const isCreator = task.createdBy.equals(userId);
    if (!canManage(access) && !isCreator) {
      throw new ForbiddenException('You do not have permission to edit this task');
    }

    if (dto.title !== undefined) {
      task.title = dto.title;
    }
    if (dto.description !== undefined) {
      task.description = dto.description;
    }
    if (dto.status !== undefined) {
      task.status = dto.status;
    }
    if (dto.priority !== undefined) {
      task.priority = dto.priority;
    }

    await task.save();

    return this.toDetail(task, access.project);
  }

  async updateAssignee(
    taskId: Types.ObjectId,
    actorUserId: Types.ObjectId,
    dto: UpdateTaskAssigneeDto,
  ): Promise<TaskDetail> {
    // First get the task and check if the actor is authorized to view the project
    const task = await this.findTaskOrFail(taskId);
    // make sure actor that making the request has access to this project
    const access = await this.projectAccessService.assertCanView(task.projectId, actorUserId);

    const newAssigneeId = dto.assigneeId ? new Types.ObjectId(dto.assigneeId) : null;
    const currentAssigneeId = task.assignee ?? null;

    const actorCanManage = canManage(access); // check if the actor is manager/owner/admin will return true

    if (newAssigneeId) {
      // Rule #1: assignee must be a member of the project
      // users must have a ProjectMember row for this project
      const assigneeRole = await this.projectMembersService.findRole(
        task.projectId,
        newAssigneeId,
      );
      // if no ProjectMember row exists findRole will return null and will reject the request and throw forbidden exception
      if (!assigneeRole) {
        throw new ForbiddenException('User is not a member of this project');
      }

      // Rule #2: managers/owners/admins may assign anyone regular members may only assign themselves
      if (!actorCanManage && !newAssigneeId.equals(actorUserId)) {
        throw new ForbiddenException('You can only assign this task to yourself');
      }
    } else {
      // Rule #3: unassigning Managers may clear anyone and a regular member may only clear their own assignment
      const isCurrentAssignee = currentAssigneeId?.equals(actorUserId) ?? false;
      if (!actorCanManage && !isCurrentAssignee) {
        throw new ForbiddenException('You do not have permission to unassign this task');
      }
    }

    const previousAssigneeId = currentAssigneeId ? currentAssigneeId.toString() : null;
    const nextAssigneeId = newAssigneeId ? newAssigneeId.toString() : null;

    // If frontend sends same value twice by double click or re-render skip save to avoid create unnecessary activity records
    if (previousAssigneeId === nextAssigneeId) {
      return this.toDetail(task, access.project);
    }

    task.assignee = newAssigneeId;
    await task.save();

    // I put activity model here because the task must saved first and then log activity only if save successful 
    // so now it covers all transitions (Unassigned → Assigned , Assigned → Different user , Assigned → Unassigned )

    await this.activityModel.create({
      task: task._id,
      type: TaskActivityType.TASK_ASSIGNEE_CHANGED,
      actor: actorUserId,
      metadata: { from: previousAssigneeId, to: nextAssigneeId },
    });

    return this.toDetail(task, access.project);
  }

  async findActivity(
    taskId: Types.ObjectId,
    userId: Types.ObjectId,
    query: PaginationQueryDto,
  ): Promise<Paginated<TaskActivityEntry>> {
    // Get the task and make sure the actor is authorized to view the project
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanView(task.projectId, userId);

    // newest first and add pagination for less payload so add default value for pagination and index added so mongo don't have to scan the whole collection 
    // and this for better performance
    const [records, total] = await Promise.all([
      this.activityModel
        .find({ task: taskId })
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.pageSize)
        .exec(),
      this.activityModel.countDocuments({ task: taskId }),
    ]);

    return {
      items: await this.toActivityEntries(records),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // two queries run parallel same as comments service to avoid creating multiple queries for each record so it will be more efficient 
  private async toActivityEntries(
    records: TaskActivityDocument[],
  ): Promise<TaskActivityEntry[]> {
    if (records.length === 0) {
      return [];
    }

    // Collect every user id referenced by this page (actor, previous assignee, new assignee)
    // and resolve them in a single query instead of one query per record.
    const userIds = new Set<string>();
    for (const record of records) {
      userIds.add(record.actor.toString());
      if (record.metadata.from) {
        userIds.add(record.metadata.from);
      }
      if (record.metadata.to) {
        userIds.add(record.metadata.to);
      }
    }

    const users = await this.usersService.findManyByIds(
      [...userIds].map((id) => new Types.ObjectId(id)),
    );
    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    const summaryFor = (id: string | null) => {
      if (!id) {
        return null;
      }
      const user = usersById.get(id);
      return user ? toUserSummary(user) : null;
    };

    // flatmap and return on missing actor that will skips broken records instead of crashing
    return records.flatMap((record) => {
      const actor = usersById.get(record.actor.toString());
      if (!actor) {
        return [];
      }
      return [
        {
          id: record._id.toString(),
          type: record.type,
          task: record.task.toString(),
          actor: toUserSummary(actor),
          metadata: { from: record.metadata.from, to: record.metadata.to },
          from: summaryFor(record.metadata.from),
          to: summaryFor(record.metadata.to),
          createdAt: record.createdAt.toISOString(),
        },
      ];
    });
  }

  async updateStatus(taskId: Types.ObjectId, dto: UpdateTaskStatusDto): Promise<TaskDetail> {
    const task = await this.findTaskOrFail(taskId);
    task.status = dto.status;
    await task.save();

    return this.toDetail(task);
  }

  async remove(taskId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const task = await this.findTaskOrFail(taskId);
    await this.projectAccessService.assertCanManage(task.projectId, userId);

    await Promise.all([this.commentModel.deleteMany({ taskId: task._id }), task.deleteOne()]);
  }

  async findTaskOrFail(taskId: Types.ObjectId): Promise<TaskDocument> {
    const task = await this.taskModel.findById(taskId).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  private async toSummaries(tasks: TaskDocument[]): Promise<TaskSummary[]> {
    if (tasks.length === 0) {
      return [];
    }

    const [creators, commentRows] = await Promise.all([
      this.usersService.findManyByIds(tasks.map((task) => task.createdBy)),
      this.commentModel
        .aggregate<{
          _id: Types.ObjectId;
          count: number;
        }>([
          { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
          { $group: { _id: '$taskId', count: { $sum: 1 } } },
        ])
        .exec(),
    ]);

    const creatorsById = new Map(creators.map((user) => [user._id.toString(), user]));
    const commentCounts = new Map(commentRows.map((row) => [row._id.toString(), row.count]));

    return tasks.map((task) => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      number: task.number,
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      commentCount: commentCounts.get(task._id.toString()) ?? 0,
      createdBy: toCreatorSummary(creatorsById.get(task.createdBy.toString())),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
  }

  private async toDetail(task: TaskDocument, project?: ProjectDocument): Promise<TaskDetail> {
    const [summary] = await this.toSummaries([task]);
    const resolvedProject = project ?? (await this.projectModel.findById(task.projectId).exec());

    if (!resolvedProject) {
      throw new NotFoundException('Project not found');
    }

    return {
      ...summary!,
      description: task.description ?? null,
      project: {
        id: resolvedProject._id.toString(),
        name: resolvedProject.name,
        key: resolvedProject.key,
      },
    };
  }
}

const DELETED_USER = {
  id: '',
  name: 'Unknown user',
  email: '',
  avatarUrl: null,
};

function toCreatorSummary(user: Parameters<typeof toUserSummary>[0] | undefined) {
  return user ? toUserSummary(user) : DELETED_USER;
}