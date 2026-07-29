import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  FIELD_INSTALL_ROLES,
  TenantRoles,
} from '../auth/decorators/tenant-roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantRolesGuard } from '../auth/guards/tenant-roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { CalendarService } from './calendar.service';
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

@Controller('app/calendar')
@UseGuards(JwtAuthGuard, RolesGuard, TenantRolesGuard)
@Roles('tenant_user')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('events')
  list(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.calendar.list(user, from, to, { type, status });
  }

  @Get('events/day')
  listDay(@CurrentUser() user: AuthUser, @Query('day') day: string) {
    return this.calendar.listDay(user, day);
  }

  @Get('events/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.get(user, id);
  }

  @Post('events')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCalendarEventDto) {
    return this.calendar.create(user, dto);
  }

  @Patch('events/:id')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendar.update(user, id, dto);
  }

  @Delete('events/:id')
  @TenantRoles(...FIELD_INSTALL_ROLES)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.calendar.remove(user, id);
  }
}
