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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SupportService } from './support.service';
import { PushService } from './push.service';
import {
  CreateSupportMessageDto,
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
} from './dto/support.dto';
import {
  RemovePushSubscriptionDto,
  UpsertPushSubscriptionDto,
} from './dto/push.dto';

@Controller('app')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_user')
export class SupportAppController {
  constructor(
    private readonly support: SupportService,
    private readonly push: PushService,
  ) {}

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

  @Get('push/vapid-public-key')
  vapidPublicKey() {
    return this.push.getPublicKey();
  }

  @Post('push/subscribe')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertPushSubscriptionDto,
  ) {
    return this.push.upsertSubscription(user, dto);
  }

  @Delete('push/subscribe')
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.push.removeSubscription(user, dto.endpoint);
  }

  @Get('support/tickets')
  listTickets(@CurrentUser() user: AuthUser) {
    return this.support.listTenantTickets(user);
  }

  @Post('support/tickets')
  createTicket(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.support.createTenantTicket(user, dto);
  }

  @Get('support/tickets/:id')
  getTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.getTenantTicket(user, id);
  }

  @Post('support/tickets/:id/messages')
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupportMessageDto,
  ) {
    return this.support.addTenantMessage(user, id, dto);
  }

  @Patch('support/tickets/:id')
  updateTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.support.updateTenantTicket(user, id, dto);
  }
}
