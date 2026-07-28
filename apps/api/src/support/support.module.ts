import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AppNotification } from './entities/app-notification.entity';
import { PushSubscriptionEntity } from './entities/push-subscription.entity';
import { SupportTicketMessage } from './entities/support-ticket-message.entity';
import { SupportTicket } from './entities/support-ticket.entity';
import { SupportService } from './support.service';
import { PushService } from './push.service';
import { SupportAppController } from './support.app.controller';
import { SupportAdminController } from './support.admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupportTicket,
      SupportTicketMessage,
      AppNotification,
      PushSubscriptionEntity,
      Tenant,
    ]),
  ],
  controllers: [SupportAppController, SupportAdminController],
  providers: [SupportService, PushService],
  exports: [SupportService, PushService],
})
export class SupportModule {}
