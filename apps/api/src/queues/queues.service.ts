import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NetworkJobName,
  NetworkJobPayload,
  QUEUE_NETWORK,
  QUEUE_SYSTEM,
  SystemPingJob,
} from './queue.constants';

@Injectable()
export class QueuesService {
  constructor(
    @InjectQueue(QUEUE_SYSTEM) private readonly systemQueue: Queue,
    @InjectQueue(QUEUE_NETWORK) private readonly networkQueue: Queue,
  ) {}

  enqueueSystemPing() {
    const payload: SystemPingJob = { at: new Date().toISOString() };
    return this.systemQueue.add('health.ping', payload, {
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  enqueueNetworkJob(name: NetworkJobName, data: NetworkJobPayload) {
    return this.networkQueue.add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  async getStatus() {
    const [systemCounts, networkCounts] = await Promise.all([
      this.systemQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      ),
      this.networkQueue.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      ),
    ]);

    return {
      redis: 'ok',
      queues: {
        system: systemCounts,
        network: networkCounts,
      },
    };
  }
}
