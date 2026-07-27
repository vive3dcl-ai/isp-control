import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
} from '../entities/calendar-event.entity';

export class CreateCalendarEventDto {
  @IsIn([...CALENDAR_EVENT_TYPES])
  type!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsIn([...CALENDAR_EVENT_STATUSES])
  status?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsIn([...CALENDAR_EVENT_TYPES])
  type?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsIn([...CALENDAR_EVENT_STATUSES])
  status?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}
