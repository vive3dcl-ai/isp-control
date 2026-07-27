import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformAccess } from '../auth/decorators/roles.decorator';
import { QueuesService } from './queues.service';

@Controller('admin/queues')
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformAccess()
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  @Get('status')
  status() {
    return this.queues.getStatus();
  }

  @Post('ping')
  async ping() {
    const job = await this.queues.enqueueSystemPing();
    return { jobId: job.id, queue: 'system', name: 'health.ping' };
  }
}
