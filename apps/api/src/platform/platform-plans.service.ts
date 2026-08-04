import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformSystemPlan } from './entities/platform-system-plan.entity';
import { PlatformBillingSettings } from './entities/platform-billing-settings.entity';
import {
  DEFAULT_EXTRA_BLOCK_PRICE_USD,
  DEFAULT_USER_PLAN_PRICES,
  EXTRA_USER_BLOCK_SIZE,
  USER_PLAN_TIERS,
  isUserPlanCode,
  type UserPlanCode,
} from './billing-cycles';
import { UpdateSystemPlansDto } from './dto/platform-subscription.dto';

@Injectable()
export class PlatformPlansService implements OnModuleInit {
  constructor(
    @InjectRepository(PlatformSystemPlan)
    private readonly plans: Repository<PlatformSystemPlan>,
    @InjectRepository(PlatformBillingSettings)
    private readonly billingSettings: Repository<PlatformBillingSettings>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensureDefaults();
  }

  /** DDL idempotente (prod tiene synchronize=false). */
  async ensureSchema() {
    await this.dataSource.query(`
      ALTER TABLE public.platform_system_plans
        ADD COLUMN IF NOT EXISTS "user_limit" int NOT NULL DEFAULT 0;
      ALTER TABLE public.platform_system_plans
        ADD COLUMN IF NOT EXISTS "sort_order" int NOT NULL DEFAULT 0;
      ALTER TABLE public.tenants
        ADD COLUMN IF NOT EXISTS "extra_user_blocks" int NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS public.platform_billing_settings (
        "id" int PRIMARY KEY,
        "extra_block_price_usd" numeric(12,2) NOT NULL DEFAULT 40,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async ensureDefaults() {
    // Quitar planes viejos por duración (monthly/quarterly/…)
    await this.plans
      .createQueryBuilder()
      .delete()
      .where('cycle IN (:...old)', {
        old: ['monthly', 'quarterly', 'semiannual', 'annual'],
      })
      .execute();

    for (const t of USER_PLAN_TIERS) {
      const existing = await this.plans.findOne({ where: { cycle: t.code } });
      if (existing) {
        existing.userLimit = t.userLimit;
        existing.sortOrder = t.sortOrder;
        existing.months = 1;
        existing.label = t.label;
        await this.plans.save(existing);
        continue;
      }
      await this.plans.save(
        this.plans.create({
          cycle: t.code,
          months: 1,
          label: t.label,
          userLimit: t.userLimit,
          sortOrder: t.sortOrder,
          priceUsd: DEFAULT_USER_PLAN_PRICES[t.code].toFixed(2),
          enabled: true,
        }),
      );
    }

    const settings = await this.billingSettings.findOne({ where: { id: 1 } });
    if (!settings) {
      await this.billingSettings.save(
        this.billingSettings.create({
          id: 1,
          extraBlockPriceUsd: DEFAULT_EXTRA_BLOCK_PRICE_USD.toFixed(2),
        }),
      );
    }

    // Tenants con ciclo antiguo → plan base 15 usuarios (sin bloques).
    await this.dataSource.query(`
      UPDATE public.tenants
      SET billing_cycle = 'users_15'
      WHERE billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')
    `);
  }

  async list() {
    await this.ensureDefaults();
    const rows = await this.plans.find({ order: { sortOrder: 'ASC' } });
    return rows
      .filter((r) => isUserPlanCode(r.cycle))
      .map((r) => this.serialize(r));
  }

  async getByCode(code: UserPlanCode) {
    await this.ensureDefaults();
    return this.plans.findOne({ where: { cycle: code } });
  }

  /** @deprecated Use getByCode */
  async getByCycle(cycle: string) {
    if (!isUserPlanCode(cycle)) return null;
    return this.getByCode(cycle);
  }

  async getExtraBlockPriceUsd(): Promise<number> {
    await this.ensureDefaults();
    const row = await this.billingSettings.findOne({ where: { id: 1 } });
    return Number(row?.extraBlockPriceUsd ?? DEFAULT_EXTRA_BLOCK_PRICE_USD);
  }

  async updateAll(dto: UpdateSystemPlansDto) {
    await this.ensureDefaults();
    for (const item of dto.plans) {
      if (!isUserPlanCode(item.code)) continue;
      const row = await this.plans.findOne({ where: { cycle: item.code } });
      if (!row) continue;
      row.priceUsd = Number(item.priceUsd).toFixed(2);
      row.enabled = item.enabled;
      await this.plans.save(row);
    }
    if (dto.extraBlockPriceUsd != null) {
      let settings = await this.billingSettings.findOne({ where: { id: 1 } });
      if (!settings) {
        settings = this.billingSettings.create({ id: 1 });
      }
      settings.extraBlockPriceUsd = Number(dto.extraBlockPriceUsd).toFixed(2);
      await this.billingSettings.save(settings);
    }
    return this.listAdmin();
  }

  async listAdmin() {
    const plans = await this.list();
    const extraBlockPriceUsd = await this.getExtraBlockPriceUsd();
    return {
      plans,
      extraBlockSize: EXTRA_USER_BLOCK_SIZE,
      extraBlockPriceUsd,
    };
  }

  private serialize(r: PlatformSystemPlan) {
    return {
      id: r.id,
      code: r.cycle as UserPlanCode,
      cycle: r.cycle as UserPlanCode, // alias compat UI antigua
      userLimit: r.userLimit,
      months: 1,
      label: r.label,
      priceUsd: Number(r.priceUsd),
      enabled: r.enabled,
      sortOrder: r.sortOrder,
    };
  }
}
