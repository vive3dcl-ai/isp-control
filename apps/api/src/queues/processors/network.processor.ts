import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NetworkJobName,
  NetworkJobPayload,
  QUEUE_NETWORK,
} from '../queue.constants';

/**
 * Placeholder worker for MikroTik / OLT jobs.
 * Real device adapters will be wired here later.
 */
@Processor(QUEUE_NETWORK)
export class NetworkProcessor extends WorkerHost {
  private readonly logger = new Logger(NetworkProcessor.name);

  // WorkerHost requires a Promise-returning processor method.
  // eslint-disable-next-line @typescript-eslint/require-await
  async process(
    job: Job<NetworkJobPayload, void, NetworkJobName>,
  ): Promise<void> {
    this.logger.log(
      `network job ${job.name} tenant=${job.data.tenantId} device=${job.data.deviceId ?? '-'}`,
    );
  }
}
