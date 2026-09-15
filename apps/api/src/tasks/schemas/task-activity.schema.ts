import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';
import { TaskActivityType, type TaskAssigneeChangedMetadata } from '@projectflow/shared';

// I do task activity schema seprate from task schema because task grows over task's life so keeping it separate will be clean and scalable so it can effort the largest datasets in the system


export type TaskActivityDocument = HydratedDocument<TaskActivity>;
// for activity is a log so it will never edited after creation so no need for updatedAt
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'task_activities' })
export class TaskActivity {
    @Prop({ type: Types.ObjectId, ref: 'Task', required: true, index: true })
    task: Types.ObjectId;

    @Prop({ type: String, enum: TaskActivityType, required: true })
    type: TaskActivityType;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    actor: Types.ObjectId;

    @Prop({ type: Object, required: true })
    metadata: TaskAssigneeChangedMetadata; // if more activity types get added later like comments-added, status-changed etc the field shape stays flexible without schema migration

    createdAt: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);


TaskActivitySchema.index({ task: 1, createdAt: -1 }); // all activities will be quired on task and sorted from newest to oldest

