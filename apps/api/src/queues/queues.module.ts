import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueuesService } from './queues.service';
import { QueuesController } from './queues.controller';
import { SystemProcessor } from './processors/system.processor';
import { NetworkProcessor } from './processors/network.processor';
import { QUEUE_NETWORK, QUEUE_SYSTEM } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_SYSTEM }, { name: QUEUE_NETWORK }),
  ],
  controllers: [QueuesController],
  providers: [QueuesService, SystemProcessor, NetworkProcessor],
  exports: [QueuesService, BullModule],
})
export class QueuesModule {}
