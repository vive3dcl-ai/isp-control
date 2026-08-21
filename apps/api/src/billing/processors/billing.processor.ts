import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BillingJobPayload, QUEUE_BILLING } from '../../queues/queue.constants';
import { BillingService } from '../billing.service';

@Processor(QUEUE_BILLING)
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(private readonly billing: BillingService) {
    super();
  }

  async process(job: Job<BillingJobPayload>) {
    const { schemaName, job: jobName } = job.data;
    if (!schemaName) {
      throw new Error('Billing job missing schemaName (tenant isolation)');
    }

    this.logger.log(`Running ${jobName} for schema ${schemaName}`);

    switch (jobName) {
      case 'billing.periods':
        return this.billing.runMaintainPeriods(schemaName);
      case 'billing.generate': {
        const generated = await this.billing.runGenerateInvoices(schemaName);
        const cutoff = await this.billing.runOverdueCutoff(schemaName);
        return { ...generated, ...cutoff };
      }
      case 'billing.send':
        return this.billing.runSendInvoices(schemaName);
      default:
        throw new Error(`Unknown billing job: ${String(jobName)}`);
    }
  }
}
