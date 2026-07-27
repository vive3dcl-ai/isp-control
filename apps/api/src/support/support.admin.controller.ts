import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SupportService } from './support.service';
import {
  CreateSupportMessageDto,
  UpdateSupportTicketDto,
} from './dto/support.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get('notifications/summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.support.summary(user);
  }

  @Get('notifications')
  listNotifications(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.support.listNotifications(
      user,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.support.markAllRead(user);
  }

  @Post('notifications/:id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.markRead(user, id);
  }

  @Get('support/tickets')
  listTickets(@Query('status') status?: string) {
    return this.support.listAdminTickets(status);
  }

  @Get('support/tickets/:id')
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.getAdminTicket(id);
  }

  @Post('support/tickets/:id/messages')
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupportMessageDto,
  ) {
    return this.support.addAdminMessage(user, id, dto);
  }

  @Patch('support/tickets/:id')
  updateTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.support.updateAdminTicket(id, dto);
  }
}
