import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * One document per sequence so _id is the sequence name 
 * sequence is incremented atomically via findOneAndUpdate this will prevents two concurrent task creations from getting the same number
 */
@Schema({ collection: 'counters' })
export class Counter {
    @Prop({ type: String })
    _id: string;

    @Prop({ required: true, default: 0 })
    seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);