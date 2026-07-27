import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PlatformModulePricing } from '../modules/entities/platform-module-pricing.entity';
import {
  getModuleDefinition,
  MODULE_CATALOG,
  normalizeEnabledModules,
  type ModuleId,
} from '../modules/module-catalog';
import { PlatformModuleContract } from './entities/platform-module-contract.entity';
import { PlatformCharge } from './entities/platform-charge.entity';
import { PlatformPlansService } from './platform-plans.service';
import {
  addMonthsUtc,
  daysBetweenUtc,
  getBillingCycle,
  isBillingCycleId,
  prorateToPeriodEnd,
  roundMoney,
  unusedPeriodCredit,
  type ModuleContractMode,
} from './billing-cycles';

@Injectable()
export class PlatformSubscriptionService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(PlatformModuleContract)
    private readonly contracts: Repository<PlatformModuleContract>,
    @InjectRepository(PlatformCharge)
    private readonly charges: Repository<PlatformCharge>,
    @InjectRepository(PlatformModulePricing)
    private readonly modulePricing: Repository<PlatformModulePricing>,
    private readonly plans: PlatformPlansService,
  ) {}

  async getSubscriptionForTenant(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    const plans = await this.plans.list();
    const recurring = await this.contracts.find({
      where: { tenantId, status: 'active', mode: 'recurring' },
    });
    const modulesMonthly = recurring.reduce(
      (sum, c) => sum + Number(c.monthlyPriceUsd),
      0,
    );
    const currentPlan = tenant.billingCycle
      ? plans.find((p) => p.cycle === tenant.billingCycle)
      : null;
    const cycleMonths = currentPlan?.months ?? 1;
    const usageEstimate =
      currentPlan != null
        ? roundMoney(
            Number(currentPlan.priceUsd) + modulesMonthly * cycleMonths,
          )
        : null;

    const charges = await this.listCharges(tenantId);
    const pendingRenewal = charges.find(
      (c) => c.status === 'pending' && c.kind === 'renewal',
    );

    const now = new Date();
    let daysUntilEnd: number | null = null;
    if (tenant.subscriptionPeriodEnd) {
      daysUntilEnd = daysBetweenUtc(now, tenant.subscriptionPeriodEnd);
      if (tenant.subscriptionPeriodEnd < now) {
        daysUntilEnd = -daysBetweenUtc(tenant.subscriptionPeriodEnd, now);
      }
    }

    return {
      billingCycle: tenant.billingCycle,
      status: tenant.subscriptionStatus,
      periodStart: tenant.subscriptionPeriodStart,
      periodEnd: tenant.subscriptionPeriodEnd,
      periodPriceUsd: tenant.subscriptionPeriodPriceUsd
        ? Number(tenant.subscriptionPeriodPriceUsd)
        : null,
      daysUntilEnd,
      plans: plans.filter((p) => p.enabled),
      recurringModules: recurring.map((c) => ({
        moduleId: c.moduleId,
        monthlyPriceUsd: Number(c.monthlyPriceUsd),
        name: getModuleDefinition(c.moduleId)?.name ?? c.moduleId,
      })),
      modulesMonthlyUsd: roundMoney(modulesMonthly),
      nextCycleEstimateUsd: usageEstimate,
      pendingChargeId: pendingRenewal?.id ?? null,
      charges,
    };
  }

  async listCharges(tenantId: string) {
    const rows = await this.charges.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((c) => this.serializeCharge(c));
  }

  serializeCharge(c: PlatformCharge) {
    const status =
      c.status === 'recorded' ? 'paid' : c.status;
    return {
      id: c.id,
      kind: c.kind,
      description: c.description,
      amountUsd: Number(c.amountUsd),
      status,
      coversFrom: c.coversFrom,
      coversTo: c.coversTo,
      dueAt: c.dueAt,
      paidAt: c.paidAt,
      createdAt: c.createdAt,
      canPay: status === 'pending',
    };
  }

  async quotePlanChange(tenantId: string, cycle: string) {
    if (!isBillingCycleId(cycle)) {
      throw new BadRequestException('Ciclo de facturación inválido');
    }
    const tenant = await this.requireTenant(tenantId);
    const plan = await this.plans.getByCycle(cycle);
    if (!plan || !plan.enabled) {
      throw new BadRequestException('Plan no disponible');
    }
    const newPrice = Number(plan.priceUsd);
    const now = new Date();
    let credit = 0;
    if (
      tenant.subscriptionPeriodStart &&
      tenant.subscriptionPeriodEnd &&
      tenant.subscriptionPeriodPriceUsd
    ) {
      credit = unusedPeriodCredit(
        Number(tenant.subscriptionPeriodPriceUsd),
        tenant.subscriptionPeriodStart,
        tenant.subscriptionPeriodEnd,
        now,
      );
    }
    const chargeUsd = roundMoney(Math.max(0, newPrice - credit));
    const periodStart = now;
    const periodEnd = addMonthsUtc(now, plan.months);
    return {
      cycle,
      label: plan.label,
      months: plan.months,
      newPriceUsd: newPrice,
      creditUsd: credit,
      chargeUsd,
      periodStart,
      periodEnd,
    };
  }

  async changePlan(tenantId: string, cycle: string) {
    const quote = await this.quotePlanChange(tenantId, cycle);
    const tenant = await this.requireTenant(tenantId);
    const now = new Date();
    if (quote.chargeUsd > 0) {
      await this.charges.save(
        this.charges.create({
          tenantId,
          kind: tenant.billingCycle ? 'plan_change' : 'initial',
          description: tenant.billingCycle
            ? `Cambio a plan ${quote.label}`
            : `Alta plan ${quote.label}`,
          amountUsd: quote.chargeUsd.toFixed(2),
          status: 'paid',
          coversFrom: quote.periodStart,
          coversTo: quote.periodEnd,
          paidAt: now,
          meta: {
            cycle: quote.cycle,
            creditUsd: quote.creditUsd,
            newPriceUsd: quote.newPriceUsd,
          },
        }),
      );
    }
    tenant.billingCycle = quote.cycle;
    tenant.subscriptionStatus = 'active';
    tenant.subscriptionPeriodStart = quote.periodStart;
    tenant.subscriptionPeriodEnd = quote.periodEnd;
    tenant.subscriptionPeriodPriceUsd = quote.newPriceUsd.toFixed(2);
    await this.tenants.save(tenant);
    return {
      ...quote,
      subscription: await this.getSubscriptionForTenant(tenantId),
    };
  }

  async getModuleMonthlyPrice(moduleId: string): Promise<number> {
    const def = getModuleDefinition(moduleId);
    if (!def?.billable) {
      throw new BadRequestException('Módulo no contratable');
    }
    const override = await this.modulePricing.findOne({
      where: { moduleId },
    });
    if (override?.priceMonthly != null) {
      return Number(override.priceMonthly);
    }
    return def.priceMonthly ?? 0;
  }

  async quoteModuleContract(
    tenantId: string,
    moduleId: string,
    mode: ModuleContractMode,
  ) {
    const tenant = await this.requireTenant(tenantId);
    const def = getModuleDefinition(moduleId);
    if (!def || !def.billable) {
      throw new BadRequestException('Módulo no contratable');
    }
    const country = (tenant.country || '').toUpperCase();
    if (
      def.availableCountries &&
      !def.availableCountries.includes(country)
    ) {
      throw new BadRequestException(
        'Este módulo no está disponible para el país de tu empresa',
      );
    }
    const active = await this.contracts.findOne({
      where: { tenantId, moduleId, status: 'active' },
    });
    if (active) {
      throw new BadRequestException('El módulo ya está contratado');
    }
    const monthly = await this.getModuleMonthlyPrice(moduleId);
    if (mode === 'one_time') {
      const starts = new Date();
      const expires = addMonthsUtc(starts, 1);
      return {
        mode,
        moduleId,
        name: def.name,
        monthlyPriceUsd: monthly,
        chargeUsd: monthly,
        chargeLabel: 'Pago único · 1 mes (ciclo independiente)',
        startsAt: starts,
        expiresAt: expires,
        note: 'Prepago de 1 mes, independiente de tu plan. Se avisará al admin 5 y 2 días antes del vencimiento.',
      };
    }
    if (
      !tenant.billingCycle ||
      !tenant.subscriptionPeriodStart ||
      !tenant.subscriptionPeriodEnd ||
      (tenant.subscriptionStatus !== 'active' &&
        tenant.subscriptionStatus !== 'past_due')
    ) {
      throw new BadRequestException(
        'Debes tener un plan de suscripción activo para agregar el módulo al plan. Ve a Empresa → Suscripción.',
      );
    }
    const cycleMeta = getBillingCycle(tenant.billingCycle);
    const months = cycleMeta?.months ?? 1;
    const fullCycleUsd = roundMoney(monthly * months);
    const now = new Date();
    const chargeUsd = prorateToPeriodEnd(
      fullCycleUsd,
      tenant.subscriptionPeriodStart,
      tenant.subscriptionPeriodEnd,
      now,
    );
    const daysLeft = daysBetweenUtc(now, tenant.subscriptionPeriodEnd);
    return {
      mode,
      moduleId,
      name: def.name,
      monthlyPriceUsd: monthly,
      chargeUsd,
      chargeLabel: `Prorrateo hasta fin de tu ciclo (${cycleMeta?.label ?? tenant.billingCycle})`,
      startsAt: now,
      expiresAt: tenant.subscriptionPeriodEnd,
      note: `Se cobra ahora lo que falta hasta el ${tenant.subscriptionPeriodEnd.toISOString().slice(0, 10)} (${daysLeft} día${daysLeft === 1 ? '' : 's'}). En el próximo ciclo se suma al cobro de renovación.`,
    };
  }

  async contractModule(
    tenantId: string,
    moduleId: string,
    mode: ModuleContractMode,
  ) {
    const quote = await this.quoteModuleContract(tenantId, moduleId, mode);
    const tenant = await this.requireTenant(tenantId);
    const now = new Date();

    await this.charges.save(
      this.charges.create({
        tenantId,
        kind: mode === 'one_time' ? 'module_one_time' : 'module_prorate',
        description: `Contrato ${quote.name} (${mode})`,
        amountUsd: quote.chargeUsd.toFixed(2),
        status: 'paid',
        paidAt: now,
        coversFrom: now,
        coversTo:
          mode === 'one_time'
            ? quote.expiresAt
            : (quote.expiresAt ?? tenant.subscriptionPeriodEnd),
        meta: {
          moduleId,
          mode,
          monthlyPriceUsd: quote.monthlyPriceUsd,
          billingCycle: tenant.billingCycle,
        },
      }),
    );

    const contract = await this.contracts.save(
      this.contracts.create({
        tenantId,
        moduleId,
        mode,
        status: 'active',
        monthlyPriceUsd: quote.monthlyPriceUsd.toFixed(2),
        chargedUsd: quote.chargeUsd.toFixed(2),
        startedAt: now,
        expiresAt: mode === 'one_time' ? quote.expiresAt : null,
      }),
    );

    const enabled = new Set(normalizeEnabledModules(tenant.enabledModules));
    enabled.add(moduleId as ModuleId);
    tenant.enabledModules = [...enabled];
    await this.tenants.save(tenant);

    return {
      contract: this.serializeContract(contract),
      quote,
      chargeUsd: quote.chargeUsd,
    };
  }

  async listActiveContracts(tenantId: string) {
    return this.contracts.find({
      where: { tenantId, status: 'active' },
    });
  }

  async expireDueContracts() {
    const now = new Date();
    const due = await this.contracts
      .createQueryBuilder('c')
      .where('c.status = :status', { status: 'active' })
      .andWhere('c.mode = :mode', { mode: 'one_time' })
      .andWhere('c.expires_at IS NOT NULL')
      .andWhere('c.expires_at <= :now', { now })
      .getMany();

    for (const c of due) {
      c.status = 'expired';
      await this.contracts.save(c);
      const still = await this.contracts.findOne({
        where: {
          tenantId: c.tenantId,
          moduleId: c.moduleId,
          status: 'active',
        },
      });
      if (!still) {
        const tenant = await this.tenants.findOne({
          where: { id: c.tenantId },
        });
        if (tenant) {
          const enabled = normalizeEnabledModules(tenant.enabledModules).filter(
            (id) => id !== c.moduleId,
          );
          tenant.enabledModules = enabled;
          await this.tenants.save(tenant);
        }
      }
    }
    return due.length;
  }

  async findContractsNeedingNotice(daysBefore: 5 | 2) {
    const now = new Date();
    const until = new Date(now.getTime() + daysBefore * 86_400_000);
    const qb = this.contracts
      .createQueryBuilder('c')
      .where('c.status = :status', { status: 'active' })
      .andWhere('c.mode = :mode', { mode: 'one_time' })
      .andWhere('c.expires_at IS NOT NULL')
      .andWhere('c.expires_at > :now', { now })
      .andWhere('c.expires_at <= :until', { until });
    if (daysBefore === 5) {
      qb.andWhere('c.notified_5d_at IS NULL');
    } else {
      qb.andWhere('c.notified_2d_at IS NULL');
    }
    return qb.getMany();
  }

  async markNotified(contractId: string, daysBefore: 5 | 2) {
    const c = await this.contracts.findOne({ where: { id: contractId } });
    if (!c) return;
    if (daysBefore === 5) c.notified5dAt = new Date();
    else c.notified2dAt = new Date();
    await this.contracts.save(c);
  }

  serializeContract(c: PlatformModuleContract) {
    return {
      id: c.id,
      moduleId: c.moduleId,
      mode: c.mode,
      status: c.status,
      monthlyPriceUsd: Number(c.monthlyPriceUsd),
      chargedUsd: Number(c.chargedUsd),
      startedAt: c.startedAt,
      expiresAt: c.expiresAt,
    };
  }

  /** Módulos del catálogo con estado de contrato (para Integraciones). */
  async catalogForTenantApp(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    const enabled = new Set(normalizeEnabledModules(tenant.enabledModules));
    const activeContracts = await this.listActiveContracts(tenantId);
    const byModule = new Map(activeContracts.map((c) => [c.moduleId, c]));
    const country = (tenant.country || '').toUpperCase();

    return MODULE_CATALOG.map((m) => {
      const contract = byModule.get(m.id);
      const available =
        !m.availableCountries || m.availableCountries.includes(country);
      const contracted = m.alwaysEnabled || enabled.has(m.id);
      /**
       * Admin habilita sin contrato → incluido (no facturable).
       * Tenant contrata → comprado (hay fila en platform_module_contracts).
       * alwaysEnabled (SMTP) → incluido.
       */
      const purchased = contracted && !!contract;
      const included =
        contracted && (m.alwaysEnabled || !contract);
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        alwaysEnabled: m.alwaysEnabled,
        billable: m.billable,
        available,
        contracted,
        included,
        purchased,
        contract: contract ? this.serializeContract(contract) : null,
        canContract: m.billable && available && !contracted,
        canConfigure: contracted && m.hasConfig !== false,
      };
    });
  }

  private async requireTenant(id: string) {
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /**
   * Genera cobros de renovación (pending) 15 días antes del vencimiento.
   */
  async generateUpcomingRenewals() {
    const now = new Date();
    const horizon = new Date(now.getTime() + 15 * 86_400_000);
    const tenants = await this.tenants.find({
      where: { status: 'active', subscriptionStatus: 'active' },
    });
    let created = 0;
    for (const tenant of tenants) {
      if (!tenant.billingCycle || !tenant.subscriptionPeriodEnd) continue;
      if (tenant.subscriptionPeriodEnd < now) {
        // Vencido sin pago → past_due
        if (tenant.subscriptionStatus !== 'past_due') {
          tenant.subscriptionStatus = 'past_due';
          await this.tenants.save(tenant);
        }
      }
      if (tenant.subscriptionPeriodEnd > horizon) continue;
      // Solo si estamos dentro de la ventana ≤15 días (incluye vencidos)
      const existing = await this.charges.findOne({
        where: {
          tenantId: tenant.id,
          kind: 'renewal',
          status: 'pending',
        },
      });
      if (existing) continue;

      // Evitar duplicar renovación ya pagada para el mismo dueAt
      const dueKey = tenant.subscriptionPeriodEnd.toISOString();
      const alreadyPaid = await this.charges
        .createQueryBuilder('c')
        .where('c.tenant_id = :tid', { tid: tenant.id })
        .andWhere('c.kind = :kind', { kind: 'renewal' })
        .andWhere("c.meta->>'sourcePeriodEnd' = :due", { due: dueKey })
        .getOne();
      if (alreadyPaid) continue;

      const plan = isBillingCycleId(tenant.billingCycle)
        ? await this.plans.getByCycle(tenant.billingCycle)
        : null;
      if (!plan) continue;

      const recurring = await this.contracts.find({
        where: { tenantId: tenant.id, status: 'active', mode: 'recurring' },
      });
      const modulesMonthly = recurring.reduce(
        (sum, c) => sum + Number(c.monthlyPriceUsd),
        0,
      );
      const amount = roundMoney(
        Number(plan.priceUsd) + modulesMonthly * plan.months,
      );
      const coversFrom = tenant.subscriptionPeriodEnd;
      const coversTo = addMonthsUtc(coversFrom, plan.months);

      await this.charges.save(
        this.charges.create({
          tenantId: tenant.id,
          kind: 'renewal',
          description: `Renovación ${plan.label} (+ módulos)`,
          amountUsd: amount.toFixed(2),
          status: 'pending',
          coversFrom,
          coversTo,
          dueAt: tenant.subscriptionPeriodEnd,
          meta: {
            cycle: plan.cycle,
            planPriceUsd: Number(plan.priceUsd),
            modulesMonthlyUsd: modulesMonthly,
            sourcePeriodEnd: dueKey,
          },
        }),
      );
      created += 1;
    }
    return created;
  }

  /** Avisos al admin del tenant cuando el cobro pending está a ≤5 / ≤2 días. */
  async findPendingRenewalsNeedingNotice(daysBefore: 5 | 2) {
    const now = new Date();
    const until = new Date(now.getTime() + daysBefore * 86_400_000);
    const qb = this.charges
      .createQueryBuilder('c')
      .where('c.status = :status', { status: 'pending' })
      .andWhere('c.kind = :kind', { kind: 'renewal' })
      .andWhere('c.due_at IS NOT NULL')
      .andWhere('c.due_at <= :until', { until });
    if (daysBefore === 5) {
      qb.andWhere('c.notified_5d_at IS NULL');
    } else {
      qb.andWhere('c.notified_2d_at IS NULL');
    }
    return qb.getMany();
  }

  async markChargeNotified(chargeId: string, daysBefore: 5 | 2) {
    const c = await this.charges.findOne({ where: { id: chargeId } });
    if (!c) return;
    if (daysBefore === 5) c.notified5dAt = new Date();
    else c.notified2dAt = new Date();
    await this.charges.save(c);
  }

  async payCharge(tenantId: string, chargeId: string) {
    const charge = await this.charges.findOne({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException('Cobro no encontrado');
    if (charge.status !== 'pending') {
      throw new BadRequestException('Este cobro ya no está pendiente');
    }

    const tenant = await this.requireTenant(tenantId);
    const now = new Date();
    charge.status = 'paid';
    charge.paidAt = now;
    await this.charges.save(charge);

    if (charge.kind === 'renewal') {
      const cycle =
        (charge.meta?.cycle as string) || tenant.billingCycle || 'monthly';
      const plan = isBillingCycleId(cycle)
        ? await this.plans.getByCycle(cycle)
        : null;
      const months = plan?.months ?? 1;
      const start =
        charge.coversFrom ??
        tenant.subscriptionPeriodEnd ??
        now;
      const end = charge.coversTo ?? addMonthsUtc(start, months);
      tenant.billingCycle = cycle;
      tenant.subscriptionStatus = 'active';
      tenant.subscriptionPeriodStart = start;
      tenant.subscriptionPeriodEnd = end;
      tenant.subscriptionPeriodPriceUsd = charge.amountUsd;
      await this.tenants.save(tenant);
    }

    return {
      charge: this.serializeCharge(charge),
      subscription: await this.getSubscriptionForTenant(tenantId),
    };
  }
}
