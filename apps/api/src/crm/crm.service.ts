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
import { OnuTr069ConfigService } from '../topology/onus/onu-tr069-config.service';
import { NetworkAlarmService } from '../topology/onus/network-alarm.service';
import {
  alarmBody,
  alarmTitle,
  type AccessAlarmKind,
} from '../topology/onus/network-alarm.util';
import { SuspensionPortalService } from '../topology/suspension-portal.service';
import {
  isOnuAdminDisabled,
  planPortalSuspend,
} from '../topology/suspension-portal.util';
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

export type NetworkApplyResult = {
  via: 'portal' | 'olt' | 'olt_fallback' | 'none';
  warning?: string;
};

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly topology: TopologyService,
    private readonly billing: BillingService,
    private readonly inventory: InventoryService,
    private readonly onus: OnuConnectedService,
    private readonly tr069: OnuTr069ConfigService,
    private readonly alarms: NetworkAlarmService,
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
    const rows = await repo.find({ order: { createdAt: 'DESC' } });
    return this.withInstallDateFlag(this.requireSchema(user), rows);
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

  private async withInstallDateFlag(schema: string, clients: Client[]) {
    if (clients.length === 0) return [];
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const rows = await services.find({
      where: { clientId: In(clients.map((c) => c.id)) },
      select: ['clientId', 'activeFrom', 'status'],
    });
    const withFrom = new Set(
      rows.filter((s) => !!s.activeFrom).map((s) => s.clientId),
    );
    const suspended = new Set(
      rows.filter((s) => s.status === 'suspended').map((s) => s.clientId),
    );
    return clients.map((c) =>
      Object.assign(c, {
        hasInstallDate: c.installDay != null || withFrom.has(c.id),
        hasSuspendedService: suspended.has(c.id),
      }),
    );
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
    const schema = this.requireSchema(user);
    const client = await this.requireClient(user, id);
    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const clientServices = await services.find({
      where: { clientId: id },
      relations: { servicePlan: { speedProfile: true } },
      order: { createdAt: 'DESC' },
    });
    const [decorated] = await this.withInstallDateFlag(schema, [client]);

    return {
      ...decorated,
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
      installDay: dto.installDay ?? null,
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
    if (dto.installDay !== undefined) {
      client.installDay = dto.installDay ?? null;
    }

    if (!client.firstName && !client.lastName && !client.companyName) {
      throw new BadRequestException(
        'Provide at least firstName, lastName or companyName',
      );
    }

    const saved = await repo.save(client);
    if (dto.installDay != null) {
      await this.billing.applyClientInstallDay(
        this.requireSchema(user),
        saved.id,
        dto.installDay,
      );
    }
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

  /**
   * Detecta posibles clientes duplicados por teléfono, documento, email o nombre.
   */
  async findDuplicateClients(
    user: AuthUser,
    opts?: {
      field?: 'auto' | 'phone' | 'document' | 'email' | 'name';
      q?: string;
      limit?: number;
      includeInactive?: boolean;
    },
  ) {
    const field = opts?.field ?? 'auto';
    const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 80);
    const q = (opts?.q ?? '').trim().toLowerCase();
    const rows = await this.listClients(user);
    const active = opts?.includeInactive
      ? rows
      : rows.filter((c) => c.isActive !== false);

    const filtered = q
      ? active.filter((c) => {
          const hay = [
            c.firstName,
            c.lastName,
            c.companyName,
            c.phone,
            c.email,
            c.documentNumber,
            c.companyTaxId,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        })
      : active;

    type KeyKind = 'phone' | 'document' | 'email' | 'name';
    const buckets = new Map<
      string,
      { kind: KeyKind; key: string; clients: typeof filtered }
    >();

    const push = (kind: KeyKind, key: string, c: (typeof filtered)[number]) => {
      if (!key) return;
      const id = `${kind}:${key}`;
      let b = buckets.get(id);
      if (!b) {
        b = { kind, key, clients: [] };
        buckets.set(id, b);
      }
      if (!b.clients.some((x) => x.id === c.id)) b.clients.push(c);
    };

    for (const c of filtered) {
      const phone = normalizePhone(c.phone);
      const doc = normalizeDoc(c.documentNumber || c.companyTaxId);
      const email = (c.email ?? '').trim().toLowerCase();
      const name = normalizePersonName(c);

      if (field === 'auto' || field === 'phone') push('phone', phone, c);
      if (field === 'auto' || field === 'document') push('document', doc, c);
      if (field === 'auto' || field === 'email') push('email', email, c);
      if (field === 'auto' || field === 'name') push('name', name, c);
    }

    const groups = [...buckets.values()]
      .filter((b) => b.clients.length >= 2)
      .filter((b) => (b.kind === 'email' ? b.key.includes('@') : true))
      .filter((b) => (b.kind === 'phone' ? b.key.length >= 7 : true))
      .filter((b) => (b.kind === 'document' ? b.key.length >= 5 : true))
      .filter((b) => (b.kind === 'name' ? b.key.length >= 5 : true))
      .sort((a, b) => b.clients.length - a.clients.length)
      .slice(0, limit)
      .map((g) => ({
        matchOn: g.kind,
        matchKey: g.key,
        count: g.clients.length,
        clients: g.clients.map((c) => ({
          id: c.id,
          name: this.clientDisplayName(c),
          phone: c.phone ?? '',
          email: c.email ?? '',
          documentNumber: c.documentNumber ?? '',
          companyTaxId: c.companyTaxId ?? '',
          isActive: c.isActive !== false,
          isLead: !!c.isLead,
          city: c.city ?? '',
        })),
      }));

    return {
      field,
      q: q || null,
      groupCount: groups.length,
      groups,
    };
  }

  /**
   * Une `sourceClientId` en `targetClientId`: mueve servicios, facturas y
   * eventos; rellena campos vacíos del destino; archiva el origen.
   */
  async mergeClients(
    user: AuthUser,
    opts: {
      targetClientId: string;
      sourceClientId: string;
      fillEmptyFields?: boolean;
      deleteSource?: boolean;
    },
  ) {
    const targetId = opts.targetClientId?.trim();
    const sourceId = opts.sourceClientId?.trim();
    if (!targetId || !sourceId) {
      throw new BadRequestException('targetClientId y sourceClientId requeridos');
    }
    if (targetId === sourceId) {
      throw new BadRequestException('Los IDs de origen y destino deben ser distintos');
    }

    const schema = this.requireSchema(user);
    const clients = await this.tenantConnections.getClientRepository(schema);
    const target = await clients.findOne({ where: { id: targetId } });
    const source = await clients.findOne({ where: { id: sourceId } });
    if (!target) throw new NotFoundException('Cliente destino no encontrado');
    if (!source) throw new NotFoundException('Cliente origen no encontrado');

    const services =
      await this.tenantConnections.getClientServiceRepository(schema);
    const invoices = await this.tenantConnections.getInvoiceRepository(schema);
    const calendar =
      await this.tenantConnections.getCalendarEventRepository(schema);

    const movedServices = await services.update(
      { clientId: sourceId },
      { clientId: targetId },
    );
    const movedInvoices = await invoices.update(
      { clientId: sourceId },
      { clientId: targetId },
    );
    const movedEvents = await calendar.update(
      { clientId: sourceId },
      { clientId: targetId },
    );

    const fill = opts.fillEmptyFields !== false;
    if (fill) {
      const fillStr = (cur: string, next: string) =>
        !(cur ?? '').trim() && (next ?? '').trim() ? next.trim() : cur;
      target.firstName = fillStr(target.firstName, source.firstName);
      target.lastName = fillStr(target.lastName, source.lastName);
      target.companyName = fillStr(target.companyName, source.companyName);
      target.documentType = fillStr(target.documentType, source.documentType);
      target.documentNumber = fillStr(
        target.documentNumber,
        source.documentNumber,
      );
      target.companyTaxId = fillStr(target.companyTaxId, source.companyTaxId);
      target.email = fillStr(target.email, source.email);
      target.phone = fillStr(target.phone, source.phone);
      target.street = fillStr(target.street, source.street);
      target.city = fillStr(target.city, source.city);
      target.zipCode = fillStr(target.zipCode, source.zipCode);
      if (target.latitude == null && source.latitude != null) {
        target.latitude = source.latitude;
      }
      if (target.longitude == null && source.longitude != null) {
        target.longitude = source.longitude;
      }
      if (!target.zoneId && source.zoneId) target.zoneId = source.zoneId;
      if (target.installDay == null && source.installDay != null) {
        target.installDay = source.installDay;
      }
      if (!target.isCompany && source.isCompany) target.isCompany = true;
      if (target.isLead && !source.isLead) target.isLead = false;
    }

    const mergeNote = `[Merge ${new Date().toISOString().slice(0, 10)}] Unido desde ${this.clientDisplayName(source)} (${sourceId}).`;
    target.note = target.note?.trim()
      ? `${target.note.trim()}\n${mergeNote}`
      : mergeNote;
    target.isActive = true;
    await clients.save(target);
    await this.syncPortalSnapshot(user, target);

    source.isActive = false;
    source.note = source.note?.trim()
      ? `${source.note.trim()}\n[Merge] Archivado → ${targetId}`
      : `[Merge] Archivado → ${targetId}`;
    await clients.save(source);

    if (user.tenantId && this.clientPortal) {
      await this.clientPortal.onClientArchivedOrDeleted(user.tenantId, sourceId);
    }

    let deletedSource = false;
    if (opts.deleteSource === true) {
      await this.deleteClient(user, sourceId);
      deletedSource = true;
    }

    return {
      ok: true,
      targetClientId: targetId,
      sourceClientId: sourceId,
      deletedSource,
      moved: {
        services: movedServices.affected ?? 0,
        invoices: movedInvoices.affected ?? 0,
        calendarEvents: movedEvents.affected ?? 0,
      },
      target: {
        id: target.id,
        name: this.clientDisplayName(target),
        phone: target.phone,
        email: target.email,
      },
    };
  }

  /**
   * Detecta servicios duplicados que comparten ONU (y opcionalmente el mismo plan).
   * Útil tras migraciones / merges de clientes que dejaron 2 contratos en la misma ONU.
   */
  async findDuplicateServices(
    user: AuthUser,
    opts?: {
      match?: 'onu_and_plan' | 'onu';
      clientId?: string;
      includeEnded?: boolean;
      limit?: number;
    },
  ) {
    const match = opts?.match === 'onu' ? 'onu' : 'onu_and_plan';
    const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 80);
    const schema = this.requireSchema(user);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    const qb = serviceRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.servicePlan', 'plan')
      .where('s.onuId IS NOT NULL');
    if (!opts?.includeEnded) {
      qb.andWhere('s.status != :ended', { ended: 'ended' });
    }
    if (opts?.clientId?.trim()) {
      qb.andWhere('s.clientId = :clientId', {
        clientId: opts.clientId.trim(),
      });
    }
    const services = await qb.orderBy('s.createdAt', 'ASC').getMany();
    if (services.length < 2) {
      return { match, groupCount: 0, groups: [] as const };
    }

    const clientIds = [...new Set(services.map((s) => s.clientId))];
    const onuIds = [
      ...new Set(services.map((s) => s.onuId).filter(Boolean) as string[]),
    ];
    const clients =
      clientIds.length > 0
        ? await clientRepo.find({ where: { id: In(clientIds) } })
        : [];
    const onus =
      onuIds.length > 0
        ? await onuRepo.find({ where: { id: In(onuIds) } })
        : [];
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const onuById = new Map(onus.map((o) => [o.id, o]));

    const buckets = new Map<string, typeof services>();
    for (const s of services) {
      if (!s.onuId) continue;
      const key =
        match === 'onu'
          ? `onu:${s.onuId}`
          : `onu:${s.onuId}|plan:${s.servicePlanId}`;
      const list = buckets.get(key) ?? [];
      list.push(s);
      buckets.set(key, list);
    }

    const statusRank = (st: string) =>
      st === 'active' ? 0 : st === 'suspended' ? 1 : st === 'prepared' ? 2 : 3;

    const groups = [...buckets.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, limit)
      .map(([key, list]) => {
        const sorted = [...list].sort(
          (a, b) => statusRank(a.status) - statusRank(b.status),
        );
        const onu = onuById.get(sorted[0].onuId!);
        const plan = sorted[0].servicePlan;
        return {
          matchKey: key,
          onuId: sorted[0].onuId,
          onuSn: onu?.sn ?? null,
          onuIf: onu?.onuIf ?? null,
          servicePlanId: sorted[0].servicePlanId,
          planName: plan?.name ?? null,
          samePlan: sorted.every(
            (s) => s.servicePlanId === sorted[0].servicePlanId,
          ),
          count: sorted.length,
          suggestedTargetServiceId: sorted[0].id,
          services: sorted.map((s) => {
            const c = clientById.get(s.clientId);
            return {
              id: s.id,
              clientId: s.clientId,
              clientName: c ? this.clientDisplayName(c) : s.clientId,
              name: s.name,
              status: s.status,
              servicePlanId: s.servicePlanId,
              planName: s.servicePlan?.name ?? null,
              price: s.price,
              onuId: s.onuId,
              createdAt: s.createdAt,
            };
          }),
        };
      });

    return { match, groupCount: groups.length, groups };
  }

  /**
   * Unifica sourceServiceId en targetServiceId (misma ONU; mismo plan por defecto).
   * Mueve facturas del origen al destino, libera la ONU del origen y lo marca ended.
   */
  async mergeServices(
    user: AuthUser,
    opts: {
      targetServiceId: string;
      sourceServiceId: string;
      requireSamePlan?: boolean;
    },
  ) {
    const targetId = opts.targetServiceId?.trim();
    const sourceId = opts.sourceServiceId?.trim();
    if (!targetId || !sourceId) {
      throw new BadRequestException(
        'targetServiceId y sourceServiceId requeridos',
      );
    }
    if (targetId === sourceId) {
      throw new BadRequestException('Los IDs de origen y destino deben ser distintos');
    }

    const schema = this.requireSchema(user);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const invoiceRepo =
      await this.tenantConnections.getInvoiceRepository(schema);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);

    const target = await serviceRepo.findOne({
      where: { id: targetId },
      relations: { servicePlan: true },
    });
    const source = await serviceRepo.findOne({
      where: { id: sourceId },
      relations: { servicePlan: true },
    });
    if (!target) throw new NotFoundException('Servicio destino no encontrado');
    if (!source) throw new NotFoundException('Servicio origen no encontrado');

    if (!target.onuId && !source.onuId) {
      throw new BadRequestException(
        'Ninguno de los servicios tiene ONU; no se puede unificar por ONU',
      );
    }
    if (target.onuId && source.onuId && target.onuId !== source.onuId) {
      throw new BadRequestException(
        'Los servicios no comparten la misma ONU; no se unifican',
      );
    }
    if (opts.requireSamePlan !== false) {
      if (target.servicePlanId !== source.servicePlanId) {
        throw new BadRequestException(
          'Los servicios tienen planes distintos. Pasá requireSamePlan=false solo si querés forzar.',
        );
      }
    }

    // Conservar ONU en el destino
    if (!target.onuId && source.onuId) {
      target.onuId = source.onuId;
    }

    const movedInvoices = await invoiceRepo.update(
      { clientServiceId: sourceId },
      {
        clientServiceId: targetId,
        clientId: target.clientId,
      },
    );

    const today = new Date().toISOString().slice(0, 10);
    const mergeNote = `[Merge servicio ${today}] Unido desde ${source.name} (${sourceId}).`;
    target.note = target.note?.trim()
      ? `${target.note.trim()}\n${mergeNote}`
      : mergeNote;
    if (target.status === 'ended' && source.status !== 'ended') {
      target.status = source.status;
    }
    if (
      (target.status === 'prepared' || target.status === 'ended') &&
      (source.status === 'active' || source.status === 'suspended')
    ) {
      target.status = source.status;
    }
    await serviceRepo.save(target);

    source.onuId = null;
    source.status = 'ended';
    source.activeTo = source.activeTo || today;
    source.note = source.note?.trim()
      ? `${source.note.trim()}\n[Merge servicio] Ended → ${targetId}`
      : `[Merge servicio] Ended → ${targetId}`;
    await serviceRepo.save(source);

    const targetClient = await clientRepo.findOne({
      where: { id: target.clientId },
    });
    const sourceClient = await clientRepo.findOne({
      where: { id: source.clientId },
    });

    return {
      ok: true,
      targetServiceId: targetId,
      sourceServiceId: sourceId,
      sameClient: target.clientId === source.clientId,
      moved: { invoices: movedInvoices.affected ?? 0 },
      target: {
        id: target.id,
        name: target.name,
        status: target.status,
        clientId: target.clientId,
        clientName: targetClient
          ? this.clientDisplayName(targetClient)
          : target.clientId,
        onuId: target.onuId,
        servicePlanId: target.servicePlanId,
        planName: target.servicePlan?.name ?? null,
      },
      source: {
        id: source.id,
        name: source.name,
        status: source.status,
        clientId: source.clientId,
        clientName: sourceClient
          ? this.clientDisplayName(sourceClient)
          : source.clientId,
      },
    };
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
      billingProrate: !!dto.billingProrate,
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
    let networkApply: NetworkApplyResult | undefined;
    if (
      nextStatus &&
      (nextStatus === 'active' || nextStatus === 'suspended') &&
      nextStatus !== service.status
    ) {
      networkApply = await this.applyNetworkServiceStatus(user, id, nextStatus);
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

    const saved = await repo.save(service);
    if (
      saved.onuId &&
      (dto.servicePlanId !== undefined || dto.onuId !== undefined)
    ) {
      try {
        const dba = await this.tr069.syncInternetDba(schema, saved.onuId, {
          heal: true,
        });
        const onuRepo = await this.tenantConnections.getOnuRepository(schema);
        const onu = await onuRepo.findOne({ where: { id: saved.onuId } });
        if (onu) {
          onu.verifyStatus = dba.matched ? 'idle' : 'check';
          onu.verifyAttempt = 0;
          await onuRepo.save(onu);
        }
      } catch (err) {
        this.logger.warn(
          `DBA plan ${saved.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return networkApply ? Object.assign(saved, { networkApply }) : saved;
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
   * Suspende o reactiva todos los servicios del cliente (no por contrato).
   * `suspended`: active → suspended (+ redportal/OLT).
   * `active`: suspended → active (+ quita portal / enable OLT).
   * Si ya están suspendidos, re-aplica red (p.ej. Disable ONU desde topología).
   */
  async setClientServicesStatus(
    user: AuthUser,
    clientId: string,
    status: 'suspended' | 'active',
  ) {
    const schema = this.requireSchema(user);
    const clientRepo = await this.tenantConnections.getClientRepository(schema);
    const client = await clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const repo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const services = await repo.find({
      where: {
        clientId,
        status: In(status === 'suspended' ? ['active', 'suspended'] : ['suspended']),
      },
    });

    const warnings: string[] = [];
    let updated = 0;
    let reapplied = 0;

    for (const svc of services) {
      try {
        if (status === 'suspended' && svc.status === 'suspended') {
          await this.applyNetworkServiceStatus(user, svc.id, 'suspended');
          reapplied += 1;
          continue;
        }
        const saved = await this.setServiceStatus(user, svc.id, status);
        updated += 1;
        const warn = (
          saved as { networkApply?: NetworkApplyResult }
        ).networkApply?.warning;
        if (warn) warnings.push(warn);
      } catch (err) {
        this.logger.warn(
          `Cliente ${clientId} status=${status} svc ${svc.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        warnings.push(
          err instanceof Error ? err.message : `Error en servicio ${svc.id}`,
        );
      }
    }

    const action =
      status === 'suspended' ? 'suspendidos' : 'reactivados';
    const message =
      updated > 0
        ? `${updated} servicio(s) ${action}.`
        : reapplied > 0
          ? `Red reaplicada en ${reapplied} servicio(s) ya suspendido(s).`
          : status === 'suspended'
            ? 'No hay servicios activos para suspender.'
            : 'No hay servicios suspendidos para reactivar.';

    return {
      ok: true as const,
      clientId,
      status,
      updated,
      reapplied,
      warnings,
      message,
      warning: warnings[0],
    };
  }

  /** Suspende servicios activos de un cliente por mora (cron de facturación). */
  async autoSuspendClientForOverdue(
    schema: string,
    clientId: string,
  ): Promise<number> {
    const tenant = await this.tenants.findOne({
      where: { schemaName: schema },
    });
    if (!tenant) return 0;

    const systemUser: AuthUser = {
      sub: 'billing-overdue',
      email: 'billing@system.local',
      role: 'tenant_user',
      name: 'Facturación',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      schemaName: schema,
      tenantRole: 'owner',
    };

    const result = await this.setClientServicesStatus(
      systemUser,
      clientId,
      'suspended',
    );
    return result.updated;
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
   * If the portal cannot apply (no WAN IP / MikroTik down), fall back to OLT disable.
   */
  private async applyNetworkServiceStatus(
    user: AuthUser,
    serviceId: string,
    status: 'suspended' | 'active',
  ): Promise<NetworkApplyResult> {
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
      return this.applyPortalSuspension(user, schema, service, status);
    }

    if (!service.onuId) return { via: 'none' };

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: service.onuId } });
    if (!onu?.oltId || !onu.onuIf) return { via: 'none' };

    if (status === 'suspended') {
      await this.onus.disable(user, onu.oltId, onu.onuIf, { fromCrm: true });
    } else {
      await this.onus.enable(user, onu.oltId, onu.onuIf, { fromCrm: true });
    }
    return { via: 'olt' };
  }

  private async applyPortalSuspension(
    user: AuthUser,
    schema: string,
    service: ClientService,
    status: 'suspended' | 'active',
  ): Promise<NetworkApplyResult> {
    if (!service.onuId) {
      throw new BadRequestException(
        'Portal de suspensión: el servicio debe tener una ONU enlazada',
      );
    }
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: service.onuId } });
    if (!onu) {
      throw new BadRequestException(
        'Portal de suspensión: ONU enlazada no encontrada',
      );
    }

    let routerId: string | null = null;
    if (onu.wanPoolId) {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const pool = await poolRepo.findOne({ where: { id: onu.wanPoolId } });
      routerId = pool?.routerId ?? null;
    }

    if (status === 'active') {
      try {
        await this.suspensionPortal.removeSuspendedIp(
          user,
          service,
          onu.wanIp?.trim() || null,
          routerId,
        );
      } catch (err) {
        this.logger.warn(
          `Quitar address-list svc=${service.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      if (
        isOnuAdminDisabled(onu.adminState) &&
        onu.oltId &&
        onu.onuIf
      ) {
        await this.onus.enable(user, onu.oltId, onu.onuIf, { fromCrm: true });
        return { via: 'olt' };
      }
      return { via: 'portal' };
    }

    const plan = planPortalSuspend({
      wanIp: onu.wanIp,
      oltId: onu.oltId,
      onuIf: onu.onuIf,
    });
    if (plan.action === 'portal') {
      try {
        await this.suspensionPortal.addSuspendedIp(
          user,
          service,
          plan.wanIp,
          routerId,
        );
        return { via: 'portal' };
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Portal falló svc=${service.id}, fallback OLT: ${reason}`,
        );
        if (onu.oltId && onu.onuIf) {
          await this.onus.disable(user, onu.oltId, onu.onuIf, {
            fromCrm: true,
          });
          return {
            via: 'olt_fallback',
            warning: `${reason} Se aplicó disable en la OLT (sin portal cautivo).`,
          };
        }
        throw err;
      }
    }

    if (!onu.oltId || !onu.onuIf) {
      throw new BadRequestException(plan.reason);
    }
    await this.onus.disable(user, onu.oltId, onu.onuIf, { fromCrm: true });
    return { via: 'olt_fallback', warning: plan.reason };
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
      suspendedClientsRow,
      salesRow,
      estimatedRow,
    ] = await Promise.all([
      clients.count({ where: { isActive: true } }),
      plans.count({ where: { isActive: true } }),
      services.count({ where: { status: 'active' } }),
      // Misma regla que el badge «Suspendido» en CRM: cliente activo (no lead)
      // con al menos un servicio suspendido.
      services
        .createQueryBuilder('s')
        .innerJoin('s.client', 'c')
        .where('s.status = :status', { status: 'suspended' })
        .andWhere('c.isActive = true')
        .andWhere('c.isLead = false')
        .select('COUNT(DISTINCT c.id)', 'cnt')
        .getRawOne<{ cnt: string }>(),
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
    const suspendedClients = Number(suspendedClientsRow?.cnt ?? 0);

    const openAlarms = await this.alarms.listOpen(schema);
    const alerts = openAlarms.map((a) => {
      const kind = a.kind as AccessAlarmKind;
      const sn = a.sn?.trim() || 'ONU';
      return {
        id: a.id,
        severity:
          kind === 'onu_los' ? ('critical' as const) : ('warning' as const),
        title: alarmTitle(kind, sn),
        message: alarmBody(kind),
        onuId: a.onuId,
        oltId: a.oltId,
      };
    });

    return {
      clientCount,
      planCount,
      activeServices,
      suspendedClients,
      salesThisMonth,
      estimatedEarnings,
      alertsCount: alerts.length,
      alerts,
    };
  }
}

function normalizePhone(phone?: string | null): string {
  return (phone ?? '').replace(/\D+/g, '');
}

function normalizeDoc(doc?: string | null): string {
  return (doc ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizePersonName(c: {
  firstName?: string;
  lastName?: string;
  companyName?: string;
}): string {
  const person = [c.firstName, c.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (person.length >= 5) return person;
  return (c.companyName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
