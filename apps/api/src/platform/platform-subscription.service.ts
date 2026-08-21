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
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  EXTRA_USER_BLOCK_SIZE,
  LIFETIME_PERIOD_END,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_INVOICE_LEAD_DAYS,
  addMonthsUtc,
  anniversaryPeriodEnd,
  daysBetweenUtc,
  isLifetimePlanCode,
  isSubscriptionPastGrace,
  isUserPlanCode,
  monthlyRecurringUsd,
  nextAnniversaryPeriod,
  onuCapacity,
  prorateToPeriodEnd,
  roundMoney,
  subscriptionAccessFromDueAt,
  subscriptionInvoiceIssueAt,
  unusedPeriodCredit,
  type ModuleContractMode,
  type UserPlanCode,
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
    private readonly tenantConnections: TenantConnectionService,
  ) {}

  async countTenantOnus(tenant: Tenant): Promise<number> {
    try {
      const onuRepo = await this.tenantConnections.getOnuRepository(
        tenant.schemaName,
      );
      return onuRepo.count();
    } catch {
      return 0;
    }
  }

  async getSubscriptionForTenant(tenantId: string) {
    const tenant = await this.requireTenant(tenantId);
    if (tenant.isInternalCompany && tenant.subscriptionStatus !== 'active') {
      tenant.subscriptionStatus = 'active';
      await this.tenants.save(tenant);
    }

    const plans = await this.plans.list();
    const blockPrice = await this.plans.getExtraBlockPriceUsd();
    const extraBlocks = Math.max(0, tenant.extraUserBlocks ?? 0);
    const currentPlan = tenant.billingCycle
      ? plans.find((p) => p.code === tenant.billingCycle)
      : null;
    const lifetime = isLifetimePlanCode(tenant.billingCycle);

    const recurring = await this.contracts.find({
      where: { tenantId, status: 'active', mode: 'recurring' },
    });
    const modulesMonthly = recurring.reduce(
      (sum, c) => sum + Number(c.monthlyPriceUsd),
      0,
    );

    const planMonthly =
      currentPlan && !lifetime
        ? currentPlan.isFree
          ? 0
          : Number(currentPlan.priceUsd)
        : 0;
    const blocksMonthly =
      lifetime || tenant.isInternalCompany ? 0 : extraBlocks * blockPrice;
    const baseMonthly =
      currentPlan && !lifetime && !tenant.isInternalCompany
        ? monthlyRecurringUsd(planMonthly, extraBlocks, blockPrice)
        : 0;
    const nextMonthEstimate =
      currentPlan && !lifetime && !tenant.isInternalCompany
        ? roundMoney(baseMonthly + modulesMonthly)
        : null;

    const onuUsed = await this.countTenantOnus(tenant);
    const onuLimit = currentPlan
      ? onuCapacity(currentPlan.userLimit, extraBlocks)
      : null;

    const charges = tenant.isInternalCompany
      ? []
      : await this.listCharges(tenantId);
    const pendingRenewal = charges.find(
      (c) => c.status === 'pending' && c.kind === 'renewal',
    );

    const now = new Date();
    let daysUntilEnd: number | null = null;
    if (
      !lifetime &&
      !tenant.isInternalCompany &&
      tenant.subscriptionPeriodEnd
    ) {
      daysUntilEnd = daysBetweenUtc(now, tenant.subscriptionPeriodEnd);
      if (tenant.subscriptionPeriodEnd < now) {
        daysUntilEnd = -daysBetweenUtc(tenant.subscriptionPeriodEnd, now);
      }
    }

    const dueAt = pendingRenewal?.dueAt
      ? new Date(pendingRenewal.dueAt)
      : null;
    const access = subscriptionAccessFromDueAt(dueAt, now);
    const invoiceOverdue =
      !tenant.isInternalCompany && !!pendingRenewal && access.invoiceOverdue;
    const accessBlocked =
      !tenant.isInternalCompany && !!pendingRenewal && access.accessBlocked;

    const displayStatus = tenant.isInternalCompany
      ? 'internal'
      : lifetime && tenant.subscriptionStatus === 'active'
        ? 'lifetime'
        : accessBlocked || invoiceOverdue
          ? 'past_due'
          : tenant.subscriptionStatus === 'past_due' && !pendingRenewal
            ? 'active'
            : tenant.subscriptionStatus;

    return {
      planCode: tenant.billingCycle,
      billingCycle: tenant.billingCycle, // alias
      status: displayStatus,
      subscriptionStatus: tenant.subscriptionStatus,
      isInternalCompany: !!tenant.isInternalCompany,
      isLifetime: lifetime,
      periodStart: tenant.subscriptionPeriodStart,
      periodEnd: tenant.isInternalCompany
        ? null
        : lifetime
          ? null
          : tenant.subscriptionPeriodEnd,
      periodPriceUsd: tenant.subscriptionPeriodPriceUsd
        ? Number(tenant.subscriptionPeriodPriceUsd)
        : null,
      daysUntilEnd,
      plans: plans.filter((p) => p.enabled),
      extraBlocks,
      extraBlockSize: EXTRA_USER_BLOCK_SIZE,
      extraBlockPriceUsd: blockPrice,
      onuUsed,
      onuLimit,
      planMonthlyUsd: planMonthly || null,
      blocksMonthlyUsd: roundMoney(blocksMonthly),
      baseMonthlyUsd: baseMonthly || null,
      recurringModules: recurring.map((c) => ({
        moduleId: c.moduleId,
        monthlyPriceUsd: Number(c.monthlyPriceUsd),
        name: getModuleDefinition(c.moduleId)?.name ?? c.moduleId,
      })),
      modulesMonthlyUsd: roundMoney(modulesMonthly),
      nextCycleEstimateUsd: nextMonthEstimate,
      pendingChargeId: pendingRenewal?.id ?? null,
      pendingCharge: pendingRenewal ?? null,
      invoiceOverdue,
      accessBlocked,
      graceEndsAt:
        pendingRenewal && (invoiceOverdue || accessBlocked)
          ? access.graceEndsAt
          : pendingRenewal && dueAt
            ? access.graceEndsAt
            : null,
      graceDays: SUBSCRIPTION_GRACE_DAYS,
      invoiceLeadDays: SUBSCRIPTION_INVOICE_LEAD_DAYS,
      daysUntilDue: pendingRenewal ? access.daysUntilDue : null,
      daysOverdue: invoiceOverdue ? access.daysOverdue : null,
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
    const status = c.status === 'recorded' ? 'paid' : c.status;
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

  async quotePlanChange(tenantId: string, code: string) {
    if (!isUserPlanCode(code)) {
      throw new BadRequestException('Plan inválido');
    }
    const tenant = await this.requireTenant(tenantId);
    if (tenant.isInternalCompany) {
      throw new BadRequestException(
        'Esta es una empresa interna de ISP Control; no requiere cambio de plan',
      );
    }
    const plan = await this.plans.getByCode(code);
    if (!plan || !plan.enabled) {
      throw new BadRequestException('Plan no disponible');
    }
    const blockPrice = await this.plans.getExtraBlockPriceUsd();
    const extraBlocks = Math.max(0, tenant.extraUserBlocks ?? 0);
    const onuUsed = await this.countTenantOnus(tenant);
    const newCapacity = onuCapacity(plan.userLimit, extraBlocks);
    if (onuUsed > newCapacity) {
      throw new BadRequestException(
        `No puedes pasar a ${plan.label}: tienes ${onuUsed} ONUs y el cupo sería ${newCapacity}`,
      );
    }

    const now = new Date();
    const lifetime = isLifetimePlanCode(code);
    const periodEnd = lifetime ? LIFETIME_PERIOD_END : anniversaryPeriodEnd(now);
    const planPrice = this.plans.effectivePriceUsd(plan);
    const newMonthly = lifetime
      ? 0
      : monthlyRecurringUsd(planPrice, extraBlocks, blockPrice);

    let credit = 0;
    if (
      tenant.subscriptionPeriodStart &&
      tenant.subscriptionPeriodEnd &&
      tenant.subscriptionPeriodPriceUsd &&
      (tenant.subscriptionStatus === 'active' ||
        tenant.subscriptionStatus === 'past_due') &&
      !isLifetimePlanCode(tenant.billingCycle)
    ) {
      credit = unusedPeriodCredit(
        Number(tenant.subscriptionPeriodPriceUsd),
        tenant.subscriptionPeriodStart,
        tenant.subscriptionPeriodEnd,
        now,
      );
    }

    let chargeUsd: number;
    if (lifetime) {
      chargeUsd = roundMoney(Math.max(0, planPrice - credit));
    } else {
      // Ciclo aniversario completo desde hoy; crédito del período anterior.
      chargeUsd = roundMoney(Math.max(0, newMonthly - credit));
    }
    const freePlan = !!plan.isFree && planPrice === 0;

    return {
      code: code,
      label: plan.label,
      userLimit: plan.userLimit,
      extraBlocks,
      onuUsed,
      onuLimit: newCapacity,
      newMonthlyUsd: newMonthly,
      creditUsd: credit,
      chargeUsd,
      periodStart: now,
      periodEnd,
      isLifetime: lifetime,
      note: freePlan
        ? 'Plan gratis: el sistema queda activo con el cupo del plan. No se genera cobro pendiente (queda registro en $0).'
        : lifetime
          ? 'Pago único Lifetime: sin renovaciones mensuales. El cupo queda activo de forma permanente.'
          : `Ciclo mensual por aniversario de contrato. La renovación se factura ${SUBSCRIPTION_INVOICE_LEAD_DAYS} días antes del vencimiento; tienes ${SUBSCRIPTION_GRACE_DAYS} días de gracia tras vencer.`,
    };
  }

  async changePlan(tenantId: string, code: string) {
    const quote = await this.quotePlanChange(tenantId, code);
    const tenant = await this.requireTenant(tenantId);
    const now = new Date();
    const isFreeActivation = quote.chargeUsd <= 0;
    await this.charges.save(
      this.charges.create({
        tenantId,
        kind: tenant.billingCycle ? 'plan_change' : 'initial',
        description: tenant.billingCycle
          ? isFreeActivation
            ? `Cambio a plan ${quote.label} (gratis)`
            : isLifetimePlanCode(quote.code)
              ? `Cambio a plan ${quote.label} (pago único)`
              : `Cambio a plan ${quote.label}`
          : isFreeActivation
            ? `Alta plan ${quote.label} (gratis)`
            : isLifetimePlanCode(quote.code)
              ? `Alta plan ${quote.label} (pago único)`
              : `Alta plan ${quote.label}`,
        amountUsd: Math.max(0, quote.chargeUsd).toFixed(2),
        status: 'paid',
        coversFrom: quote.periodStart,
        coversTo: quote.periodEnd,
        paidAt: now,
        meta: {
          code: quote.code,
          creditUsd: quote.creditUsd,
          newMonthlyUsd: quote.newMonthlyUsd,
          extraBlocks: quote.extraBlocks,
          isFree: isFreeActivation,
          isLifetime: isLifetimePlanCode(quote.code),
        },
      }),
    );
    tenant.billingCycle = quote.code;
    tenant.subscriptionStatus = 'active';
    tenant.subscriptionPeriodStart = quote.periodStart;
    tenant.subscriptionPeriodEnd = quote.periodEnd;
    tenant.subscriptionPeriodPriceUsd = (
      isLifetimePlanCode(quote.code) ? quote.chargeUsd : quote.newMonthlyUsd
    ).toFixed(2);
    await this.tenants.save(tenant);
    return {
      ...quote,
      subscription: await this.getSubscriptionForTenant(tenantId),
    };
  }

  async quoteExtraBlocks(tenantId: string, blocks: number) {
    if (!Number.isInteger(blocks) || blocks < 0) {
      throw new BadRequestException('Cantidad de bloques inválida');
    }
    const tenant = await this.requireTenant(tenantId);
    if (
      !tenant.billingCycle ||
      !isUserPlanCode(tenant.billingCycle) ||
      isLifetimePlanCode(tenant.billingCycle) ||
      tenant.isInternalCompany ||
      (tenant.subscriptionStatus !== 'active' &&
        tenant.subscriptionStatus !== 'past_due')
    ) {
      throw new BadRequestException(
        tenant.isInternalCompany || isLifetimePlanCode(tenant.billingCycle)
          ? 'Este plan no admite bloques extra de cobro mensual'
          : 'Necesitas un plan activo para ajustar usuarios extra',
      );
    }
    const plan = await this.plans.getByCode(tenant.billingCycle);
    if (!plan) throw new BadRequestException('Plan no encontrado');

    const blockPrice = await this.plans.getExtraBlockPriceUsd();
    const currentBlocks = Math.max(0, tenant.extraUserBlocks ?? 0);
    const onuUsed = await this.countTenantOnus(tenant);
    const newCapacity = onuCapacity(plan.userLimit, blocks);
    if (onuUsed > newCapacity) {
      throw new BadRequestException(
        `No puedes bajar a ${blocks} bloque(s): tienes ${onuUsed} ONUs y el cupo sería ${newCapacity}`,
      );
    }

    const delta = blocks - currentBlocks;
    const now = new Date();
    const periodEnd =
      tenant.subscriptionPeriodEnd && tenant.subscriptionPeriodEnd > now
        ? tenant.subscriptionPeriodEnd
        : anniversaryPeriodEnd(now);
    const periodStart = tenant.subscriptionPeriodStart ?? now;

    let chargeUsd = 0;
    let creditUsd = 0;
    if (delta > 0) {
      chargeUsd = prorateToPeriodEnd(
        delta * blockPrice,
        periodStart,
        periodEnd,
        now,
      );
    } else if (delta < 0) {
      const removeMonthly = Math.abs(delta) * blockPrice;
      creditUsd = unusedPeriodCredit(
        removeMonthly,
        periodStart,
        periodEnd,
        now,
      );
    }

    const newMonthly = monthlyRecurringUsd(
      this.plans.effectivePriceUsd(plan),
      blocks,
      blockPrice,
    );

    return {
      currentBlocks,
      blocks,
      delta,
      extraBlockSize: EXTRA_USER_BLOCK_SIZE,
      extraBlockPriceUsd: blockPrice,
      onuUsed,
      onuLimit: newCapacity,
      chargeUsd,
      creditUsd,
      newMonthlyUsd: newMonthly,
      periodEnd,
      note:
        delta > 0
          ? `Se cobra el prorrateo de ${delta} bloque(s) hasta el fin del ciclo (${periodEnd.toISOString().slice(0, 10)}).`
          : delta < 0
            ? `Se acredita el valor no usado de ${Math.abs(delta)} bloque(s).`
            : 'Sin cambios.',
    };
  }

  async adjustExtraBlocks(tenantId: string, blocks: number) {
    const quote = await this.quoteExtraBlocks(tenantId, blocks);
    if (quote.delta === 0) {
      return {
        ...quote,
        subscription: await this.getSubscriptionForTenant(tenantId),
      };
    }
    const tenant = await this.requireTenant(tenantId);
    const now = new Date();
    const net = roundMoney(quote.chargeUsd - quote.creditUsd);

    if (net !== 0 || quote.delta !== 0) {
      await this.charges.save(
        this.charges.create({
          tenantId,
          kind: quote.delta > 0 ? 'extra_blocks_add' : 'extra_blocks_remove',
          description:
            quote.delta > 0
              ? `+${quote.delta} bloque(s) de ${EXTRA_USER_BLOCK_SIZE} usuarios`
              : `−${Math.abs(quote.delta)} bloque(s) de ${EXTRA_USER_BLOCK_SIZE} usuarios`,
          amountUsd: Math.max(0, net).toFixed(2),
          status: 'paid',
          coversFrom: now,
          coversTo: quote.periodEnd,
          paidAt: now,
          meta: {
            fromBlocks: quote.currentBlocks,
            toBlocks: quote.blocks,
            delta: quote.delta,
            creditUsd: quote.creditUsd,
            chargeUsd: quote.chargeUsd,
          },
        }),
      );
    }

    tenant.extraUserBlocks = quote.blocks;
    // Actualizar precio del período corriente (base mensual completa para crédito futuro)
    tenant.subscriptionPeriodPriceUsd = quote.newMonthlyUsd.toFixed(2);
    if (!tenant.subscriptionPeriodEnd || tenant.subscriptionPeriodEnd < now) {
      tenant.subscriptionPeriodStart = now;
      tenant.subscriptionPeriodEnd = anniversaryPeriodEnd(now);
    }
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
    if (def.availableCountries && !def.availableCountries.includes(country)) {
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
        'Debes tener un plan de suscripción activo para agregar el módulo a la factura de servicio. Ve a Empresa → Suscripción.',
      );
    }
    const now = new Date();
    // Contratación en cualquier momento del ciclo: prorrateo desde hoy
    // hasta el fin del período de servicio actual (o +1 mes aniversario si ya venció).
    let periodStart = tenant.subscriptionPeriodStart;
    let periodEnd = tenant.subscriptionPeriodEnd;
    let chargeUsd: number;
    if (periodEnd <= now) {
      periodStart = now;
      periodEnd = anniversaryPeriodEnd(now);
      chargeUsd = prorateToPeriodEnd(monthly, periodStart, periodEnd, now);
    } else {
      chargeUsd = prorateToPeriodEnd(monthly, periodStart, periodEnd, now);
    }
    const daysLeft = Math.max(1, daysBetweenUtc(now, periodEnd));
    return {
      mode,
      moduleId,
      name: def.name,
      monthlyPriceUsd: monthly,
      chargeUsd,
      chargeLabel: 'Factura de servicio · prorrateo desde hoy',
      startsAt: now,
      expiresAt: periodEnd,
      note: `Puedes contratarlo en cualquier momento. Se suma a la factura de servicio el prorrateo desde hoy hasta el ${periodEnd.toISOString().slice(0, 10)} (${daysLeft} día${daysLeft === 1 ? '' : 's'}). En la próxima renovación del plan se cobra el mes completo del módulo.`,
    };
  }

  /**
   * Suma el prorrateo del módulo a una factura de servicio pendiente del mismo
   * período (varias contrataciones el mismo ciclo), o crea una nueva.
   * No mezcla con renovaciones del ciclo siguiente.
   */
  private async addModuleToServiceInvoice(
    tenantId: string,
    quote: {
      moduleId: string;
      name: string;
      chargeUsd: number;
      monthlyPriceUsd: number;
      expiresAt: Date | string | null | undefined;
    },
  ) {
    const now = new Date();
    const coversTo =
      quote.expiresAt instanceof Date
        ? quote.expiresAt
        : quote.expiresAt
          ? new Date(quote.expiresAt)
          : anniversaryPeriodEnd(now);
    const coversToKey = coversTo.toISOString().slice(0, 10);

    const candidates = await this.charges.find({
      where: [
        { tenantId, status: 'pending', kind: 'service' },
        { tenantId, status: 'pending', kind: 'initial' },
        { tenantId, status: 'pending', kind: 'plan_change' },
      ],
      order: { createdAt: 'DESC' },
    });

    const pending = candidates.find((c) => {
      if (!c.coversTo) return c.kind === 'service';
      return c.coversTo.toISOString().slice(0, 10) === coversToKey;
    });

    const line = {
      moduleId: quote.moduleId,
      name: quote.name,
      prorateUsd: quote.chargeUsd,
      monthlyPriceUsd: quote.monthlyPriceUsd,
      contractedAt: now.toISOString(),
    };

    if (pending) {
      const nextAmount = roundMoney(
        Number(pending.amountUsd) + quote.chargeUsd,
      );
      pending.amountUsd = nextAmount.toFixed(2);
      const modules = Array.isArray(pending.meta?.modules)
        ? [...(pending.meta.modules as unknown[])]
        : [];
      modules.push(line);
      pending.meta = {
        ...pending.meta,
        modules,
        isServiceInvoice: true,
      };
      if (!/factura de servicio/i.test(pending.description)) {
        pending.description = `Factura de servicio · ${pending.description}`;
      }
      pending.description = `${pending.description} + ${quote.name}`;
      if (!pending.coversTo) pending.coversTo = coversTo;
      if (!pending.coversFrom) pending.coversFrom = now;
      return this.charges.save(pending);
    }

    const amount = Math.max(0, quote.chargeUsd);
    return this.charges.save(
      this.charges.create({
        tenantId,
        kind: 'service',
        description: `Factura de servicio · ${quote.name} (prorrateo)`,
        amountUsd: amount.toFixed(2),
        status: amount > 0 ? 'pending' : 'paid',
        paidAt: amount > 0 ? null : now,
        coversFrom: now,
        coversTo,
        dueAt: coversTo,
        meta: {
          isServiceInvoice: true,
          modules: [line],
        },
      }),
    );
  }

  async contractModule(
    tenantId: string,
    moduleId: string,
    mode: ModuleContractMode,
  ) {
    const quote = await this.quoteModuleContract(tenantId, moduleId, mode);
    const tenant = await this.requireTenant(tenantId);
    const now = new Date();

    if (mode === 'one_time') {
      await this.charges.save(
        this.charges.create({
          tenantId,
          kind: 'module_one_time',
          description: `Contrato ${quote.name} (pago único)`,
          amountUsd: quote.chargeUsd.toFixed(2),
          status: quote.chargeUsd > 0 ? 'pending' : 'paid',
          paidAt: quote.chargeUsd > 0 ? null : now,
          coversFrom: now,
          coversTo: quote.expiresAt ?? null,
          dueAt: quote.expiresAt ?? null,
          meta: {
            moduleId,
            mode,
            monthlyPriceUsd: quote.monthlyPriceUsd,
          },
        }),
      );
    } else {
      await this.addModuleToServiceInvoice(tenantId, {
        moduleId: quote.moduleId,
        name: quote.name,
        chargeUsd: quote.chargeUsd,
        monthlyPriceUsd: quote.monthlyPriceUsd,
        expiresAt: quote.expiresAt,
      });
    }

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
      const purchased = contracted && !!contract;
      const included = contracted && (m.alwaysEnabled || !contract);
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

  /** Renovaciones mensuales (pending) 10 días antes del aniversario de contrato. */
  async generateUpcomingRenewals() {
    const now = new Date();
    const tenants = await this.tenants.find({
      where: [
        { status: 'active', subscriptionStatus: 'active' },
        { status: 'active', subscriptionStatus: 'past_due' },
      ],
    });
    let created = 0;
    const blockPrice = await this.plans.getExtraBlockPriceUsd();

    for (const tenant of tenants) {
      if (tenant.isInternalCompany) {
        if (tenant.subscriptionStatus !== 'active') {
          tenant.subscriptionStatus = 'active';
          await this.tenants.save(tenant);
        }
        continue;
      }
      if (!tenant.billingCycle || !tenant.subscriptionPeriodEnd) continue;
      if (!isUserPlanCode(tenant.billingCycle)) continue;
      if (isLifetimePlanCode(tenant.billingCycle)) {
        if (tenant.subscriptionStatus !== 'active') {
          tenant.subscriptionStatus = 'active';
          await this.tenants.save(tenant);
        }
        continue;
      }

      const plan = await this.plans.getByCode(tenant.billingCycle);
      if (!plan) continue;

      const extraBlocks = Math.max(0, tenant.extraUserBlocks ?? 0);
      const recurring = await this.contracts.find({
        where: { tenantId: tenant.id, status: 'active', mode: 'recurring' },
      });
      const modulesMonthly = recurring.reduce(
        (sum, c) => sum + Number(c.monthlyPriceUsd),
        0,
      );
      const baseMonthly = monthlyRecurringUsd(
        this.plans.effectivePriceUsd(plan),
        extraBlocks,
        blockPrice,
      );
      const amount = roundMoney(baseMonthly + modulesMonthly);
      const periodEnd = tenant.subscriptionPeriodEnd;
      const dueKey = periodEnd.toISOString();
      const issueAt = subscriptionInvoiceIssueAt(periodEnd);
      const { coversFrom, coversTo } = nextAnniversaryPeriod(periodEnd);

      // Plan / ciclo en $0: mantener activo con el límite, sin cobro pending.
      // Al vencer (o ya vencido), renueva con factura $0 pagada automáticamente.
      if (amount <= 0) {
        if (periodEnd > now) continue;

        const alreadyPaid = await this.charges
          .createQueryBuilder('c')
          .where('c.tenant_id = :tid', { tid: tenant.id })
          .andWhere('c.kind = :kind', { kind: 'renewal' })
          .andWhere("c.meta->>'sourcePeriodEnd' = :due", { due: dueKey })
          .getOne();
        if (alreadyPaid) {
          if (tenant.subscriptionStatus !== 'active') {
            tenant.subscriptionStatus = 'active';
            await this.tenants.save(tenant);
          }
          continue;
        }

        await this.charges.save(
          this.charges.create({
            tenantId: tenant.id,
            kind: 'renewal',
            description: `Renovación ${plan.label} (gratis)`,
            amountUsd: '0.00',
            status: 'paid',
            coversFrom,
            coversTo,
            dueAt: periodEnd,
            paidAt: now,
            meta: {
              code: plan.cycle,
              planPriceUsd: 0,
              extraBlocks,
              blockPriceUsd: blockPrice,
              modulesMonthlyUsd: modulesMonthly,
              sourcePeriodEnd: dueKey,
              isFree: true,
            },
          }),
        );
        tenant.subscriptionStatus = 'active';
        tenant.subscriptionPeriodStart = coversFrom;
        tenant.subscriptionPeriodEnd = coversTo;
        tenant.subscriptionPeriodPriceUsd = '0.00';
        await this.tenants.save(tenant);
        created += 1;
        continue;
      }

      const existing = await this.charges.findOne({
        where: {
          tenantId: tenant.id,
          kind: 'renewal',
          status: 'pending',
        },
      });

      if (existing?.dueAt && isSubscriptionPastGrace(existing.dueAt, now)) {
        if (tenant.subscriptionStatus !== 'past_due') {
          tenant.subscriptionStatus = 'past_due';
          await this.tenants.save(tenant);
        }
      } else if (
        existing &&
        tenant.subscriptionStatus === 'past_due' &&
        existing.dueAt &&
        !isSubscriptionPastGrace(existing.dueAt, now)
      ) {
        // Aún en gracia: no forzar past_due persistido si no aplica; se mantiene active.
        tenant.subscriptionStatus = 'active';
        await this.tenants.save(tenant);
      }

      if (existing) continue;
      if (now < issueAt) continue;

      const alreadyPaid = await this.charges
        .createQueryBuilder('c')
        .where('c.tenant_id = :tid', { tid: tenant.id })
        .andWhere('c.kind = :kind', { kind: 'renewal' })
        .andWhere("c.meta->>'sourcePeriodEnd' = :due", { due: dueKey })
        .getOne();
      if (alreadyPaid) continue;

      await this.charges.save(
        this.charges.create({
          tenantId: tenant.id,
          kind: 'renewal',
          description: `Renovación ${plan.label} (+ extras/módulos)`,
          amountUsd: amount.toFixed(2),
          status: 'pending',
          coversFrom,
          coversTo,
          dueAt: periodEnd,
          meta: {
            code: plan.cycle,
            planPriceUsd: this.plans.effectivePriceUsd(plan),
            extraBlocks,
            blockPriceUsd: blockPrice,
            modulesMonthlyUsd: modulesMonthly,
            sourcePeriodEnd: dueKey,
            graceDays: SUBSCRIPTION_GRACE_DAYS,
            leadDays: SUBSCRIPTION_INVOICE_LEAD_DAYS,
          },
        }),
      );
      if (isSubscriptionPastGrace(periodEnd, now)) {
        if (tenant.subscriptionStatus !== 'past_due') {
          tenant.subscriptionStatus = 'past_due';
          await this.tenants.save(tenant);
        }
      }
      created += 1;
    }
    return created;
  }

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
      const code =
        (charge.meta?.code as string) || tenant.billingCycle || 'users_15';
      const start =
        charge.coversFrom ??
        tenant.subscriptionPeriodEnd ??
        now;
      const end = charge.coversTo ?? anniversaryPeriodEnd(start);
      tenant.billingCycle = code;
      tenant.subscriptionStatus = 'active';
      tenant.subscriptionPeriodStart = start;
      tenant.subscriptionPeriodEnd = end;
      // Precio base del mes (sin módulos one-shot): preferir meta
      const planPrice = Number(charge.meta?.planPriceUsd ?? 0);
      const extraBlocks = Number(
        charge.meta?.extraBlocks ?? tenant.extraUserBlocks ?? 0,
      );
      const blockPrice = Number(
        charge.meta?.blockPriceUsd ??
          (await this.plans.getExtraBlockPriceUsd()),
      );
      tenant.subscriptionPeriodPriceUsd = monthlyRecurringUsd(
        planPrice || Number(charge.amountUsd),
        planPrice ? extraBlocks : 0,
        blockPrice,
      ).toFixed(2);
      await this.tenants.save(tenant);
    }

    return {
      charge: this.serializeCharge(charge),
      subscription: await this.getSubscriptionForTenant(tenantId),
    };
  }
}
