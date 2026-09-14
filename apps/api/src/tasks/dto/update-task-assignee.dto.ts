import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';

export class UpdateTaskAssigneeDto {
    @ValidateIf((_, value) => value !== null) // If user send null to unassign a task don't run IsMongoId let null pass as valid
    @IsOptional() // If user don't send assigneeId don't throw error because it's optional
    @IsMongoId() // if the client send a string that is not a valid mongo id throw error it should be valid 24 hex characters
    assigneeId?: string | null;
}