import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '../entities/support-ticket.entity';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsIn([...SUPPORT_TICKET_CATEGORIES])
  category!: (typeof SUPPORT_TICKET_CATEGORIES)[number];

  @IsOptional()
  @IsIn([...SUPPORT_TICKET_PRIORITIES])
  priority?: (typeof SUPPORT_TICKET_PRIORITIES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class CreateSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsIn([...SUPPORT_TICKET_STATUSES])
  status?: (typeof SUPPORT_TICKET_STATUSES)[number];

  @IsOptional()
  @IsIn([...SUPPORT_TICKET_PRIORITIES])
  priority?: (typeof SUPPORT_TICKET_PRIORITIES)[number];
}
