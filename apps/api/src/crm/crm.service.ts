import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { TopologyService } from '../topology/topology.service';
import { OnuConnectedService } from '../topology/onus/onu-connected.service';
import { SuspensionPortalService } from '../topology/suspension-portal.service';
import { isManagedOltDevice } from '../topology/olts/olt.constants';
import { Tenant } from '../tenants/entities/tenant.entity';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import {
  CreateServicePlanDto,
  UpdateServicePlanDto,
} from './dto/service-plan.dto';
import {
  CreateSpeedProfileDto,
  UpdateSpeedProfileDto,
} from './dto/speed-profile.dto';
import {
  CreateClientServiceDto,
  UpdateClientServiceDto,
} from './dto/client-service.dto';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';
import type {
  ClientService,
  ClientServiceStatus,
} from './entities/client-service.entity';
import type { SpeedProfile } from './entities/speed-profile.entity';
import type { Zone } from './entities/zone.entity';
import {
  sanitizeSpeedProfileName,
  toSystemOltProfileName,
} from '../drivers/olt/zte/shared/zte-olt-speed.util';
import { oltOnuName } from '../topology/olts/olt-onu-name.util';
import { BillingService } from '../billing/billing.service';
import { InventoryService } from '../inventory/inventory.service';
import { ClientPortalService } from '../client-portal/client-portal.service';
import type { Client } from './entities/client.entity';
import { onuSnKey } from '../topology/onus/onu-uncfg-visibility.util';
import {
  deriveServiceState,
  type CrmServiceDesired,
  type ServiceStateView,
} from '../topology/onus/onu-service-state.util';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly topology: TopologyService,
    private readonly billing: BillingService,
    private readonly inventory: InventoryService,
    private readonly onus: OnuConnectedService,
    private readonly suspensionPortal: SuspensionPortalService,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @Optional()
    @Inject(forwardRef(() => ClientPortalService))
    private readonly clientPortal?: ClientPortalService,
  ) {}

  private clientDisplayName(c: Client) {
    if (c.isCompany && c.companyName?.trim()) return c.companyName.trim();
    const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
    if (person && c.companyName?.trim()) {
      return `${person} (${c.companyName.trim()})`;
    }
    return person || c.companyName?.trim() || 'Cliente';
  }

  /** El portal es un efecto lateral: nunca debe tumbar el guardado del CRM. */
  private async runPortalSideEffect(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Portal ${what} falló: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async maybeInvitePortal(user: AuthUser, client: Client) {
    if (!this.clientPortal || !user.tenantId || !user.schemaName) return;
    if (client.isLead || !client.isActive) return;
    const tenantId = user.tenantId;
    const schemaName = user.schemaName;
    await this.runPortalSideEffect('invite', () =>
      this.clientPortal!.inviteClient({
        tenantId,
        schemaName,
        clientId: client.id,
        email: client.email,
        name: this.clientDisplayName(client),
        client,
      }),
    );
  }

  private async syncPortalSnapshot(user: AuthUser, client: Client) {
    if (!this.clientPortal || !user.tenantId) return;
    const tenantId = user.tenantId;
    await this.runPortalSideEffect('snapshot', () =>
      this.clientPortal!.syncClientSnapshot({ tenantId, client }),
    );
  }

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  // —— Clients ——

  async listClients(user: AuthUser) {
    const repo = await this.tenantConnections.getClientRepository(
      this.requireSchema(user),
    );
    return repo.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Puntos para Mapa de red:
   * - clientes con lat/lng
   * - servicios con ONU enlazada (ubicación del servicio; si falta, la del cliente)
   */
  async listNetworkMapLocations(user: AuthUser) {
    const schema = this.requireSchema(user);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    const clients = await clientRepo.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    const clientMarkers = clients
      .filter(
        (c) =>
          c.latitude != null &&
          c.longitude != null &&
          Number.isFinite(c.latitude) &&
          Number.isFinite(c.longitude),
      )
      .map((c) => {
        const person = [c.firstName, c.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        const label =
          person && c.companyName
            ? `${person} (${c.companyName})`
            : person || c.companyName || 'Cliente';
        return {
          id: c.id,
          kind: 'client' as const,
          lat: c.latitude as number,
          lng: c.longitude as number,
          label,
          subtitle: [c.street, c.city].filter(Boolean).join(', ') || null,
          clientId: c.id,
        };
      });

    const services = await serviceRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.client', 'c')
      .leftJoinAndSelect('s.servicePlan', 'p')
      .where('s.onu_id IS NOT NULL')
      .andWhere("s.status != 'ended'")
      .orderBy('s.createdAt', 'DESC')
      .getMany();

    const onuIds = [
      ...new Set(services.map((s) => s.onuId).filter(Boolean) as string[]),
    ];
    const onus =
      onuIds.length > 0
        ? await onuRepo
            .createQueryBuilder('o')
            .where('o.id IN (:...ids)', { ids: onuIds })
            .getMany()
        : [];
    const onuById = new Map(onus.map((o) => [o.id, o]));

    const onuMarkers = services
      .map((s) => {
        const lat =
          s.latitude != null && Number.isFinite(s.latitude)
            ? s.latitude
            : s.client?.latitude != null && Number.isFinite(s.client.latitude)
              ? s.client.latitude
              : null;
        const lng =
          s.longitude != null && Number.isFinite(s.longitude)
            ? s.longitude
            : s.client?.longitude != null && Number.isFinite(s.client.longitude)
              ? s.client.longitude
              : null;
        if (lat == null || lng == null) return null;

        const onu = s.onuId ? onuById.get(s.onuId) : undefined;
        const client = s.client;
        const person = client
          ? [client.firstName, client.lastName].filter(Boolean).join(' ').trim()
          : '';
        const clientLabel = person || client?.companyName || 'Cliente';
        return {
          id: s.id,
          kind: 'onu' as const,
          lat,
          lng,
          label: onu?.name || onu?.sn || s.name || 'ONU',
          subtitle: [clientLabel, s.name, onu?.sn ? `SN ${onu.sn}` : null]
            .filter(Boolean)
            .join(' · '),
          clientId: s.clientId,
          serviceId: s.id,
          onuId: s.onuId,
          serviceName: s.name,
          planName: s.servicePlan?.name ?? null,
          onuSn: onu?.sn ?? null,
          onuIf: onu?.onuIf ?? null,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m != null);

    return {
      clients: clientMarkers,
      onus: onuMarkers,
    };
  }

  private async portalEnabled(user: AuthUser): Promise<boolean> {
    if (!user.tenantId) return false;
    const tenant = await this.tenants.findOne({
      where: { id: user.tenantId },
    });
    return !!tenant?.suspensionPortalEnabled;
  }

  private async decorateClientServices(
    user: AuthUser,
    services: ClientService[],
  ): Promise<Array<ClientService & { serviceState: ServiceStateView }>> {
    const schema = this.requireSchema(user);
    const portal = await this.portalEnabled(user);
    const onuIds = [
      ...new Set(
        services.map((s) => s.onuId).filter((id): id is string => !!id),
      ),
    ];
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onus = onuIds.length
      ? await onuRepo.find({ where: { id: In(onuIds) } })
      : [];
    const onuById = new Map(onus.map((o) => [o.id, o]));
    const deniedRepo =
      await this.tenantConnections.getOnuDeniedRepository(schema);
    const deniedSn = new Set(
      (await deniedRepo.find()).map((d) => onuSnKey(d.sn)),
    );

    return services.map((s) => {
      const onu = s.onuId ? onuById.get(s.onuId) : undefined;
      const serviceState = deriveServiceState({
        crmStatus: s.status as CrmServiceDesired,
        adminState: onu?.adminState ?? null,
        denied: onu?.sn ? deniedSn.has(onuSnKey(onu.sn)) : false,
        inUncfg: false,
        inInventory: !!onu,
        portalSuspension: portal,
      });
      return Object.assign(s, { serviceState });
    });
  }

  private async requireClient(user: AuthUser, id: string) {
    const clients = await this.tenantConnections.getClientRepository(
      this.requireSchema(user),
    );
    const client = await clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async getClient(user: AuthUser, id: string) {
    const client = await this.requireClient(user, id);
    const services = await this.tenantConnections.getClientServiceRepository(
      this.requireSchema(user),
    );
    const clientServices = await services.find({
      where: { clientId: id },
      relations: { servicePlan: { speedProfile: true } },
      order: { createdAt: 'DESC' },
    });

    return {
      ...client,
      services: await this.decorateClientServices(user, clientServices),
    };
  }

  async createClient(user: AuthUser, dto: CreateClientDto) {
    const repo = await this.tenantConnections.getClientRepository(
      this.requireSchema(user),
    );
    const client = repo.create({
      firstName: dto.firstName?.trim() ?? '',
      lastName: dto.lastName?.trim() ?? '',
      companyName: dto.companyName?.trim() ?? '',
      documentType: dto.documentType?.trim() ?? '',
      documentNumber: dto.documentNumber?.trim() ?? '',
      isCompany: dto.isCompany ?? false,
      companyTaxId: dto.companyTaxId?.trim() ?? '',
      isLead: dto.isLead ?? false,
      email: dto.email?.toLowerCase().trim() ?? '',
      phone: dto.phone?.trim() ?? '',
      street: dto.street?.trim() ?? '',
      city: dto.city?.trim() ?? '',
      zipCode: dto.zipCode?.trim() ?? '',
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      note: dto.note?.trim() ?? '',
      isActive: dto.isActive ?? true,
      zoneId: dto.zoneId ?? null,
    });
    if (!client.firstName && !client.lastName && !client.companyName) {
      throw new BadRequestException(
        'Provide at least firstName, lastName or companyName',
      );
    }
    if (client.zoneId) {
      await this.assertZoneExists(this.requireSchema(user), client.zoneId);
    }
    const saved = await repo.save(client);
    await this.syncPortalSnapshot(user, saved);
    await this.maybeInvitePortal(user, saved);
    return saved;
  }

  async updateClient(user: AuthUser, id: string, dto: UpdateClientDto) {
    const repo = await this.tenantConnections.getClientRepository(
      this.requireSchema(user),
    );
    const client = await repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');

    const wasLead = client.isLead;
    const wasActive = client.isActive;

    if (dto.firstName !== undefined) client.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) client.lastName = dto.lastName.trim();
    if (dto.companyName !== undefined)
      client.companyName = dto.companyName.trim();
    if (dto.documentType !== undefined)
      client.documentType = dto.documentType.trim();
    if (dto.documentNumber !== undefined)
      client.documentNumber = dto.documentNumber.trim();
    if (dto.isCompany !== undefined) client.isCompany = dto.isCompany;
    if (dto.companyTaxId !== undefined)
      client.companyTaxId = dto.companyTaxId.trim();
    if (dto.isLead !== undefined) client.isLead = dto.isLead;
    if (dto.email !== undefined) client.email = dto.email.toLowerCase().trim();
    if (dto.phone !== undefined) client.phone = dto.phone.trim();
    if (dto.street !== undefined) client.street = dto.street.trim();
    if (dto.city !== undefined) client.city = dto.city.trim();
    if (dto.zipCode !== undefined) client.zipCode = dto.zipCode.trim();
    if (dto.latitude !== undefined) client.latitude = dto.latitude;
    if (dto.longitude !== undefined) client.longitude = dto.longitude;
    if (dto.note !== undefined) client.note = dto.note.trim();
    if (dto.isActive !== undefined) client.isActive = dto.isActive;
    if (dto.zoneId !== undefined) {
      client.zoneId = dto.zoneId || null;
      if (client.zoneId) {
        await this.assertZoneExists(this.requireSchema(user), client.zoneId);
      }
    }

    if (!client.firstName && !client.lastName && !client.companyName) {
      throw new BadRequestException(
        'Provide at least firstName, lastName or companyName',
      );
    }

    const saved = await repo.save(client);
    await this.syncPortalSnapshot(user, saved);
    const becameActiveClient =
      (!wasActive && saved.isActive && !saved.isLead) ||
      (wasLead && !saved.isLead && saved.isActive);
    if (becameActiveClient || (!saved.isLead && saved.isActive && dto.email)) {
      await this.maybeInvitePortal(user, saved);
    }
    if (
      (!saved.isActive || saved.isLead) &&
      user.tenantId &&
      this.clientPortal
    ) {
      await this.clientPortal.onClientArchivedOrDeleted(
        user.tenantId,
        saved.id,
      );
    }
    return saved;
  }

  async deleteClient(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getClientRepository(schema);
    const client = await repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    // Sólo se borra del esquema del tenant; nunca toca admin/public.
    // Pedimos que esté archivado para no borrar clientes activos por accidente.
    if (client.isActive) {
      throw new BadRequestException(
        'Archiva el cliente antes de eliminarlo de forma permanente',
      );
    }

    // invoices.client_id es RESTRICT: hay que limpiarlas antes del cliente.
    const invoiceRepo =
      await this.tenantConnections.getInvoiceRepository(schema);
    await invoiceRepo.delete({ clientId: id });

    if (user.tenantId && this.clientPortal) {
      await this.clientPortal.onClientArchivedOrDeleted(user.tenantId, id);
    }
    await repo.delete({ id });
    return { ok: true };
  }

  // —— Zones ——

  async listZones(user: AuthUser) {
    const schema = this.requireSchema(user);
    const zoneRepo = await this.tenantConnections.getZoneRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const zones = await zoneRepo.find({ order: { name: 'ASC' } });
    if (zones.length === 0) return [];

    const counts = await clientRepo
      .createQueryBuilder('c')
      .select('c.zoneId', 'zoneId')
      .addSelect('COUNT(*)', 'count')
      .where('c.zoneId IS NOT NULL')
      .groupBy('c.zoneId')
      .getRawMany<{ zoneId: string; count: string }>();

    const countMap = new Map(
      counts.map((r) => [r.zoneId, Number(r.count) || 0]),
    );

    return zones.map((z) => this.serializeZone(z, countMap.get(z.id) ?? 0));
  }

  async getZone(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const zoneRepo = await this.tenantConnections.getZoneRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const zone = await zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException('Zone not found');
    const clientCount = await clientRepo.count({ where: { zoneId: id } });
    return this.serializeZone(zone, clientCount);
  }

  async createZone(user: AuthUser, dto: CreateZoneDto) {
    const repo = await this.tenantConnections.getZoneRepository(
      this.requireSchema(user),
    );
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Zone name must be at least 2 characters');
    }
    const zone = repo.create({
      name,
      description: dto.description?.trim() ?? '',
    });
    const saved = await repo.save(zone);
    return this.serializeZone(saved, 0);
  }

  async updateZone(user: AuthUser, id: string, dto: UpdateZoneDto) {
    const repo = await this.tenantConnections.getZoneRepository(
      this.requireSchema(user),
    );
    const zone = await repo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException('Zone not found');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) {
        throw new BadRequestException(
          'Zone name must be at least 2 characters',
        );
      }
      zone.name = name;
    }
    if (dto.description !== undefined) {
      zone.description = dto.description.trim();
    }
    const saved = await repo.save(zone);
    // Mantener el nombre desnormalizado en ONUs vinculadas.
    if (dto.name !== undefined) {
      const onuRepo = await this.tenantConnections.getOnuRepository(
        this.requireSchema(user),
      );
      await onuRepo.update({ zoneId: id }, { zone: saved.name });
    }
    const clientRepo = await this.tenantConnections.getClientRepository(
      this.requireSchema(user),
    );
    const clientCount = await clientRepo.count({ where: { zoneId: id } });
    return this.serializeZone(saved, clientCount);
  }

  async deleteZone(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const zoneRepo = await this.tenantConnections.getZoneRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const zone = await zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException('Zone not found');
    await clientRepo.update({ zoneId: id }, { zoneId: null });
    await onuRepo.update({ zoneId: id }, { zoneId: null, zone: null });
    await zoneRepo.delete({ id });
    return { ok: true };
  }

  private async assertZoneExists(schema: string, zoneId: string) {
    const repo = await this.tenantConnections.getZoneRepository(schema);
    const zone = await repo.findOne({ where: { id: zoneId } });
    if (!zone) throw new BadRequestException('Zone not found');
  }

  private serializeZone(zone: Zone, clientCount: number) {
    return {
      id: zone.id,
      name: zone.name,
      description: zone.description,
      clientCount,
      createdAt: zone.createdAt,
      updatedAt: zone.updatedAt,
    };
  }

  // —— Service plans ——

  async listPlans(user: AuthUser) {
    const repo = await this.tenantConnections.getServicePlanRepository(
      this.requireSchema(user),
    );
    const plans = await repo.find({
      relations: { speedProfile: true },
      order: { name: 'ASC' },
    });
    return plans.map((p) => this.serializePlan(p));
  }

  async getPlan(user: AuthUser, id: string) {
    const repo = await this.tenantConnections.getServicePlanRepository(
      this.requireSchema(user),
    );
    const plan = await repo.findOne({
      where: { id },
      relations: { speedProfile: true },
    });
    if (!plan) throw new NotFoundException('Service plan not found');
    return this.serializePlan(plan);
  }

  async createPlan(user: AuthUser, dto: CreateServicePlanDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServicePlanRepository(schema);
    const profile = await this.requireSpeedProfile(schema, dto.speedProfileId);
    const serviceTypes = this.normalizeServiceTypes(dto.serviceTypes);
    const hasTv = serviceTypes.includes('tv');
    const plan = repo.create({
      name: dto.name.trim(),
      price: dto.price.toFixed(2),
      installationFee: (dto.installationFee ?? 0).toFixed(2),
      installationFeeOnFirstInvoice: dto.installationFeeOnFirstInvoice ?? true,
      invoiceLabel: (dto.invoiceLabel ?? dto.name).trim(),
      speedProfileId: profile.id,
      downloadSpeed: profile.downloadMbps,
      uploadSpeed: profile.uploadMbps,
      invoicingPeriod: 1,
      invoicingPeriodType: 'month',
      billingAnchor: dto.billingAnchor,
      billingCycleDay: dto.billingCycleDay,
      serviceTypes,
      type: this.serviceTypesLabel(serviceTypes),
      decoCount: hasTv ? Math.max(0, Math.floor(dto.decoCount ?? 0)) : 0,
      additionalDecoPrice: (dto.additionalDecoPrice ?? 0).toFixed(2),
      isActive: dto.isActive ?? true,
    });
    const saved = await repo.save(plan);
    return this.getPlan(user, saved.id);
  }

  async updatePlan(user: AuthUser, id: string, dto: UpdateServicePlanDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServicePlanRepository(schema);
    const plan = await repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Service plan not found');

    if (dto.name !== undefined) plan.name = dto.name.trim();
    if (dto.price !== undefined) plan.price = dto.price.toFixed(2);
    if (dto.installationFee !== undefined)
      plan.installationFee = dto.installationFee.toFixed(2);
    if (dto.installationFeeOnFirstInvoice !== undefined)
      plan.installationFeeOnFirstInvoice = dto.installationFeeOnFirstInvoice;
    if (dto.invoiceLabel !== undefined)
      plan.invoiceLabel = dto.invoiceLabel.trim();
    if (dto.speedProfileId !== undefined) {
      const profile = await this.requireSpeedProfile(
        schema,
        dto.speedProfileId,
      );
      plan.speedProfileId = profile.id;
      plan.downloadSpeed = profile.downloadMbps;
      plan.uploadSpeed = profile.uploadMbps;
    }
    if (dto.billingAnchor !== undefined) plan.billingAnchor = dto.billingAnchor;
    if (dto.billingCycleDay !== undefined)
      plan.billingCycleDay = dto.billingCycleDay;
    if (dto.serviceTypes !== undefined) {
      plan.serviceTypes = this.normalizeServiceTypes(dto.serviceTypes);
      plan.type = this.serviceTypesLabel(plan.serviceTypes);
    }
    if (dto.decoCount !== undefined) {
      plan.decoCount = Math.max(0, Math.floor(dto.decoCount));
    }
    if (dto.additionalDecoPrice !== undefined) {
      plan.additionalDecoPrice = dto.additionalDecoPrice.toFixed(2);
    }
    if (!plan.serviceTypes.includes('tv')) {
      plan.decoCount = 0;
    }
    // Always monthly
    plan.invoicingPeriod = 1;
    plan.invoicingPeriodType = 'month';
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;

    await repo.save(plan);
    return this.getPlan(user, id);
  }

  async deletePlan(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const plan = await plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Service plan not found');

    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const inUse = await services.count({ where: { servicePlanId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        'Cannot delete plan while client services reference it',
      );
    }

    await plans.delete({ id });
    return { ok: true };
  }

  private async requireSpeedProfile(schema: string, id: string) {
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) {
      throw new BadRequestException('Perfil de velocidad no encontrado');
    }
    if (!profile.isActive) {
      throw new BadRequestException('El perfil de velocidad está inactivo');
    }
    return profile;
  }

  private normalizeServiceTypes(
    types: Array<'internet' | 'tv' | 'telephony'>,
  ): Array<'internet' | 'tv' | 'telephony'> {
    const order = ['internet', 'tv', 'telephony'] as const;
    const set = new Set(types);
    const out = order.filter((t) => set.has(t));
    if (!out.length) {
      throw new BadRequestException(
        'Selecciona al menos un tipo: Internet, TV o Telefonía',
      );
    }
    return [...out];
  }

  private serviceTypesLabel(
    types: Array<'internet' | 'tv' | 'telephony'>,
  ): string {
    const labels: Record<string, string> = {
      internet: 'Internet',
      tv: 'TV',
      telephony: 'Telefonía',
    };
    return types.map((t) => labels[t] ?? t).join(' + ');
  }

  private serializePlan(plan: {
    id: string;
    name: string;
    price: string;
    installationFee?: string | null;
    installationFeeOnFirstInvoice?: boolean | null;
    invoiceLabel: string;
    downloadSpeed: number;
    uploadSpeed: number;
    speedProfileId: string | null;
    speedProfile?: {
      id: string;
      name: string;
      downloadMbps: number;
      uploadMbps: number;
      isActive: boolean;
    } | null;
    invoicingPeriod: number;
    invoicingPeriodType: string;
    billingAnchor?: string | null;
    billingCycleDay?: string | null;
    serviceTypes?: Array<'internet' | 'tv' | 'telephony'> | null;
    type: string;
    decoCount?: number | null;
    additionalDecoPrice?: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const sp = plan.speedProfile ?? null;
    const serviceTypes = plan.serviceTypes?.length
      ? plan.serviceTypes
      : this.legacyTypeToServiceTypes(plan.type);
    return {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      installationFee: plan.installationFee ?? '0.00',
      installationFeeOnFirstInvoice: plan.installationFeeOnFirstInvoice ?? true,
      invoiceLabel: plan.invoiceLabel,
      downloadSpeed: sp?.downloadMbps ?? plan.downloadSpeed,
      uploadSpeed: sp?.uploadMbps ?? plan.uploadSpeed,
      speedProfileId: plan.speedProfileId,
      speedProfile: sp
        ? {
            id: sp.id,
            name: sp.name,
            downloadMbps: sp.downloadMbps,
            uploadMbps: sp.uploadMbps,
            isActive: sp.isActive,
          }
        : null,
      invoicingPeriod: 1,
      invoicingPeriodType: 'month',
      billingAnchor: plan.billingAnchor || 'installation',
      billingCycleDay: plan.billingCycleDay || 'first',
      serviceTypes,
      type: this.serviceTypesLabel(serviceTypes),
      decoCount: serviceTypes.includes('tv') ? (plan.decoCount ?? 0) : 0,
      additionalDecoPrice: plan.additionalDecoPrice ?? '0.00',
      isActive: plan.isActive,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  private legacyTypeToServiceTypes(
    type: string,
  ): Array<'internet' | 'tv' | 'telephony'> {
    const lower = (type || '').toLowerCase();
    const out: Array<'internet' | 'tv' | 'telephony'> = [];
    if (/internet|isp|datos|data/.test(lower)) out.push('internet');
    if (/\btv\b|television|cable/.test(lower)) out.push('tv');
    if (/telefon|voice|voip|phone/.test(lower)) out.push('telephony');
    return out.length ? out : ['internet'];
  }

  // —— Speed profiles (system catalog → sync to OLTs) ——

  async listSpeedProfiles(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profiles = await repo.find({
      order: { downloadMbps: 'ASC', name: 'ASC' },
    });
    const oltById = await this.loadOltById(schema);
    // Fast list — no CLI probe (status is checked when opening the profile)
    return profiles.map((p) =>
      this.serializeSpeedProfile(p, oltById, new Map()),
    );
  }

  async createSpeedProfile(user: AuthUser, dto: CreateSpeedProfileDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const oltIds = await this.assertOltIds(schema, dto.oltIds ?? []);
    const clean = sanitizeSpeedProfileName(dto.name);
    if (!clean) {
      throw new BadRequestException('Nombre de perfil inválido');
    }
    const profile = repo.create({
      name: clean,
      downloadMbps: dto.downloadMbps,
      uploadMbps: dto.uploadMbps,
      description: (dto.description ?? '').trim(),
      isActive: dto.isActive ?? true,
      oltIds,
    });
    const saved = await repo.save(profile);
    return this.getSpeedProfile(user, saved.id, { probe: false });
  }

  async updateSpeedProfile(
    user: AuthUser,
    id: string,
    dto: UpdateSpeedProfileDto,
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    if (dto.name !== undefined) {
      profile.name = sanitizeSpeedProfileName(dto.name) || dto.name.trim();
    }
    if (dto.downloadMbps !== undefined) profile.downloadMbps = dto.downloadMbps;
    if (dto.uploadMbps !== undefined) profile.uploadMbps = dto.uploadMbps;
    if (dto.description !== undefined)
      profile.description = dto.description.trim();
    if (dto.isActive !== undefined) profile.isActive = dto.isActive;
    if (dto.oltIds !== undefined) {
      profile.oltIds = await this.assertOltIds(schema, dto.oltIds);
    }
    await repo.save(profile);
    return this.getSpeedProfile(user, id, { probe: false });
  }

  async deleteSpeedProfile(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const inUse = await plans.count({ where: { speedProfileId: id } });
    if (inUse > 0) {
      throw new BadRequestException(
        'No se puede eliminar: hay planes que usan este perfil',
      );
    }
    await repo.delete({ id });
    return { ok: true };
  }

  async getSpeedProfile(
    user: AuthUser,
    id: string,
    opts: { probe?: boolean; onlyOltId?: string } = {},
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    const oltById = await this.loadOltById(schema);
    const presence = new Map<string, { names: Set<string>; error?: string }>();
    const shouldProbe = opts.probe !== false;
    if (shouldProbe) {
      const toProbe = (profile.oltIds ?? []).filter((oltId) => {
        if (!oltById.has(oltId)) return false;
        if (opts.onlyOltId) return oltId === opts.onlyOltId;
        return true;
      });
      await Promise.all(
        toProbe.map(async (oltId) => {
          try {
            const live = await this.topology.getDeviceSpeedProfiles(
              user,
              oltId,
            );
            presence.set(oltId, {
              names: new Set(
                (live.profiles ?? []).map((p) => p.name.toLowerCase()),
              ),
            });
          } catch (e) {
            presence.set(oltId, {
              names: new Set(),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }),
      );
    }
    return this.serializeSpeedProfile(profile, oltById, presence);
  }

  /** Assign OLT to system profile (catalog only; does not push yet). */
  async assignSpeedProfileOlt(user: AuthUser, id: string, oltId: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    await this.assertOltIds(schema, [oltId]);
    const ids = new Set(profile.oltIds ?? []);
    ids.add(oltId);
    profile.oltIds = [...ids];
    await repo.save(profile);
    // Probe only the newly assigned OLT (not every assigned one)
    return this.getSpeedProfile(user, id, { probe: true, onlyOltId: oltId });
  }

  async unassignSpeedProfileOlt(user: AuthUser, id: string, oltId: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    profile.oltIds = (profile.oltIds ?? []).filter((x) => x !== oltId);
    await repo.save(profile);
    return this.getSpeedProfile(user, id, { probe: false });
  }

  /** Push system profile to an assigned OLT (create/update tcont+traffic). */
  async syncSpeedProfileOlt(user: AuthUser, id: string, oltId: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getSpeedProfileRepository(schema);
    const profile = await repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Speed profile not found');
    await this.assertOltIds(schema, [oltId]);
    const ids = new Set(profile.oltIds ?? []);
    if (!ids.has(oltId)) {
      ids.add(oltId);
      profile.oltIds = [...ids];
      await repo.save(profile);
    }
    const oltName = toSystemOltProfileName(profile.name);
    if (!oltName) {
      throw new BadRequestException('Nombre de perfil inválido para la OLT');
    }
    const result = await this.topology.upsertDeviceSpeedProfile(user, oltId, {
      name: oltName,
      downloadMbps: profile.downloadMbps,
      uploadMbps: profile.uploadMbps,
    });
    const view = await this.getSpeedProfile(user, id, {
      probe: true,
      onlyOltId: oltId,
    });
    return { ...view, syncMessage: result.message };
  }

  private async loadOltById(schema: string) {
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olts = (await deviceRepo.find({ order: { name: 'ASC' } })).filter(
      (d) => isManagedOltDevice(d.type, d.subtype),
    );
    return new Map(olts.map((o) => [o.id, o]));
  }

  private async assertOltIds(schema: string, oltIds: string[]) {
    if (!oltIds.length) return [] as string[];
    const unique = [...new Set(oltIds)];
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    for (const id of unique) {
      const d = await deviceRepo.findOne({ where: { id } });
      if (!d || !isManagedOltDevice(d.type, d.subtype)) {
        throw new BadRequestException(`OLT inválida: ${id}`);
      }
    }
    return unique;
  }

  private serializeSpeedProfile(
    p: SpeedProfile,
    oltById: Map<string, { id: string; name: string }>,
    presence: Map<string, { names: Set<string>; error?: string }>,
  ) {
    const oltProfileName =
      toSystemOltProfileName(p.name) ||
      sanitizeSpeedProfileName(p.name) ||
      p.name;
    const key = oltProfileName.toLowerCase();
    const olts = (p.oltIds ?? [])
      .map((oltId) => {
        const olt = oltById.get(oltId);
        if (!olt) return null;
        const st = presence.get(oltId);
        const present = st ? st.names.has(key) : null;
        return {
          id: olt.id,
          name: olt.name,
          present,
          error: st?.error ?? null,
          needsSync: present !== true,
        };
      })
      .filter(Boolean);
    return {
      id: p.id,
      name: p.name,
      oltProfileName,
      downloadMbps: p.downloadMbps,
      uploadMbps: p.uploadMbps,
      description: p.description,
      isActive: p.isActive,
      oltIds: p.oltIds ?? [],
      olts,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  // —— Client services (contracts) ——

  async listClientServices(user: AuthUser, clientId: string) {
    await this.requireClient(user, clientId);
    const repo = await this.tenantConnections.getClientServiceRepository(
      this.requireSchema(user),
    );
    const rows = await repo.find({
      where: { clientId },
      relations: { servicePlan: { speedProfile: true } },
      order: { createdAt: 'DESC' },
    });
    return this.decorateClientServices(user, rows);
  }

  async createClientService(
    user: AuthUser,
    clientId: string,
    dto: CreateClientServiceDto,
  ) {
    const schema = this.requireSchema(user);
    await this.requireClient(user, clientId);

    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const plan = await plans.findOne({ where: { id: dto.servicePlanId } });
    if (!plan) throw new NotFoundException('Service plan not found');

    const hasTv = (plan.serviceTypes ?? []).includes('tv');
    const includedDecoCount = hasTv ? Math.max(0, plan.decoCount ?? 0) : 0;
    const additionalDecoCount = hasTv
      ? Math.max(0, Math.floor(dto.additionalDecoCount ?? 0))
      : 0;
    const additionalDecoUnitPrice = Number(plan.additionalDecoPrice ?? 0);
    const decoUnits = includedDecoCount + additionalDecoCount;

    const repo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const service = repo.create({
      clientId,
      servicePlanId: plan.id,
      name: (dto.name ?? plan.name).trim(),
      price: (dto.price !== undefined ? dto.price : Number(plan.price)).toFixed(
        2,
      ),
      activeFrom: dto.activeFrom ?? new Date().toISOString().slice(0, 10),
      activeTo: dto.activeTo ?? null,
      status: (dto.status as ClientServiceStatus) ?? 'active',
      street: dto.street?.trim() ?? '',
      city: dto.city?.trim() ?? '',
      zipCode: dto.zipCode?.trim() ?? '',
      note: dto.note?.trim() ?? '',
      onuId: dto.onuId ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      inventoryOnuItemId: dto.inventoryOnuItemId ?? null,
      inventoryDecoItemId: dto.inventoryDecoItemId ?? null,
      includedDecoCount,
      additionalDecoCount,
      additionalDecoUnitPrice: additionalDecoUnitPrice.toFixed(2),
      additionalDecoFeePending:
        additionalDecoCount > 0 && additionalDecoUnitPrice > 0,
    });
    const saved = await repo.save(service);

    try {
      if (dto.inventoryOnuItemId) {
        await this.inventory.consume(schema, dto.inventoryOnuItemId, 1, 'onu');
      }
      if (dto.inventoryDecoItemId && decoUnits > 0) {
        await this.inventory.consume(
          schema,
          dto.inventoryDecoItemId,
          decoUnits,
          'deco',
        );
      }
    } catch (e) {
      await repo.delete({ id: saved.id });
      throw e;
    }

    await this.billing.onClientServiceCreated(schema, saved);
    return repo.findOne({
      where: { id: saved.id },
      relations: { servicePlan: { speedProfile: true } },
    });
  }

  async updateClientService(
    user: AuthUser,
    id: string,
    dto: UpdateClientServiceDto,
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const service = await repo.findOne({
      where: { id },
      relations: { servicePlan: { speedProfile: true } },
    });
    if (!service) throw new NotFoundException('Client service not found');

    if (dto.servicePlanId !== undefined) {
      const plans =
        await this.tenantConnections.getServicePlanRepository(schema);
      const plan = await plans.findOne({ where: { id: dto.servicePlanId } });
      if (!plan) throw new NotFoundException('Service plan not found');
      service.servicePlanId = plan.id;
    }
    if (dto.name !== undefined) service.name = dto.name.trim();
    if (dto.price !== undefined) service.price = dto.price.toFixed(2);
    if (dto.activeFrom !== undefined) service.activeFrom = dto.activeFrom;
    if (dto.activeTo !== undefined) service.activeTo = dto.activeTo;
    const nextStatus = dto.status as ClientServiceStatus | undefined;
    if (
      nextStatus &&
      (nextStatus === 'active' || nextStatus === 'suspended') &&
      nextStatus !== service.status
    ) {
      await this.applyNetworkServiceStatus(user, id, nextStatus);
    }
    if (dto.status !== undefined)
      service.status = dto.status as ClientServiceStatus;
    if (dto.street !== undefined) service.street = dto.street.trim();
    if (dto.city !== undefined) service.city = dto.city.trim();
    if (dto.zipCode !== undefined) service.zipCode = dto.zipCode.trim();
    if (dto.note !== undefined) service.note = dto.note.trim();
    if (dto.onuId !== undefined) service.onuId = dto.onuId;
    if (dto.latitude !== undefined) service.latitude = dto.latitude;
    if (dto.longitude !== undefined) service.longitude = dto.longitude;

    return repo.save(service);
  }

  async setServiceStatus(
    user: AuthUser,
    id: string,
    status: ClientServiceStatus,
  ) {
    const patch: UpdateClientServiceDto = { status };
    if (status === 'ended') {
      patch.activeTo = new Date().toISOString().slice(0, 10);
    }
    if (status === 'active') {
      patch.activeTo = null;
    }
    return this.updateClientService(user, id, patch);
  }

  /**
   * Alinea la OLT (o el portal) con el estado CRM del contrato.
   * Baja (`ended`) solo borra la ONU si `removeOnu` es true.
   */
  async reconcileOlt(
    user: AuthUser,
    id: string,
    opts?: { removeOnu?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const service = await repo.findOne({
      where: { id },
      relations: { servicePlan: { speedProfile: true } },
    });
    if (!service) throw new NotFoundException('Client service not found');

    if (service.status === 'ended') {
      if (!opts?.removeOnu) {
        const [decorated] = await this.decorateClientServices(user, [service]);
        return {
          ok: true,
          skipped: true,
          reason: 'ended_without_removeOnu',
          service: decorated,
        };
      }
      if (service.onuId) {
        const onuRepo = await this.tenantConnections.getOnuRepository(schema);
        const onu = await onuRepo.findOne({ where: { id: service.onuId } });
        if (onu?.oltId && onu.onuIf) {
          await this.onus.deleteOnu(user, onu.oltId, onu.onuIf);
        }
        service.onuId = null;
        await repo.save(service);
      }
      const [decorated] = await this.decorateClientServices(user, [service]);
      return { ok: true, removedOnu: true, service: decorated };
    }

    if (service.status === 'active' || service.status === 'suspended') {
      await this.applyNetworkServiceStatus(user, id, service.status);
    }

    const fresh = await repo.findOne({
      where: { id },
      relations: { servicePlan: { speedProfile: true } },
    });
    const [decorated] = await this.decorateClientServices(user, [
      fresh ?? service,
    ]);
    return { ok: true, service: decorated };
  }

  /**
   * One-shot: empuja «Cliente Servicio» como name en la OLT para servicios migrados.
   * Solo si cliente y servicio tienen migratedAt y aún no se sincronizó.
   */
  async syncMigratedOnuName(user: AuthUser, serviceId: string) {
    const schema = this.requireSchema(user);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);

    const service = await serviceRepo.findOne({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Client service not found');

    const client = await clientRepo.findOne({
      where: { id: service.clientId },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (!client.migratedAt || !service.migratedAt) {
      throw new BadRequestException(
        'Solo disponible para cliente y servicio migrados',
      );
    }
    if (service.onuNameSyncedAt) {
      throw new BadRequestException('El nombre ONU ya fue sincronizado');
    }
    if (!service.onuId) {
      throw new BadRequestException('El servicio no tiene ONU enlazada');
    }

    const composed = oltOnuName(
      this.clientDisplayName(client),
      service.name || '',
    );
    if (!composed) {
      throw new BadRequestException('Nombre compuesto vacío');
    }

    const result = await this.onus.updateName(user, service.onuId, composed);
    service.onuNameSyncedAt = new Date();
    await serviceRepo.save(service);

    return {
      ok: true,
      name: result.name,
      onuNameSyncedAt: service.onuNameSyncedAt.toISOString(),
      message: result.message || 'Nombre ONU sincronizado',
    };
  }

  /**
   * Portal mode: MikroTik address-list. Default: Disable/Enable ONU on OLT.
   */
  private async applyNetworkServiceStatus(
    user: AuthUser,
    serviceId: string,
    status: 'suspended' | 'active',
  ) {
    if (!user.tenantId) {
      throw new BadRequestException('Sin empresa asociada');
    }
    const schema = this.requireSchema(user);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const service = await serviceRepo.findOne({ where: { id: serviceId } });
    if (!service) throw new NotFoundException('Client service not found');

    const tenant = await this.tenants.findOne({ where: { id: user.tenantId } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    if (tenant.suspensionPortalEnabled) {
      await this.applyPortalSuspension(user, schema, service, status);
      return;
    }

    if (!service.onuId) return;

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: service.onuId } });
    if (!onu?.oltId || !onu.onuIf) return;

    if (status === 'suspended') {
      await this.onus.disable(user, onu.oltId, onu.onuIf);
    } else {
      await this.onus.enable(user, onu.oltId, onu.onuIf);
    }
  }

  private async applyPortalSuspension(
    user: AuthUser,
    schema: string,
    service: ClientService,
    status: 'suspended' | 'active',
  ) {
    if (!service.onuId) {
      throw new BadRequestException(
        'Portal de suspensión: el servicio debe tener una ONU enlazada con IP WAN',
      );
    }
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: service.onuId } });
    if (!onu) {
      throw new BadRequestException(
        'Portal de suspensión: ONU enlazada no encontrada',
      );
    }
    if (!onu.wanIp?.trim()) {
      throw new BadRequestException(
        'Portal de suspensión: la ONU no tiene IP WAN asignada',
      );
    }

    let routerId: string | null = null;
    if (onu.wanPoolId) {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const pool = await poolRepo.findOne({ where: { id: onu.wanPoolId } });
      routerId = pool?.routerId ?? null;
    }

    if (status === 'suspended') {
      await this.suspensionPortal.addSuspendedIp(
        user,
        service,
        onu.wanIp.trim(),
        routerId,
      );
    } else {
      await this.suspensionPortal.removeSuspendedIp(
        user,
        service,
        onu.wanIp.trim(),
        routerId,
      );
    }
  }

  async dashboardStats(user: AuthUser) {
    const schema = this.requireSchema(user);
    const clients = await this.tenantConnections.getClientRepository(schema);
    const plans = await this.tenantConnections.getServicePlanRepository(schema);
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const invoices = await this.tenantConnections.getInvoiceRepository(schema);

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    )
      .toISOString()
      .slice(0, 10);
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);

    const [
      clientCount,
      planCount,
      activeServices,
      suspendedServices,
      salesRow,
      estimatedRow,
    ] = await Promise.all([
      clients.count({ where: { isActive: true } }),
      plans.count({ where: { isActive: true } }),
      services.count({ where: { status: 'active' } }),
      services.count({ where: { status: 'suspended' } }),
      invoices
        .createQueryBuilder('i')
        .select('COALESCE(SUM(i.total::numeric), 0)', 'sum')
        .where('i.status = :status', { status: 'paid' })
        .andWhere('i.issue_date >= :from', { from: monthStart })
        .andWhere('i.issue_date <= :to', { to: monthEnd })
        .getRawOne<{ sum: string }>(),
      invoices
        .createQueryBuilder('i')
        .select('COALESCE(SUM(i.total::numeric), 0)', 'sum')
        .where('i.status IN (:...statuses)', {
          statuses: ['issued', 'sent', 'overdue'],
        })
        .getRawOne<{ sum: string }>(),
    ]);

    const salesThisMonth = Number(salesRow?.sum ?? 0);
    const estimatedEarnings = Number(estimatedRow?.sum ?? 0);

    // Placeholder: alertas se definirán en un siguiente entregable.
    const alerts: Array<{
      id: string;
      severity: 'info' | 'warning' | 'critical';
      title: string;
      message: string;
    }> = [];

    return {
      clientCount,
      planCount,
      activeServices,
      suspendedServices,
      salesThisMonth,
      estimatedEarnings,
      alertsCount: alerts.length,
      alerts,
    };
  }
}
