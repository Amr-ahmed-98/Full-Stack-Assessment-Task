import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Paginated, TaskDetail, TaskSummary } from '@projectflow/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { toObjectId } from '../common/utils/object-id';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskAssigneeDto } from './dto/update-task-assignee.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) { }

  @Get('projects/:projectId/tasks')
  findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<Paginated<TaskSummary>> {
    return this.tasksService.findByProject(
      toObjectId(projectId, 'project id'),
      toObjectId(userId, 'user id'),
      query,
    );
  }

  @Post('projects/:projectId/tasks')
  create(
    @Param('projectId') projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDetail> {
    return this.tasksService.create(
      toObjectId(projectId, 'project id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Get('tasks/:taskId')
  findOne(@Param('taskId') taskId: string, @CurrentUser('id') userId: string): Promise<TaskDetail> {
    return this.tasksService.findOne(toObjectId(taskId, 'task id'), toObjectId(userId, 'user id'));
  }

  @Patch('tasks/:taskId')
  update(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskDetail> {
    return this.tasksService.update(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Patch('tasks/:taskId/status')
  updateStatus(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<TaskDetail> {
    return this.tasksService.updateStatus(toObjectId(taskId, 'task id'), dto);
  }

  // I do a new endpoint for assignee that not geniric for three reasons
  // 1 - existing code already does this pattern for status and status have own DTO and own endpoint
  // 2 - for assignee it has own rules so mixing it with general update will make that method complex and hard to test in isolation 
  // 3 - one route doing one job
  @Patch('tasks/:taskId/assignee')
  updateAssignee(
    @Param('taskId') taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskAssigneeDto,
  ): Promise<TaskDetail> {
    return this.tasksService.updateAssignee(
      toObjectId(taskId, 'task id'),
      toObjectId(userId, 'user id'),
      dto,
    );
  }

  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('taskId') taskId: string, @CurrentUser('id') userId: string): Promise<void> {
    return this.tasksService.remove(toObjectId(taskId, 'task id'), toObjectId(userId, 'user id'));
  }
}