import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSystemPlan } from './entities/platform-system-plan.entity';
import {
  BILLING_CYCLES,
  DEFAULT_SYSTEM_PLAN_PRICES,
  type BillingCycleId,
} from './billing-cycles';
import { UpdateSystemPlansDto } from './dto/platform-subscription.dto';

@Injectable()
export class PlatformPlansService implements OnModuleInit {
  constructor(
    @InjectRepository(PlatformSystemPlan)
    private readonly plans: Repository<PlatformSystemPlan>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    for (const c of BILLING_CYCLES) {
      const existing = await this.plans.findOne({ where: { cycle: c.id } });
      if (existing) continue;
      await this.plans.save(
        this.plans.create({
          cycle: c.id,
          months: c.months,
          label: c.label,
          priceUsd: DEFAULT_SYSTEM_PLAN_PRICES[c.id].toFixed(2),
          enabled: true,
        }),
      );
    }
  }

  async list() {
    await this.ensureDefaults();
    const rows = await this.plans.find({ order: { months: 'ASC' } });
    return rows.map((r) => this.serialize(r));
  }

  async getByCycle(cycle: BillingCycleId) {
    await this.ensureDefaults();
    return this.plans.findOne({ where: { cycle } });
  }

  async updateAll(dto: UpdateSystemPlansDto) {
    await this.ensureDefaults();
    for (const item of dto.plans) {
      const row = await this.plans.findOne({
        where: { cycle: item.cycle as BillingCycleId },
      });
      if (!row) continue;
      row.priceUsd = Number(item.priceUsd).toFixed(2);
      row.enabled = item.enabled;
      await this.plans.save(row);
    }
    return this.list();
  }

  private serialize(r: PlatformSystemPlan) {
    return {
      id: r.id,
      cycle: r.cycle,
      months: r.months,
      label: r.label,
      priceUsd: Number(r.priceUsd),
      enabled: r.enabled,
    };
  }
}
