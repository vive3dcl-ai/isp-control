import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_SYSTEM, SystemJobName, SystemPingJob } from '../queue.constants';

@Processor(QUEUE_SYSTEM)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  // WorkerHost requires a Promise-returning processor method.
  // eslint-disable-next-line @typescript-eslint/require-await
  async process(job: Job<SystemPingJob, void, SystemJobName>): Promise<void> {
    this.logger.log(`system job ${job.name} #${job.id} at ${job.data.at}`);
  }
}
