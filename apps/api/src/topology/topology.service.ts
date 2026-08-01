import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { SupportService } from '../support/support.service';
import type { NetworkDeviceType } from './entities/network-device.entity';
import {
  INTERNET_DEVICE_TYPE,
  INTERNET_LINKABLE_TYPES,
} from './entities/network-device.entity';
import {
  CreateNetworkDeviceDto,
  CreateNetworkLinkDto,
  CreateNetworkPortDto,
  UpdateDeviceConnectionDto,
  UpdateNetworkDeviceDto,
  UpdateNetworkPortDto,
} from './dto/topology.dto';
import {
  isManagedSwitch,
  isMikrotikRouterOsDevice,
  isMikrotikSwosDevice,
  isSwitchSubtype,
  DEFAULT_SWOS_MGMT_PORT,
} from './switch.constants';
import { saveDeviceIfPresent } from './device-persist.util';
import { MikrotikClient } from './mikrotik.client';
import { SwosClient } from './swos.client';
import { ZteOltClient } from './zte-olt.client';
import { ZteOltSnmpClient } from './zte-olt-snmp.client';
import { HuaweiOltClient } from './huawei-olt.client';
import { HuaweiOltSnmpClient } from './huawei-olt-snmp.client';
import type { NetworkDevice } from './entities/network-device.entity';
import { DeviceMetricSample } from './entities/device-metric-sample.entity';
import {
  DEFAULT_OLT_PORTS,
  detectFirmwareFamily,
  detectOltSubtypeFromProduct,
  getChassisProfile,
  detectHuaweiSubtypeFromProduct,
  getHuaweiChassisProfile,
  isHuaweiOltDevice,
  isManagedOltDevice,
  isZteOltDevice,
  OLT_SELECTABLE_SUBTYPES,
  OLT_SUBTYPE_LABELS,
} from './olt.constants';
import { formatVlanList } from './zte-olt-uplink.util';
import { OnuTypeOltSyncService } from './onu-type-olt-sync.service';
import {
  OLT_INVENTORY_CONFIG_TTL_MS,
  type CachedOltPonPort,
  type CachedOltUplink,
  type CachedOltVlan,
  type OltInventoryCache,
} from './olt-inventory-cache';

function formatUplinkVlans(vlans: number[]): string {
  return formatVlanList(vlans);
}

const INTERNET_PORT_COUNT = 8;

/** Hard budget for one MikroTik probe attempt (client has its own deadlines). */
const MIKROTIK_PROBE_TIMEOUT_MS = 25_000;
/** Whole probe sequence (first attempt + retries) must fit in this window. */
const MIKROTIK_PROBE_BUDGET_MS = 45_000;
/** After this, a probe slot is considered stuck and can be taken over. */
const PROBE_SLOT_MAX_AGE_MS = 120_000;
/** Cómo máximo espera “Guardar conexión” al probe antes de responder. */
const CONNECTION_SAVE_PROBE_WAIT_MS = 8_000;

/** Nadie escucha o no hay camino: reintentar solo alarga la espera. */
function isDeadHostProbeError(error?: string): boolean {
  if (!error) return false;
  return /EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|EHOSTDOWN|ENOTFOUND/i.test(
    error,
  );
}

/**
 * Un timeout sobre un túnel OpenVPN/TCP puede ser un stall puntual (TCP dentro
 * de TCP retransmite el doble), así que merece un reintento — pero uno solo.
 */
function isTimeoutProbeError(error?: string): boolean {
  return !!error && /timeout/i.test(error);
}

const DEVICE_TYPE_LABEL: Record<string, string> = {
  internet: 'Internet',
  router: 'Router',
  switch: 'Switch',
  olt: 'OLT',
  server: 'Servidor',
  onu: 'ONU',
  ont: 'ONT',
  cpe_router: 'CPE',
};

@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly swos: SwosClient,
    private readonly zteOlt: ZteOltClient,
    private readonly zteSnmp: ZteOltSnmpClient,
    private readonly huaweiOlt: HuaweiOltClient,
    private readonly huaweiSnmp: HuaweiOltSnmpClient,
    private readonly onuTypeSync: OnuTypeOltSyncService,
    private readonly support: SupportService,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
  ) {}

  /** Consecutive probe failures per device — avoid flapping on blips. */
  private readonly probeFailStreak = new Map<string, number>();
  /** Skip overlapping probes (OLT CLI is slow; concurrent sessions collide). */
  private readonly probeInFlight = new Map<string, number>();
  /** Coalesce concurrent CLI inventory refreshes. */
  private readonly inventoryCliInFlight = new Map<string, Promise<void>>();

  /**
   * Take the per-device probe slot. Entries older than this are stolen so a
   * probe that never settles cannot freeze the device on its last status.
   */
  private acquireProbeSlot(deviceId: string): boolean {
    const startedAt = this.probeInFlight.get(deviceId);
    if (startedAt != null && Date.now() - startedAt < PROBE_SLOT_MAX_AGE_MS) {
      return false;
    }
    this.probeInFlight.set(deviceId, Date.now());
    return true;
  }

  private releaseProbeSlot(deviceId: string) {
    this.probeInFlight.delete(deviceId);
  }

  /**
   * A probe can outlive its device row (operator deletes while it runs), and
   * `save` would re-insert it. Persist only while the row is still there.
   */
  private async persistProbedDevice(
    devices: Repository<NetworkDevice>,
    device: NetworkDevice,
  ) {
    return saveDeviceIfPresent(devices, device);
  }

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  /** Natural order: ether1, ether2, … ether10, sfp1 */
  private comparePortNames(a: string, b: string) {
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  /** Never expose password; expose hasPassword instead. */
  private sanitizeDevice<T extends NetworkDevice>(device: T) {
    const { mgmtPassword, mgmtEnablePassword, ...rest } = device;
    void mgmtEnablePassword;
    return {
      ...rest,
      hasPassword: !!mgmtPassword,
    };
  }

  /** Ensures the fixed Internet cloud exists (idempotent). */
  private async ensureInternetDevice(schema: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    let internet = await devices.findOne({
      where: { type: INTERNET_DEVICE_TYPE },
    });
    if (internet) return internet;

    internet = await devices.save(
      devices.create({
        name: 'Internet',
        type: INTERNET_DEVICE_TYPE,
        note: 'Nube WAN fija — conecta routers y switches',
        isActive: true,
      }),
    );

    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const created = [];
    for (let i = 1; i <= INTERNET_PORT_COUNT; i++) {
      created.push(
        ports.create({
          deviceId: internet.id,
          name: `WAN ${i}`,
          ipAddress: null,
          sortOrder: i,
        }),
      );
    }
    await ports.save(created);
    return internet;
  }

  async getGraph(user: AuthUser) {
    const schema = this.requireSchema(user);
    await this.ensureInternetDevice(schema);

    const devicesRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const portsRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const linksRepo =
      await this.tenantConnections.getNetworkLinkRepository(schema);

    const [devices, ports, links] = await Promise.all([
      devicesRepo.find({ order: { name: 'ASC' } }),
      portsRepo.find({ order: { sortOrder: 'ASC', name: 'ASC' } }),
      linksRepo.find({ order: { createdAt: 'ASC' } }),
    ]);

    const portsByDevice = new Map<string, typeof ports>();
    for (const port of ports) {
      const list = portsByDevice.get(port.deviceId) ?? [];
      list.push(port);
      portsByDevice.set(port.deviceId, list);
    }
    for (const [, list] of portsByDevice) {
      list.sort(
        (a, b) =>
          this.comparePortNames(a.name, b.name) || a.sortOrder - b.sortOrder,
      );
    }

    const linkByPort = new Map<string, (typeof links)[0]>();
    for (const link of links) {
      linkByPort.set(link.portAId, link);
      linkByPort.set(link.portBId, link);
    }

    const devicesWithPorts = devices.map((d) => {
      const sanitized = this.sanitizeDevice(d);
      return {
        ...sanitized,
        ports: (portsByDevice.get(d.id) ?? []).map((p) => ({
          ...p,
          linkId: linkByPort.get(p.id)?.id ?? null,
          linkedPortId:
            linkByPort.get(p.id)?.portAId === p.id
              ? (linkByPort.get(p.id)?.portBId ?? null)
              : (linkByPort.get(p.id)?.portAId ?? null),
        })),
      };
    });

    // Internet first in list for stable UI
    devicesWithPorts.sort((a, b) => {
      if (a.type === INTERNET_DEVICE_TYPE) return -1;
      if (b.type === INTERNET_DEVICE_TYPE) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      devices: devicesWithPorts,
      links,
    };
  }

  async createDevice(user: AuthUser, dto: CreateNetworkDeviceDto) {
    if (dto.type === INTERNET_DEVICE_TYPE) {
      throw new BadRequestException(
        'Internet is a fixed system asset and cannot be created manually',
      );
    }
    if (dto.type === 'router' && !dto.subtype) {
      throw new BadRequestException('Router subtype is required');
    }
    if (dto.type === 'olt' && !dto.subtype) {
      throw new BadRequestException('OLT subtype is required');
    }
    if (dto.type === 'switch' && !dto.subtype) {
      dto.subtype = 'generic';
    }
    if (
      dto.subtype &&
      dto.type !== 'router' &&
      dto.type !== 'olt' &&
      dto.type !== 'switch'
    ) {
      throw new BadRequestException(
        'Subtype is only valid for routers, switches and OLTs',
      );
    }
    if (dto.type === 'switch' && dto.subtype && !isSwitchSubtype(dto.subtype)) {
      throw new BadRequestException(`Invalid switch subtype: ${dto.subtype}`);
    }

    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);

    const device = await devices.save(
      devices.create({
        name: dto.name.trim(),
        type: dto.type as NetworkDeviceType,
        subtype:
          dto.type === 'router' || dto.type === 'olt' || dto.type === 'switch'
            ? (dto.subtype ?? (dto.type === 'switch' ? 'generic' : null))
            : null,
        note: dto.note?.trim() ?? '',
        isActive: dto.isActive ?? true,
        connectionStatus: 'unknown',
        mgmtConnectionMode: 'public',
      }),
    );

    const count =
      isMikrotikRouterOsDevice(dto.type, dto.subtype) ||
      isMikrotikSwosDevice(dto.type, dto.subtype) ||
      dto.type === 'olt'
        ? 0
        : (dto.initialPortCount ?? 0);
    if (count > 0) {
      const created = [];
      for (let i = 1; i <= count; i++) {
        created.push(
          ports.create({
            deviceId: device.id,
            name: `Port ${i}`,
            ipAddress: null,
            sortOrder: i,
            linkStatus: 'unknown',
            isSynced: false,
          }),
        );
      }
      await ports.save(created);
    }

    return this.getDeviceDetail(user, device.id);
  }

  async updateDevice(user: AuthUser, id: string, dto: UpdateNetworkDeviceDto) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');

    if (device.type === INTERNET_DEVICE_TYPE) {
      // Fixed asset: only note editable
      if (dto.note !== undefined) device.note = dto.note.trim();
      await devices.save(device);
      return this.getDeviceDetail(user, id);
    }

    if (dto.name !== undefined) device.name = dto.name.trim();
    if (dto.type !== undefined) {
      if (dto.type === INTERNET_DEVICE_TYPE) {
        throw new BadRequestException('Cannot change type to Internet');
      }
      device.type = dto.type as NetworkDeviceType;
      if (dto.type !== 'router' && dto.type !== 'olt' && dto.type !== 'switch') {
        device.subtype = null;
      }
    }
    if (dto.subtype !== undefined) {
      if (
        device.type !== 'router' &&
        device.type !== 'olt' &&
        device.type !== 'switch'
      ) {
        throw new BadRequestException(
          'Subtype is only valid for routers, switches and OLTs',
        );
      }
      if (
        device.type === 'switch' &&
        dto.subtype != null &&
        !isSwitchSubtype(dto.subtype)
      ) {
        throw new BadRequestException(`Invalid switch subtype: ${dto.subtype}`);
      }
      device.subtype = dto.subtype;
    }
    if (dto.note !== undefined) device.note = dto.note.trim();
    if (dto.isActive !== undefined) device.isActive = dto.isActive;

    await devices.save(device);
    return this.getDeviceDetail(user, id);
  }

  async deleteDevice(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (device.type === INTERNET_DEVICE_TYPE) {
      throw new BadRequestException(
        'Internet is a fixed system asset and cannot be deleted',
      );
    }
    await devices.delete({ id });
    this.releaseProbeSlot(id);
    this.probeFailStreak.delete(id);
    return { ok: true };
  }

  async getDeviceDetail(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    await this.refreshDeviceIfStale(schema, id);

    const graph = await this.getGraph(user);
    const device = graph.devices.find((d) => d.id === id);
    if (!device) throw new NotFoundException('Device not found');

    const portMap = new Map<string, { deviceId: string; name: string }>();
    for (const d of graph.devices) {
      for (const p of d.ports) {
        portMap.set(p.id, { deviceId: d.id, name: p.name });
      }
    }
    const deviceName = new Map(graph.devices.map((d) => [d.id, d.name]));

    let suggestOnuImport = false;
    let snmpMonitor: { ok: boolean; error?: string } | null = null;
    if (
      isManagedOltDevice(device.type, device.subtype) &&
      device.connectionStatus === 'connected'
    ) {
      const devices =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const raw = await devices.findOne({ where: { id } });
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onuCount = await onuRepo.count({ where: { oltId: id } });
      suggestOnuImport = onuCount === 0 && !raw?.onusImportPromptedAt;
      const summary = raw?.metricSummary ?? device.metricSummary ?? '';
      if (/SNMP OK/i.test(summary)) {
        snmpMonitor = { ok: true };
      } else if (/SNMP fail/i.test(summary)) {
        const m = summary.match(/SNMP fail:\s*([^·]+)/i);
        snmpMonitor = { ok: false, error: m?.[1]?.trim() };
      } else if (/SNMP sin community/i.test(summary)) {
        snmpMonitor = { ok: false, error: 'community missing' };
      }
    }

    return {
      ...device,
      suggestOnuImport,
      snmpMonitor,
      ports: device.ports.map((p) => {
        const linked = p.linkedPortId ? portMap.get(p.linkedPortId) : undefined;
        return {
          ...p,
          linkedDeviceName: linked
            ? (deviceName.get(linked.deviceId) ?? null)
            : null,
          linkedPortName: linked?.name ?? null,
        };
      }),
    };
  }

  /**
   * Re-probe managed devices if last check is older than maxAgeMs.
   * OLTs: SNMP RO only on auto-refresh (CLI stays for "Probar conexión").
   */
  private async refreshDeviceIfStale(
    schema: string,
    deviceId: string,
    maxAgeMs?: number,
  ) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: deviceId } });
    if (!device) return;
    const isManagedOlt = isManagedOltDevice(device.type, device.subtype);
    const probeable =
      isMikrotikRouterOsDevice(device.type, device.subtype) ||
      isMikrotikSwosDevice(device.type, device.subtype) ||
      isManagedOlt;
    if (!probeable) return;
    if (!device.mgmtHost) return;
    if (!isManagedOlt && (!device.mgmtUsername || !device.mgmtPassword)) return;
    const age = maxAgeMs ?? (isManagedOlt ? 30_000 : 12_000);
    if (
      device.lastCheckedAt &&
      Date.now() - device.lastCheckedAt.getTime() < age
    ) {
      return;
    }
    if (isManagedOlt) {
      await this.probeAndPersistOltSnmp(schema, device);
      return;
    }
    await this.probeAndPersist(schema, deviceId);
  }

  /** Background poll: MikroTik via API; ZTE OLT health via SNMP RO (no CLI). */
  async pollMikrotikDevicesInSchema(schema: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const targets = await devices.find({
      where: [
        { type: 'router', subtype: 'mikrotik', isActive: true },
        { type: 'switch', subtype: 'mikrotik_routeros', isActive: true },
        { type: 'switch', subtype: 'mikrotik_swos', isActive: true },
        {
          type: 'olt',
          subtype: In([...OLT_SELECTABLE_SUBTYPES, 'zte_c3xx']),
          isActive: true,
        },
      ],
    });
    // Parallel so a slow OLT does not delay MikroTik (and vice versa).
    await Promise.allSettled(
      targets.map(async (device) => {
        if (!device.mgmtHost) return;
        try {
          if (isManagedOltDevice(device.type, device.subtype)) {
            // Never open Telnet/SSH on the 15s ticker — SNMP RO only.
            await this.probeAndPersistOltSnmp(schema, device);
            return;
          }
          if (!device.mgmtUsername || !device.mgmtPassword) return;
          await this.probeAndPersist(schema, device.id);
        } catch {
          // Individual device failures are persisted in probe helpers
        }
      }),
    );
  }

  async updateConnection(
    user: AuthUser,
    id: string,
    dto: UpdateDeviceConnectionDto,
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (
      device.type !== 'router' &&
      device.type !== 'olt' &&
      !isManagedSwitch(device.type, device.subtype)
    ) {
      throw new BadRequestException(
        'Management connection is only available for routers, managed switches and OLTs',
      );
    }

    // Seed / datos viejos: router sin subtype → MikroTik; switch → generic; OLT → ZTE
    if (device.type === 'router' && !device.subtype) {
      device.subtype = 'mikrotik';
    }
    if (device.type === 'switch' && !device.subtype) {
      device.subtype = 'generic';
    }
    if (device.type === 'olt' && !device.subtype) {
      device.subtype = 'zte_c3xx';
    }

    if (dto.mgmtHost !== undefined) {
      device.mgmtHost = dto.mgmtHost?.trim() || null;
    }
    if (dto.mgmtPort !== undefined) device.mgmtPort = dto.mgmtPort;
    if (dto.mgmtUsername !== undefined) {
      device.mgmtUsername = dto.mgmtUsername?.trim() || null;
    }
    if (dto.mgmtPassword !== undefined && dto.mgmtPassword !== '') {
      device.mgmtPassword = dto.mgmtPassword;
    }
    if (dto.mgmtProtocol !== undefined) {
      device.mgmtProtocol = dto.mgmtProtocol;
    }
    if (dto.mgmtConnectionMode !== undefined) {
      device.mgmtConnectionMode = dto.mgmtConnectionMode || 'public';
    }
    if (dto.snmpCommunity !== undefined) {
      device.snmpCommunity = dto.snmpCommunity?.trim() || null;
    }
    if (dto.snmpCommunityRw !== undefined) {
      device.snmpCommunityRw = dto.snmpCommunityRw?.trim() || null;
    }
    if (dto.snmpPort !== undefined) device.snmpPort = dto.snmpPort;
    if (dto.ponType !== undefined) {
      device.ponType = dto.ponType?.trim() || null;
    }

    // Defaults for MikroTik RouterOS (router or switch)
    if (isMikrotikRouterOsDevice(device.type, device.subtype)) {
      if (!device.mgmtProtocol || device.mgmtProtocol === 'http') {
        device.mgmtProtocol = 'api_ssl';
      }
      if (!device.mgmtPort) {
        device.mgmtPort = device.mgmtProtocol === 'rest_https' ? 443 : 8729;
      }
    }

    // Defaults for SwitchOS
    if (isMikrotikSwosDevice(device.type, device.subtype)) {
      if (!device.mgmtProtocol || device.mgmtProtocol !== 'http') {
        device.mgmtProtocol = 'http';
      }
      if (!device.mgmtPort) device.mgmtPort = DEFAULT_SWOS_MGMT_PORT;
    }

    // Defaults for ZTE OLT
    if (isManagedOltDevice(device.type, device.subtype)) {
      if (!device.mgmtConnectionMode) device.mgmtConnectionMode = 'public';
      if (
        !device.mgmtProtocol ||
        !['telnet', 'ssh'].includes(device.mgmtProtocol)
      ) {
        device.mgmtProtocol = 'telnet';
      }
      if (!device.mgmtPort) {
        device.mgmtPort =
          DEFAULT_OLT_PORTS[device.mgmtProtocol] ?? DEFAULT_OLT_PORTS.telnet;
      }
      if (!device.snmpPort) device.snmpPort = DEFAULT_OLT_PORTS.snmp;
      if (!device.snmpCommunity) device.snmpCommunity = 'public';
      if (!device.snmpCommunityRw) device.snmpCommunityRw = 'private';
    }

    // Keep port in sync when protocol changes explicitly
    if (dto.mgmtProtocol === 'api_ssl' && dto.mgmtPort == null) {
      if (!device.mgmtPort || device.mgmtPort === 443) {
        device.mgmtPort = 8729;
      }
    }
    if (dto.mgmtProtocol === 'rest_https' && dto.mgmtPort == null) {
      if (!device.mgmtPort || device.mgmtPort === 8729) {
        device.mgmtPort = 443;
      }
    }
    if (dto.mgmtProtocol === 'http' && dto.mgmtPort == null) {
      device.mgmtPort = DEFAULT_SWOS_MGMT_PORT;
    }
    if (dto.mgmtProtocol === 'telnet' && dto.mgmtPort == null) {
      device.mgmtPort = DEFAULT_OLT_PORTS.telnet;
    }
    if (dto.mgmtProtocol === 'ssh' && dto.mgmtPort == null) {
      device.mgmtPort = DEFAULT_OLT_PORTS.ssh;
    }

    await devices.save(device);

    // Auto-probe after save if credentials present. No se espera el probe
    // completo: con un host inalcanzable tarda ~25 s y el operador solo veía
    // “Guardando…”. Sigue en background y el poller refresca el estado.
    if (device.mgmtHost && device.mgmtUsername && device.mgmtPassword) {
      const probe = this.probeAndPersist(schema, device.id).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Probe tras guardar ${device.id} falló: ${msg}`);
      });
      await Promise.race([
        probe,
        new Promise((r) => setTimeout(r, CONNECTION_SAVE_PROBE_WAIT_MS)),
      ]);
    }

    return this.getDeviceDetail(user, id);
  }

  async testConnection(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    await this.probeAndPersist(schema, id);
    return this.getDeviceDetail(user, id);
  }

  async getDeviceCards(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!isManagedOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a managed OLT');
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }

    const protocol =
      device.mgmtProtocol === 'ssh' ? 'ssh' : ('telnet' as const);
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);

    const result = await this.withTimeout(
      this.oltCli(device).listCards({
        host: device.mgmtHost,
        port,
        protocol,
        username: device.mgmtUsername,
        password: device.mgmtPassword,
      }),
      45_000,
      'ZTE OLT list cards',
    );

    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron leer las tarjetas',
      );
    }

    const probedAt = result.probedAt;
    return {
      deviceId: device.id,
      probedAt,
      summary: result.summary,
      cards: result.cards.map((c) => ({
        rack: c.rack,
        shelf: c.shelf,
        slot: c.slot,
        cfgType: c.cfgType,
        realType: c.realType,
        ports: c.ports ?? null,
        softVer: c.softVer ? c.softVer.replace(/^V/i, '') : null,
        status: /INSERVICE|OK|ACTIVE|ONLINE/i.test(c.status)
          ? 'Online'
          : c.status,
        role: c.role ?? null,
        infoUpdated: probedAt,
      })),
    };
  }

  async rebootDeviceCard(
    user: AuthUser,
    id: string,
    slot: string,
    opts?: { rack?: string; shelf?: string },
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!isManagedOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a managed OLT');
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }

    const protocol =
      device.mgmtProtocol === 'ssh' ? 'ssh' : ('telnet' as const);
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);

    const huaweiChassis = isHuaweiOltDevice(device.type, device.subtype)
      ? getHuaweiChassisProfile(device.subtype)
      : null;
    const zteChassis = huaweiChassis ? null : getChassisProfile(device.subtype);
    const rack =
      opts?.rack ??
      String(zteChassis?.defaultRackNo ?? huaweiChassis?.defaultFrame ?? 1);
    const shelf =
      opts?.shelf ??
      String(zteChassis?.defaultShelfNo ?? huaweiChassis?.defaultFrame ?? 1);

    const result = await this.withTimeout(
      this.oltCli(device).rebootCard({
        host: device.mgmtHost,
        port,
        protocol,
        username: device.mgmtUsername,
        password: device.mgmtPassword,
        rack,
        shelf,
        slot,
      }),
      45_000,
      'ZTE OLT reboot card',
    );

    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo reiniciar la tarjeta',
      );
    }

    return {
      ok: true,
      slot,
      rack,
      shelf,
      message: result.message,
    };
  }

  private zteConn(device: NetworkDevice): {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  } {
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }
    const protocol: 'telnet' | 'ssh' =
      device.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);
    return {
      host: device.mgmtHost,
      port,
      protocol,
      username: device.mgmtUsername,
      password: device.mgmtPassword,
    };
  }

  private snmpConn(device: NetworkDevice): {
    host: string;
    snmpPort: number;
    snmpCommunity: string;
  } | null {
    const community = device.snmpCommunity?.trim();
    if (!device.mgmtHost?.trim() || !community) return null;
    return {
      host: device.mgmtHost.trim(),
      snmpPort: device.snmpPort && device.snmpPort > 0 ? device.snmpPort : 161,
      snmpCommunity: community,
    };
  }

  private oltCli(device: NetworkDevice): ZteOltClient {
    return (isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiOlt
      : this.zteOlt) as unknown as ZteOltClient;
  }

  private oltSnmp(device: NetworkDevice): ZteOltSnmpClient {
    return (isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiSnmp
      : this.zteSnmp) as unknown as ZteOltSnmpClient;
  }

  private async requireManagedOlt(schema: string, id: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!isManagedOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a managed OLT');
    }
    return device;
  }

  private inventoryCache(device: NetworkDevice): OltInventoryCache {
    return { ...(device.oltInventoryCache ?? {}) };
  }

  private async saveInventoryCache(
    schema: string,
    device: NetworkDevice,
    patch: OltInventoryCache,
  ) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    // Always merge onto the DB row so concurrent SNMP/CLI writes don't wipe
    // each other's fields (vlans / configProbedAt / CLI descriptions…).
    const latest = await devices.findOne({ where: { id: device.id } });
    if (!latest) {
      // Device deleted while the CLI/SNMP refresh was running.
      return;
    }
    const next: OltInventoryCache = {
      ...this.inventoryCache(latest),
      ...patch,
    };
    latest.oltInventoryCache = next;
    device.oltInventoryCache = next;
    await saveDeviceIfPresent(devices, latest);
  }

  /**
   * Fast path: SNMP status (+ DB ONU counts for PON) merged with cached CLI config.
   * `refresh=true`: CLI sync for that panel only (PON or uplinks), not both.
   */
  async getDevicePonPorts(user: AuthUser, id: string, refresh = false) {
    const schema = this.requireSchema(user);
    let device = await this.requireManagedOlt(schema, id);
    const cache = this.inventoryCache(device);

    if (refresh) {
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'pon',
      );
      device = await this.requireManagedOlt(schema, id);
    }

    const built = await this.buildPonPortsView(schema, device, refresh);
    if (!built.ports.length && !cache.ponPorts?.length) {
      // Cold start without SNMP: one CLI pull (PON only)
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'pon',
      );
      device = await this.requireManagedOlt(schema, id);
      return this.buildPonPortsView(schema, device, true);
    }
    return built;
  }

  async getDeviceUplinks(user: AuthUser, id: string, refresh = false) {
    const schema = this.requireSchema(user);
    let device = await this.requireManagedOlt(schema, id);
    const cache = this.inventoryCache(device);

    if (refresh) {
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'uplinks',
      );
      device = await this.requireManagedOlt(schema, id);
    }

    const built = await this.buildUplinksView(schema, device);
    if (!built.uplinks.length && !cache.uplinks?.length) {
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'uplinks',
      );
      device = await this.requireManagedOlt(schema, id);
      return this.buildUplinksView(schema, device);
    }
    return built;
  }

  async getDeviceVlans(user: AuthUser, id: string, refresh = false) {
    const schema = this.requireSchema(user);
    let device = await this.requireManagedOlt(schema, id);
    const cache = this.inventoryCache(device);
    const probedAt = cache.vlansProbedAt ? Date.parse(cache.vlansProbedAt) : 0;
    const stale =
      !cache.vlans?.length ||
      !Number.isFinite(probedAt) ||
      Date.now() - probedAt > OLT_INVENTORY_CONFIG_TTL_MS;

    if (refresh || !cache.vlans?.length) {
      await this.refreshVlansViaCli(schema, device, 'interactive');
      device = await this.requireManagedOlt(schema, id);
    } else if (stale) {
      void this.refreshVlansViaCli(schema, device, 'background').catch(
        (err) => {
          this.logger.warn(
            `VLAN bg refresh ${device.name}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        },
      );
    }

    return this.buildVlansView(schema, device);
  }

  /** Background / poller: SNMP status + stale CLI config/VLANs. */
  async refreshOltInventoryForSchema(schema: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olts = await devices.find({ where: { type: 'olt' } });
    for (const olt of olts) {
      if (!isManagedOltDevice(olt.type, olt.subtype)) continue;
      try {
        await this.refreshOltInventoryStatus(schema, olt);
        const fresh = await this.requireManagedOlt(schema, olt.id);
        const cache = this.inventoryCache(fresh);
        const cfgAt = cache.configProbedAt
          ? Date.parse(cache.configProbedAt)
          : 0;
        const vlanAt = cache.vlansProbedAt
          ? Date.parse(cache.vlansProbedAt)
          : 0;
        const now = Date.now();
        const upAt = cache.uplinksConfigProbedAt
          ? Date.parse(cache.uplinksConfigProbedAt)
          : cfgAt;
        const ponAt = cache.ponConfigProbedAt
          ? Date.parse(cache.ponConfigProbedAt)
          : cfgAt;
        if (
          !cache.uplinks?.length ||
          !Number.isFinite(upAt) ||
          now - upAt > OLT_INVENTORY_CONFIG_TTL_MS
        ) {
          await this.refreshPonUplinkConfigViaCli(
            schema,
            fresh,
            'background',
            'uplinks',
          );
        }
        if (
          !cache.ponPorts?.length ||
          !Number.isFinite(ponAt) ||
          now - ponAt > OLT_INVENTORY_CONFIG_TTL_MS
        ) {
          await this.refreshPonUplinkConfigViaCli(
            schema,
            fresh,
            'background',
            'pon',
          );
        }
        if (
          !cache.vlans?.length ||
          !Number.isFinite(vlanAt) ||
          now - vlanAt > OLT_INVENTORY_CONFIG_TTL_MS
        ) {
          await this.refreshVlansViaCli(schema, fresh, 'background');
        }
        const speedAt = cache.speedProfilesProbedAt
          ? Date.parse(cache.speedProfilesProbedAt)
          : 0;
        if (
          !cache.speedProfiles?.length ||
          !Number.isFinite(speedAt) ||
          now - speedAt > OLT_INVENTORY_CONFIG_TTL_MS
        ) {
          await this.refreshSpeedProfilesViaCli(schema, fresh, 'background');
        }
      } catch (err) {
        this.logger.warn(
          `OLT inventory ${olt.name}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  private async refreshOltInventoryStatus(
    schema: string,
    device: NetworkDevice,
  ) {
    const snmp = this.snmpConn(device);
    if (!snmp) return;
    // Merge onto latest DB cache (CLI may have just written config fields).
    const latest = await this.requireManagedOlt(schema, device.id);
    const ports = await this.withTimeout(
      this.oltSnmp(latest).walkOltPorts(snmp),
      45_000,
      `SNMP ports ${latest.name}`,
    );
    if (!ports.ok) return;

    const cache = this.inventoryCache(latest);
    const byIf = new Map(
      (cache.uplinks ?? []).map((u) => [u.ifName.toLowerCase(), u]),
    );
    const uplinks: CachedOltUplink[] = ports.uplinks.map((s) => {
      const prev = byIf.get(s.ifName.toLowerCase());
      return {
        ifName: s.ifName,
        description: prev?.description ?? null,
        mediaType:
          prev?.mediaType ??
          (s.ifName.toLowerCase().startsWith('xgei_') ? 'fiber' : 'unknown'),
        adminEnabled: s.adminEnabled,
        status: s.status,
        negotiation: prev?.negotiation ?? null,
        mtu: prev?.mtu ?? null,
        wavelengthNm: prev?.wavelengthNm ?? null,
        signalDbm: prev?.signalDbm ?? null,
        tempC: prev?.tempC ?? null,
        pvidUntag: prev?.pvidUntag ?? null,
        mode: prev?.mode ?? null,
        taggedVlans: prev?.taggedVlans ?? [],
      };
    });

    const byPon = new Map(
      (cache.ponPorts ?? []).map((p) => [p.ifName.toLowerCase(), p]),
    );
    const onuStats = await this.ponOnuStatsFromDb(schema, latest.id);
    const huaweiChassis = isHuaweiOltDevice(latest.type, latest.subtype)
      ? getHuaweiChassisProfile(latest.subtype)
      : null;
    const zteChassis = huaweiChassis ? null : getChassisProfile(latest.subtype);
    const defaultShelf = String(
      zteChassis?.defaultShelfNo ?? huaweiChassis?.defaultFrame ?? 1,
    );
    const defaultRack = String(
      zteChassis?.defaultRackNo ?? huaweiChassis?.defaultFrame ?? 1,
    );
    const ponPorts: CachedOltPonPort[] = ports.ponPorts.map((s) => {
      const prev = byPon.get(s.ifName.toLowerCase());
      const key = `${s.slot}/${s.port}`.toLowerCase();
      const stats = onuStats.get(key);
      const operUp = s.operUp;
      return {
        rack: prev?.rack ?? defaultRack,
        shelf: s.shelf ?? prev?.shelf ?? defaultShelf,
        slot: s.slot ?? prev?.slot ?? '',
        port: s.port ?? prev?.port ?? '',
        ifName: s.ifName,
        boardType: prev?.boardType ?? '',
        ponType: s.family ?? prev?.ponType ?? 'gpon',
        adminEnabled: s.adminEnabled,
        status: operUp ? 'Up' : 'Down',
        onuOnline: stats?.online ?? prev?.onuOnline ?? 0,
        onuTotal: stats?.total ?? prev?.onuTotal ?? 0,
        maxOnus: prev?.maxOnus && prev.maxOnus > 0 ? prev.maxOnus : 128,
        avgSignalDbm: stats?.avgSignal ?? prev?.avgSignalDbm ?? null,
        description: prev?.description ?? null,
        minRangeM: prev?.minRangeM ?? 0,
        maxRangeM: prev?.maxRangeM ?? 20000,
        rogueDetectEnabled: prev?.rogueDetectEnabled ?? null,
        txPowerDbm: prev?.txPowerDbm ?? null,
      };
    });

    // Keep CLI-only rows SNMP did not list (partial IF-MIB / naming quirks).
    const snmpUplinkKeys = new Set(uplinks.map((u) => u.ifName.toLowerCase()));
    const mergedUplinks = [
      ...uplinks,
      ...(cache.uplinks ?? []).filter(
        (u) => !snmpUplinkKeys.has(u.ifName.toLowerCase()),
      ),
    ];

    const snmpPonKeys = new Set(ponPorts.map((p) => p.ifName.toLowerCase()));
    const mergedPon =
      ponPorts.length > 0
        ? [
            ...ponPorts,
            ...(cache.ponPorts ?? []).filter(
              (p) => !snmpPonKeys.has(p.ifName.toLowerCase()),
            ),
          ]
        : (cache.ponPorts ?? []).map((p) => {
            const live = ports.ponPorts.find(
              (s) => s.ifName.toLowerCase() === p.ifName.toLowerCase(),
            );
            if (!live) return p;
            return {
              ...p,
              adminEnabled: live.adminEnabled,
              status: live.operUp ? ('Up' as const) : ('Down' as const),
            };
          });

    await this.saveInventoryCache(schema, latest, {
      uplinks: mergedUplinks,
      ponPorts: mergedPon,
      statusProbedAt: ports.probedAt,
    });
    device.oltInventoryCache = latest.oltInventoryCache;
  }

  private async refreshPonUplinkConfigViaCli(
    schema: string,
    device: NetworkDevice,
    priority: 'interactive' | 'background' = 'background',
    scope: 'uplinks' | 'pon' | 'both' = 'both',
  ) {
    const key = `${schema}:${device.id}:ports-cli:${scope}`;
    if (this.inventoryCliInFlight.has(key)) {
      await this.inventoryCliInFlight.get(key);
      return;
    }
    const run = (async () => {
      const wantUplinks = scope === 'uplinks' || scope === 'both';
      const wantPon = scope === 'pon' || scope === 'both';

      const uplinksRes = wantUplinks
        ? await this.withTimeout(
            this.oltCli(device).listUplinks({
              ...this.zteConn(device),
              priority,
            }),
            150_000,
            'ZTE OLT uplinks CLI',
          )
        : null;
      const ponsRes = wantPon
        ? await this.withTimeout(
            this.oltCli(device).listPonPorts({
              ...this.zteConn(device),
              priority,
              light: true,
            }),
            150_000,
            'ZTE OLT PON CLI',
          )
        : null;

      // Re-read device for latest SNMP status overlay
      const fresh = await this.requireManagedOlt(schema, device.id);
      const cache = this.inventoryCache(fresh);
      const statusByIf = new Map([
        ...(cache.uplinks ?? []).map((u) => [u.ifName.toLowerCase(), u.status]),
        ...(cache.ponPorts ?? []).map((p) => [
          p.ifName.toLowerCase(),
          p.status,
        ]),
      ] as Array<[string, string]>);
      const prevUplinkByIf = new Map(
        (cache.uplinks ?? []).map((u) => [u.ifName.toLowerCase(), u]),
      );
      const prevPonByIf = new Map(
        (cache.ponPorts ?? []).map((p) => [p.ifName.toLowerCase(), p]),
      );

      const nowIso = new Date().toISOString();
      const patch: OltInventoryCache = {};

      if (wantUplinks && uplinksRes) {
        if (!uplinksRes.ok && wantPon && ponsRes && !ponsRes.ok) {
          throw new BadRequestException(
            uplinksRes.error ||
              ponsRes.error ||
              'No se pudo refrescar inventario CLI',
          );
        }
        if (!uplinksRes.ok && scope === 'uplinks') {
          throw new BadRequestException(
            uplinksRes.error || 'No se pudieron leer los uplinks',
          );
        }
        if (uplinksRes.ok) {
          // Do not wipe a good cache with an empty/truncated CLI result.
          if (!uplinksRes.uplinks.length && (cache.uplinks?.length ?? 0) > 0) {
            throw new BadRequestException(
              'Sincronización de uplinks vacía; se conserva la caché anterior',
            );
          }
          patch.uplinks = uplinksRes.uplinks.map((u) => {
            const prev = prevUplinkByIf.get(u.ifName.toLowerCase());
            return {
              ifName: u.ifName,
              description: u.description,
              mediaType:
                u.mediaType !== 'unknown'
                  ? u.mediaType
                  : (prev?.mediaType ?? u.mediaType),
              // CLI config is source of truth for admin on sync
              adminEnabled: u.adminEnabled,
              // Oper status prefers live SNMP when available
              status: statusByIf.get(u.ifName.toLowerCase()) ?? u.status,
              // Bulk CLI skips optics/negotiation — keep last known values
              negotiation: u.negotiation ?? prev?.negotiation ?? null,
              mtu: u.mtu ?? prev?.mtu ?? null,
              wavelengthNm: u.wavelengthNm ?? prev?.wavelengthNm ?? null,
              signalDbm: u.signalDbm ?? prev?.signalDbm ?? null,
              tempC: u.tempC ?? prev?.tempC ?? null,
              pvidUntag: u.pvidUntag,
              mode: u.mode,
              taggedVlans: u.taggedVlans,
            };
          });
          patch.uplinksConfigProbedAt = nowIso;
        }
      }

      if (wantPon && ponsRes) {
        if (!ponsRes.ok && scope === 'pon') {
          throw new BadRequestException(
            ponsRes.error || 'No se pudieron leer los puertos PON',
          );
        }
        if (!ponsRes.ok && scope === 'both' && !patch.uplinks) {
          throw new BadRequestException(
            ponsRes.error ||
              uplinksRes?.error ||
              'No se pudo refrescar inventario CLI',
          );
        }
        if (ponsRes.ok) {
          if (!ponsRes.ports.length && (cache.ponPorts?.length ?? 0) > 0) {
            throw new BadRequestException(
              'Sincronización PON vacía; se conserva la caché anterior',
            );
          }
          patch.ponPorts = ponsRes.ports.map((p) => {
            const prev = prevPonByIf.get(p.ifName.toLowerCase());
            const liveStatus = statusByIf.get(p.ifName.toLowerCase());
            let status: 'Up' | 'Down' = p.status;
            if (liveStatus) {
              status =
                liveStatus === 'Down' || /^down$/i.test(liveStatus)
                  ? 'Down'
                  : 'Up';
            } else if (prev?.status) {
              status = prev.status;
            }
            return {
              rack: p.rack,
              shelf: p.shelf,
              slot: p.slot,
              port: p.port,
              ifName: p.ifName,
              boardType: p.boardType,
              ponType: p.ponType,
              // CLI config is source of truth for admin on sync
              adminEnabled: p.adminEnabled,
              status,
              // Light CLI leaves counts at 0 — keep previous / DB overlay fills later
              onuOnline: p.onuOnline || prev?.onuOnline || 0,
              onuTotal: p.onuTotal || prev?.onuTotal || 0,
              maxOnus: p.maxOnus,
              avgSignalDbm: p.avgSignalDbm ?? prev?.avgSignalDbm ?? null,
              description: p.description,
              minRangeM: p.minRangeM,
              maxRangeM: p.maxRangeM,
              rogueDetectEnabled: p.rogueDetectEnabled,
              txPowerDbm: p.txPowerDbm ?? prev?.txPowerDbm ?? null,
            };
          });
          patch.ponConfigProbedAt = nowIso;
        }
      }

      if (!patch.uplinks && !patch.ponPorts) {
        throw new BadRequestException('No se pudo refrescar inventario CLI');
      }

      patch.configProbedAt = nowIso;
      await this.saveInventoryCache(schema, fresh, patch);
    })().finally(() => this.inventoryCliInFlight.delete(key));

    this.inventoryCliInFlight.set(key, run);
    await run;
  }

  private async refreshSpeedProfilesViaCli(
    schema: string,
    device: NetworkDevice,
    priority: 'interactive' | 'background' = 'background',
  ) {
    const key = `${schema}:${device.id}:speed-cli`;
    if (this.inventoryCliInFlight.has(key)) {
      await this.inventoryCliInFlight.get(key);
      return;
    }
    const run = (async () => {
      const result = await this.withTimeout(
        this.oltCli(device).listSpeedProfiles({
          ...this.zteConn(device),
          priority,
        }),
        90_000,
        'ZTE OLT speed profiles',
      );
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudieron leer los perfiles de velocidad',
        );
      }
      const fresh = await this.requireManagedOlt(schema, device.id);
      const prev = this.inventoryCache(fresh);
      if (!result.profiles.length && (prev.speedProfiles?.length ?? 0) > 0) {
        throw new BadRequestException(
          'Lista de perfiles vacía; se conserva la caché anterior',
        );
      }
      await this.saveInventoryCache(schema, fresh, {
        speedProfiles: result.profiles,
        speedProfilesProbedAt: result.probedAt,
      });
    })().finally(() => this.inventoryCliInFlight.delete(key));
    this.inventoryCliInFlight.set(key, run);
    await run;
  }

  private async refreshVlansViaCli(
    schema: string,
    device: NetworkDevice,
    priority: 'interactive' | 'background' = 'background',
  ) {
    const key = `${schema}:${device.id}:vlans-cli`;
    if (this.inventoryCliInFlight.has(key)) {
      await this.inventoryCliInFlight.get(key);
      return;
    }
    const run = (async () => {
      const result = await this.withTimeout(
        this.oltCli(device).listVlans({
          ...this.zteConn(device),
          priority,
        }),
        180_000,
        'ZTE OLT vlans CLI',
      );
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudieron leer las VLANs',
        );
      }
      const fresh = await this.requireManagedOlt(schema, device.id);
      const prev = this.inventoryCache(fresh);
      // Degenerate "solo VLAN 1" must not overwrite a richer cache.
      if (result.vlans.length <= 1 && (prev.vlans?.length ?? 0) > 1) {
        throw new BadRequestException(
          'Catálogo VLAN incompleto; se conserva la caché anterior',
        );
      }
      const vlans: CachedOltVlan[] = result.vlans.map((v) => ({
        vlanId: v.vlanId,
        description: v.description,
        isolated: v.isolated,
        usedForIptv: !!v.usedForIptv,
        onuCount: v.onuCount,
        isSystem: v.isSystem || v.vlanId === 1,
      }));
      await this.saveInventoryCache(schema, fresh, {
        vlans,
        vlansProbedAt: result.probedAt,
      });
    })().finally(() => this.inventoryCliInFlight.delete(key));
    this.inventoryCliInFlight.set(key, run);
    await run;
  }

  private async ponOnuStatsFromDb(
    schema: string,
    oltId: string,
  ): Promise<
    Map<string, { online: number; total: number; avgSignal: number | null }>
  > {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const rows = await onuRepo.find({
      where: { oltId },
      select: ['board', 'port', 'online', 'signalDbm'],
    });
    const map = new Map<
      string,
      { online: number; total: number; signals: number[] }
    >();
    for (const r of rows) {
      const key = `${r.board}/${r.port}`.toLowerCase();
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { online: 0, total: 0, signals: [] };
        map.set(key, bucket);
      }
      bucket.total += 1;
      if (r.online) bucket.online += 1;
      if (r.signalDbm != null && Number.isFinite(r.signalDbm)) {
        bucket.signals.push(r.signalDbm);
      }
    }
    const out = new Map<
      string,
      { online: number; total: number; avgSignal: number | null }
    >();
    for (const [k, v] of map) {
      out.set(k, {
        online: v.online,
        total: v.total,
        avgSignal: v.signals.length
          ? Math.round(
              (v.signals.reduce((a, b) => a + b, 0) / v.signals.length) * 10,
            ) / 10
          : null,
      });
    }
    return out;
  }

  private async buildUplinksView(schema: string, device: NetworkDevice) {
    // Prefer live SNMP overlay when available — always on latest DB cache.
    let latest = await this.requireManagedOlt(schema, device.id);
    try {
      await this.refreshOltInventoryStatus(schema, latest);
    } catch {
      /* keep cache */
    }
    latest = await this.requireManagedOlt(schema, device.id);
    const cache = this.inventoryCache(latest);
    const uplinks = cache.uplinks ?? [];
    const syncedAt =
      cache.uplinksConfigProbedAt || cache.configProbedAt || null;
    const probedAt =
      syncedAt || cache.statusProbedAt || new Date().toISOString();
    const up = uplinks.filter((u) => u.status !== 'Down').length;
    return {
      deviceId: latest.id,
      probedAt,
      syncedAt,
      source: cache.statusProbedAt ? 'snmp+cache' : 'cache',
      summary: `${up}/${uplinks.length} uplinks Up`,
      uplinks: uplinks.map((u) => ({
        ...u,
        adminState: u.adminEnabled ? 'Enabled' : 'Disabled',
        mediaTypeLabel:
          u.mediaType === 'fiber'
            ? 'Fibra'
            : u.mediaType === 'copper'
              ? 'Cobre'
              : '—',
        taggedVlansLabel: u.taggedVlans.length
          ? formatUplinkVlans(u.taggedVlans)
          : '',
        modeVlansLabel: u.mode
          ? `${u.mode}${u.taggedVlans.length ? `: ${formatUplinkVlans(u.taggedVlans)}` : ''}`
          : u.taggedVlans.length
            ? formatUplinkVlans(u.taggedVlans)
            : '—',
        infoUpdated: probedAt,
      })),
    };
  }

  private async buildPonPortsView(
    schema: string,
    device: NetworkDevice,
    _refresh: boolean,
  ) {
    void _refresh;
    let latest = await this.requireManagedOlt(schema, device.id);
    try {
      await this.refreshOltInventoryStatus(schema, latest);
    } catch {
      /* keep cache */
    }
    latest = await this.requireManagedOlt(schema, device.id);
    const cache = this.inventoryCache(latest);
    let ports = cache.ponPorts ?? [];

    // Overlay fresh ONU counts from DB even if SNMP skipped
    const onuStats = await this.ponOnuStatsFromDb(schema, latest.id);
    ports = ports.map((p) => {
      const stats = onuStats.get(`${p.slot}/${p.port}`.toLowerCase());
      if (!stats) return p;
      return {
        ...p,
        onuOnline: stats.online,
        onuTotal: stats.total,
        avgSignalDbm: stats.avgSignal ?? p.avgSignalDbm,
      };
    });

    const probedAt =
      cache.ponConfigProbedAt ||
      cache.configProbedAt ||
      cache.statusProbedAt ||
      new Date().toISOString();
    const syncedAt = cache.ponConfigProbedAt || cache.configProbedAt || null;
    const up = ports.filter((p) => p.status === 'Up').length;
    const onuOnline = ports.reduce((s, p) => s + p.onuOnline, 0);
    return {
      deviceId: latest.id,
      probedAt,
      syncedAt,
      source: cache.statusProbedAt ? 'snmp+cache' : 'cache',
      summary: `${up}/${ports.length} puertos Up · ${onuOnline} ONUs en línea`,
      ports: ports.map((p) => ({
        ...p,
        adminState: p.adminEnabled ? 'Enabled' : 'Disabled',
        loadPct:
          p.maxOnus > 0 ? Math.round((p.onuOnline / p.maxOnus) * 1000) / 10 : 0,
        infoUpdated: probedAt,
      })),
    };
  }

  private async buildVlansView(schema: string, device: NetworkDevice) {
    const cache = this.inventoryCache(device);
    const vlans = cache.vlans ?? [];
    const meta = (device.oltVlanMeta ?? {}) as Record<
      string,
      { isolated?: boolean }
    >;
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const pools = await poolRepo.find({ where: { oltId: device.id } });
    const mgmtVlans = new Set<number>();
    const internetVlans = new Set<number>();
    for (const p of pools) {
      if (p.purpose === 'management') mgmtVlans.add(p.vlanId);
      if (p.purpose === 'internet') internetVlans.add(p.vlanId);
    }
    const probedAt = cache.vlansProbedAt || new Date().toISOString();
    return {
      deviceId: device.id,
      probedAt,
      syncedAt: cache.vlansProbedAt || null,
      source: 'cache',
      summary: `${vlans.length} VLAN${vlans.length === 1 ? '' : 's'}`,
      vlans: vlans.map((v) => {
        const m = meta[String(v.vlanId)] ?? {};
        const usedForMgmt = mgmtVlans.has(v.vlanId);
        const usedForInternet = internetVlans.has(v.vlanId);
        const usedForIptv = !!v.usedForIptv;
        const parts: string[] = [];
        if (usedForMgmt) parts.push('Mgmt');
        if (usedForInternet) parts.push('Internet');
        if (usedForIptv) parts.push('IPTV');
        return {
          vlanId: v.vlanId,
          description: v.description,
          typeLabel: parts.length ? parts.join(' · ') : '—',
          usedForMgmt,
          usedForInternet,
          usedForIptv,
          isolated: typeof m.isolated === 'boolean' ? m.isolated : v.isolated,
          onuCount: v.onuCount,
          isSystem: v.isSystem || v.vlanId === 1,
        };
      }),
    };
  }

  async configureDevicePonPort(
    user: AuthUser,
    id: string,
    dto: {
      ifName: string;
      adminEnabled: boolean;
      description?: string;
      minRangeM?: number;
      maxRangeM?: number;
      maxOnus?: number | null;
    },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    if (!dto.ifName?.trim()) {
      throw new BadRequestException('ifName required');
    }
    const result = await this.withTimeout(
      this.oltCli(device).configurePonPort({
        ...this.zteConn(device),
        ifName: dto.ifName.trim(),
        adminEnabled: dto.adminEnabled,
        description: dto.description,
        minRangeM: dto.minRangeM,
        maxRangeM: dto.maxRangeM,
        maxOnus: dto.maxOnus,
      }),
      60_000,
      'ZTE OLT configure PON',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo configurar');
    }
    try {
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'pon',
      );
    } catch {
      /* ignore */
    }
    return result;
  }

  async enableAllDevicePonPorts(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const result = await this.withTimeout(
      this.oltCli(device).enableAllPonPorts(this.zteConn(device)),
      180_000,
      'ZTE OLT enable all PON',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo habilitar');
    }
    return result;
  }

  async rebootDevicePonOnus(
    user: AuthUser,
    id: string,
    opts: { ifName?: string; slot?: string; all?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const conn = this.zteConn(device);
    const cli = this.oltCli(device);
    if (opts.ifName) {
      const result = await this.withTimeout(
        cli.rebootOnusOnIf({ ...conn, ifName: opts.ifName }),
        180_000,
        'OLT reboot ONUs on port',
      );
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'Fallo al reiniciar ONUs',
        );
      }
      return result;
    }
    const result = await this.withTimeout(
      cli.rebootAllOnus({ ...conn, slot: opts.slot }),
      300_000,
      'OLT reboot all ONUs',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'Fallo al reiniciar ONUs');
    }
    return result;
  }

  async getRogueDetect(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const result = await this.withTimeout(
      this.oltCli(device).getRogueDetect(this.zteConn(device)),
      90_000,
      'OLT rogue detect status',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo leer rogue-onu-detect',
      );
    }
    return { deviceId: device.id, cards: result.cards };
  }

  async setRogueDetect(
    user: AuthUser,
    id: string,
    dto: {
      slots: string[];
      enable: boolean;
      locate?: boolean;
      autoShutdown?: boolean;
    },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    if (!dto.slots?.length) {
      throw new BadRequestException('Selecciona al menos una ranura');
    }
    const result = await this.withTimeout(
      this.oltCli(device).setRogueDetect({
        ...this.zteConn(device),
        slots: dto.slots,
        enable: dto.enable,
        locate: dto.locate,
        autoShutdown: dto.autoShutdown,
      }),
      60_000,
      'OLT set rogue detect',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo aplicar');
    }
    return result;
  }

  async checkRogueOnus(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const result = await this.withTimeout(
      this.oltCli(device).checkRogueOnus(this.zteConn(device)),
      45_000,
      'OLT check rogue',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo consultar');
    }
    return result;
  }

  async configureDeviceUplink(
    user: AuthUser,
    id: string,
    dto: {
      ifName: string;
      description?: string;
      addVlans?: string;
      removeVlans?: string;
      mode?: string;
      adminEnabled?: boolean;
    },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    if (!dto.ifName?.trim()) {
      throw new BadRequestException('ifName required');
    }
    const result = await this.withTimeout(
      this.oltCli(device).configureUplink({
        ...this.zteConn(device),
        ifName: dto.ifName.trim(),
        description: dto.description,
        addVlans: dto.addVlans,
        removeVlans: dto.removeVlans,
        mode: dto.mode,
        adminEnabled: dto.adminEnabled,
      }),
      90_000,
      'ZTE OLT configure uplink',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo configurar');
    }
    try {
      await this.refreshPonUplinkConfigViaCli(
        schema,
        device,
        'interactive',
        'uplinks',
      );
    } catch {
      /* cache will refresh on next poll / manual */
    }
    return result;
  }

  async upsertDeviceVlan(
    user: AuthUser,
    id: string,
    dto: {
      vlanId: number;
      description?: string;
      /** Defaults to true (isolated) when omitted — always on create. */
      isolated?: boolean;
    },
  ) {
    const schema = this.requireSchema(user);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await this.requireManagedOlt(schema, id);
    const vlanId = Number(dto.vlanId);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }

    const live = await this.withTimeout(
      this.oltCli(device).listVlans(this.zteConn(device)),
      120_000,
      'ZTE OLT vlans before upsert',
    );
    const existsOnOlt = live.ok && live.vlans.some((v) => v.vlanId === vlanId);

    // New VLANs are always isolated; edits may toggle.
    const isolated = !existsOnOlt
      ? true
      : dto.isolated !== undefined
        ? !!dto.isolated
        : true;

    const result = await this.withTimeout(
      this.oltCli(device).upsertVlan({
        ...this.zteConn(device),
        vlanId,
        description: dto.description,
        isolated,
      }),
      120_000,
      'ZTE OLT upsert vlan',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo guardar la VLAN',
      );
    }

    const meta = {
      ...((device.oltVlanMeta ?? {}) as Record<
        string,
        {
          isolated?: boolean;
        }
      >),
    };
    const prev = meta[String(vlanId)] ?? {};
    meta[String(vlanId)] = {
      ...prev,
      isolated,
    };
    device.oltVlanMeta = meta;
    await saveDeviceIfPresent(deviceRepo, device);

    try {
      await this.refreshVlansViaCli(schema, device, 'interactive');
    } catch {
      /* ignore */
    }

    return result;
  }

  async deleteDeviceVlan(user: AuthUser, id: string, vlanId: number) {
    const schema = this.requireSchema(user);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await this.requireManagedOlt(schema, id);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }
    if (vlanId === 1) {
      throw new BadRequestException(
        'La VLAN 1 es del sistema y no se puede eliminar',
      );
    }
    const result = await this.withTimeout(
      this.oltCli(device).deleteVlan({
        ...this.zteConn(device),
        vlanId,
      }),
      60_000,
      'ZTE OLT delete vlan',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo eliminar la VLAN',
      );
    }
    const meta = {
      ...((device.oltVlanMeta ?? {}) as Record<string, unknown>),
    };
    delete meta[String(vlanId)];
    device.oltVlanMeta = meta as NetworkDevice['oltVlanMeta'];
    await saveDeviceIfPresent(deviceRepo, device);
    // Si el refresh de abajo falla, la VLAN borrada no puede seguir listándose
    // desde la caché.
    const cached = this.inventoryCache(device);
    if (cached.vlans?.length) {
      await this.saveInventoryCache(schema, device, {
        vlans: cached.vlans.filter((v) => v.vlanId !== vlanId),
      });
    }
    try {
      await this.refreshVlansViaCli(schema, device, 'interactive');
    } catch {
      /* ignore */
    }
    return result;
  }

  async getDeviceSpeedProfiles(user: AuthUser, id: string, refresh = false) {
    const schema = this.requireSchema(user);
    let device = await this.requireManagedOlt(schema, id);
    const cache = this.inventoryCache(device);
    const probedMs = cache.speedProfilesProbedAt
      ? Date.parse(cache.speedProfilesProbedAt)
      : 0;
    const stale =
      !cache.speedProfiles?.length ||
      !Number.isFinite(probedMs) ||
      Date.now() - probedMs > OLT_INVENTORY_CONFIG_TTL_MS;

    if (refresh || !cache.speedProfiles?.length) {
      await this.refreshSpeedProfilesViaCli(schema, device, 'interactive');
      device = await this.requireManagedOlt(schema, id);
    } else if (stale) {
      void this.refreshSpeedProfilesViaCli(schema, device, 'background').catch(
        (err) => {
          this.logger.warn(
            `Speed profiles bg refresh ${device.name}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        },
      );
    }

    const latest = this.inventoryCache(device);
    return {
      deviceId: device.id,
      probedAt: latest.speedProfilesProbedAt || new Date().toISOString(),
      syncedAt: latest.speedProfilesProbedAt || null,
      source: latest.speedProfiles?.length ? 'cache' : 'live',
      profiles: latest.speedProfiles ?? [],
    };
  }

  async upsertDeviceSpeedProfile(
    user: AuthUser,
    id: string,
    dto: { name: string; downloadMbps: number; uploadMbps: number },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const result = await this.withTimeout(
      this.oltCli(device).upsertSpeedProfile({
        ...this.zteConn(device),
        name: dto.name,
        downloadMbps: Number(dto.downloadMbps),
        uploadMbps: Number(dto.uploadMbps),
      }),
      90_000,
      'ZTE OLT upsert speed profile',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo guardar el perfil de velocidad',
      );
    }
    try {
      await this.refreshSpeedProfilesViaCli(schema, device, 'interactive');
    } catch {
      /* next sync will refresh */
    }
    return result;
  }

  async deleteDeviceSpeedProfile(user: AuthUser, id: string, name: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireManagedOlt(schema, id);
    const cache = this.inventoryCache(device);
    const decoded = decodeURIComponent(name);
    const cachedMatch = (cache.speedProfiles ?? []).find(
      (p) => p.name.toLowerCase() === decoded.toLowerCase(),
    );
    // Prefer cache names; only hit OLT list if cache miss
    let match = cachedMatch ?? null;
    if (!match) {
      const live = await this.withTimeout(
        this.oltCli(device).listSpeedProfiles(this.zteConn(device)),
        90_000,
        'ZTE OLT speed profiles before delete',
      );
      match = live.ok
        ? (live.profiles.find(
            (p) => p.name.toLowerCase() === decoded.toLowerCase(),
          ) ?? null)
        : null;
    }
    const result = await this.withTimeout(
      this.oltCli(device).deleteSpeedProfile({
        ...this.zteConn(device),
        name: decoded,
        uploadProfile: match?.uploadProfile,
        downloadProfile: match?.downloadProfile,
      }),
      90_000,
      'ZTE OLT delete speed profile',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo eliminar el perfil de velocidad',
      );
    }
    try {
      await this.refreshSpeedProfilesViaCli(schema, device, 'interactive');
    } catch {
      /* next sync will refresh */
    }
    return result;
  }

  /**
   * Execute MikroTik API-SSL/plain command (print path or raw words).
   * Requires saved credentials and mikrotik subtype.
   */
  async runMikrotikCommand(
    user: AuthUser,
    id: string,
    dto: { path?: string; words?: string[] },
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!isMikrotikRouterOsDevice(device.type, device.subtype)) {
      throw new BadRequestException(
        'Device is not a MikroTik RouterOS device',
      );
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }

    const protocol = device.mgmtProtocol ?? 'api_ssl';
    if (protocol !== 'api_ssl' && protocol !== 'api_plain') {
      throw new BadRequestException(
        'API commands require protocol api_ssl or api_plain (not REST)',
      );
    }

    const port = device.mgmtPort ?? (protocol === 'api_plain' ? 8728 : 8729);
    const useTls = protocol === 'api_ssl';

    if (dto.words?.length) {
      return this.mikrotik.runWords({
        host: device.mgmtHost,
        port,
        username: device.mgmtUsername,
        password: device.mgmtPassword,
        words: dto.words,
        useTls,
      });
    }
    if (dto.path) {
      return this.mikrotik.runPrint({
        host: device.mgmtHost,
        port,
        username: device.mgmtUsername,
        password: device.mgmtPassword,
        path: dto.path,
        useTls,
      });
    }
    throw new BadRequestException('Provide path or words');
  }

  private async probeAndPersist(schema: string, deviceId: string) {
    if (!this.acquireProbeSlot(deviceId)) {
      return;
    }
    try {
      return await this.probeAndPersistUnlocked(schema, deviceId);
    } finally {
      this.releaseProbeSlot(deviceId);
    }
  }

  private async probeAndPersistUnlocked(schema: string, deviceId: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      device.connectionStatus = 'disconnected';
      device.lastError = 'Missing host, username or password';
      device.lastCheckedAt = new Date();
      await this.persistProbedDevice(devices, device);
      return device;
    }

    if (device.type === 'olt' && !device.subtype) {
      // Seed / datos viejos: OLT sin modelo → bucket genérico ZTE (se afina al probe)
      // Huawei always picks an explicit subtype in the create form.
      device.subtype = 'zte_c3xx';
      await this.persistProbedDevice(devices, device);
    }

    if (isZteOltDevice(device.type, device.subtype)) {
      return this.probeAndPersistZteOlt(schema, device);
    }
    if (isHuaweiOltDevice(device.type, device.subtype)) {
      return this.probeAndPersistHuaweiOlt(schema, device);
    }

    // Routers sin subtype (p.ej. seed antiguo): asumir MikroTik
    if (device.type === 'router' && !device.subtype) {
      device.subtype = 'mikrotik';
      await this.persistProbedDevice(devices, device);
    }
    if (device.type === 'switch' && !device.subtype) {
      device.subtype = 'generic';
      await this.persistProbedDevice(devices, device);
    }

    if (isMikrotikSwosDevice(device.type, device.subtype)) {
      return this.probeAndPersistSwos(schema, device);
    }

    if (!isMikrotikRouterOsDevice(device.type, device.subtype)) {
      device.connectionStatus = 'error';
      device.lastError = `Probe not implemented for subtype ${device.subtype ?? 'unknown'} yet`;
      device.lastCheckedAt = new Date();
      await this.persistProbedDevice(devices, device);
      return device;
    }

    const probeParams = {
      host: device.mgmtHost,
      port:
        device.mgmtPort ?? (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
    };

    // Always bounded: an unreachable or filtered host must surface as an error
    // instead of leaving "Probar conexión" pending forever.
    const probeOnce = () =>
      this.withTimeout(
        this.mikrotik.probe(probeParams),
        MIKROTIK_PROBE_TIMEOUT_MS,
        `MikroTik probe ${probeParams.host}`,
      ).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

    // Reintentar cortes transitorios de la API RouterOS (“Connection closed”,
    // carreras de login) y un timeout aislado; nunca un host muerto.
    const deadline = Date.now() + MIKROTIK_PROBE_BUDGET_MS;
    const maxAttempts = (error?: string) => (isTimeoutProbeError(error) ? 1 : 2);
    let result = await probeOnce();
    if (!result.ok && !isDeadHostProbeError(result.error)) {
      const retries = maxAttempts(result.error);
      for (let attempt = 1; attempt <= retries; attempt++) {
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
        result = await probeOnce();
        if (result.ok || isDeadHostProbeError(result.error)) break;
      }
    }

    device.lastCheckedAt = new Date();
    if (result.ok) {
      this.probeFailStreak.delete(device.id);
      device.connectionStatus = 'connected';
      device.lastError = null;
      device.metricCpuLoad = result.cpuLoad ?? null;
      device.metricFreeMemory =
        result.freeMemory != null ? String(result.freeMemory) : null;
      device.metricTotalMemory =
        result.totalMemory != null ? String(result.totalMemory) : null;
      device.metricUptime = result.uptime ?? null;
      device.metricIdentity = result.identity ?? null;
      device.metricVersion = result.version ?? null;
      device.metricBoardName = result.boardName ?? null;
      device.metricTemperature =
        result.temperature != null && Number.isFinite(result.temperature)
          ? result.temperature
          : null;
      if (!(await this.persistProbedDevice(devices, device))) {
        // Deleted while probing: skip metrics/ports so nothing recreates it
        return device;
      }

      try {
        await this.recordMetricSample(schema, device, result);
      } catch {
        // History is best-effort — never fail the live connection on it
      }

      if (result.physicalPorts?.length) {
        try {
          await this.syncMikrotikPhysicalPorts(
            schema,
            device.id,
            result.physicalPorts,
          );
        } catch {
          // Port sync failure should not flip connection status
        }
      }
    } else {
      const streak = (this.probeFailStreak.get(device.id) ?? 0) + 1;
      this.probeFailStreak.set(device.id, streak);
      const errMsg = result.error ?? 'Connection failed';
      // Need 3 consecutive failures before marking disconnected if we were live
      const failThreshold = 3;
      let becameDown = false;
      if (device.connectionStatus === 'connected' && streak < failThreshold) {
        device.lastError = `Inestable (${streak}/${failThreshold}): ${errMsg}`;
        // Keep connected + last metrics so the dashboard doesn't flap
      } else {
        becameDown = device.connectionStatus === 'connected';
        device.connectionStatus = 'disconnected';
        device.lastError = errMsg;
      }
      await this.persistProbedDevice(devices, device);
      if (becameDown) {
        void this.notifyTenantAdminsDeviceDown(schema, device);
      }
    }

    return device;
  }

  /** SwitchOS probe via HTTP digest `.b` endpoints (read-only). */
  private async probeAndPersistSwos(schema: string, device: NetworkDevice) {
    if (!this.acquireProbeSlot(device.id)) return device;
    try {
      return await this.probeAndPersistSwosUnlocked(schema, device);
    } finally {
      this.releaseProbeSlot(device.id);
    }
  }

  private async probeAndPersistSwosUnlocked(
    schema: string,
    device: NetworkDevice,
  ) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      device.connectionStatus = 'disconnected';
      device.lastError = 'Missing host, username or password';
      device.lastCheckedAt = new Date();
      await this.persistProbedDevice(devices, device);
      return device;
    }

    const result = await this.withTimeout(
      this.swos.probe({
        host: device.mgmtHost,
        port: device.mgmtPort ?? DEFAULT_SWOS_MGMT_PORT,
        username: device.mgmtUsername,
        password: device.mgmtPassword,
      }),
      25_000,
      `SwOS probe ${device.mgmtHost}`,
    ).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));

    device.lastCheckedAt = new Date();
    if (result.ok) {
      this.probeFailStreak.delete(device.id);
      device.connectionStatus = 'connected';
      device.lastError = null;
      device.metricIdentity = result.identity ?? null;
      device.metricVersion = result.version ?? null;
      device.metricBoardName = result.boardName ?? null;
      device.metricUptime = result.uptime ?? null;
      device.metricCpuLoad = null;
      device.metricFreeMemory = null;
      device.metricTotalMemory = null;
      device.metricTemperature = null;
      if (!(await this.persistProbedDevice(devices, device))) return device;
      if (result.physicalPorts?.length) {
        try {
          await this.syncMikrotikPhysicalPorts(
            schema,
            device.id,
            result.physicalPorts,
          );
        } catch {
          /* port sync best-effort */
        }
      }
    } else {
      const streak = (this.probeFailStreak.get(device.id) ?? 0) + 1;
      this.probeFailStreak.set(device.id, streak);
      const errMsg = result.error ?? 'Connection failed';
      if (device.connectionStatus === 'connected' && streak < 3) {
        device.lastError = `Inestable (${streak}/3): ${errMsg}`;
      } else {
        device.connectionStatus = 'disconnected';
        device.lastError = errMsg;
      }
      await this.persistProbedDevice(devices, device);
    }
    return device;
  }

  /**
   * Lightweight OLT liveness via SNMP RO (sysUpTime).
   * Used by background pollers — never opens Telnet/SSH.
   */
  private async probeAndPersistOltSnmp(schema: string, device: NetworkDevice) {
    if (!this.acquireProbeSlot(device.id)) return;
    try {
      const devices =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const community = device.snmpCommunity?.trim();
      device.lastCheckedAt = new Date();

      if (!device.mgmtHost || !community) {
        // Keep previous status; mark summary so UI can hint to configure SNMP.
        const summary = device.metricSummary ?? '';
        if (!/SNMP sin community/i.test(summary)) {
          device.metricSummary = summary
            ? `${summary} · SNMP sin community RO`
            : 'SNMP sin community RO';
        }
        await this.persistProbedDevice(devices, device);
        return;
      }

      const snmp = await this.oltSnmp(device).probeSnmp({
        host: device.mgmtHost,
        snmpPort: device.snmpPort,
        snmpCommunity: community,
      });

      if (snmp.ok) {
        this.probeFailStreak.delete(device.id);
        device.connectionStatus = 'connected';
        device.lastError = null;
        const summary = (device.metricSummary ?? '')
          .replace(/\s*·\s*SNMP fail:[^·]*/gi, '')
          .replace(/\s*·\s*SNMP sin community RO/gi, '')
          .replace(/\s*·\s*SNMP OK \(monitoreo\)/gi, '')
          .trim();
        device.metricSummary = summary
          ? `${summary} · SNMP OK (monitoreo)`
          : 'SNMP OK (monitoreo)';
        if (
          snmp.sysUpTimeTicks != null &&
          Number.isFinite(snmp.sysUpTimeTicks)
        ) {
          const sec = Math.floor(snmp.sysUpTimeTicks / 100);
          const d = Math.floor(sec / 86400);
          const h = Math.floor((sec % 86400) / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = sec % 60;
          device.metricUptime = `${d} Days, ${h} Hours, ${m} Minutes, ${s} Seconds`;
        }
        await this.persistProbedDevice(devices, device);
        return;
      }

      const streak = (this.probeFailStreak.get(device.id) ?? 0) + 1;
      this.probeFailStreak.set(device.id, streak);
      const errMsg = snmp.error ?? 'SNMP unreachable';
      const failThreshold = 3;
      let becameDown = false;
      if (device.connectionStatus === 'connected' && streak < failThreshold) {
        device.lastError = `SNMP inestable (${streak}/${failThreshold}): ${errMsg}`;
      } else {
        becameDown = device.connectionStatus === 'connected';
        device.connectionStatus = 'disconnected';
        device.lastError = `SNMP: ${errMsg}`;
      }
      const summary = (device.metricSummary ?? '')
        .replace(/\s*·\s*SNMP OK \(monitoreo\)/gi, '')
        .replace(/\s*·\s*SNMP fail:[^·]*/gi, '')
        .trim();
      device.metricSummary = summary
        ? `${summary} · SNMP fail: ${errMsg.slice(0, 80)}`
        : `SNMP fail: ${errMsg.slice(0, 80)}`;
      await this.persistProbedDevice(devices, device);
      if (becameDown) {
        void this.notifyTenantAdminsDeviceDown(schema, device);
      }
    } finally {
      this.releaseProbeSlot(device.id);
    }
  }

  private async probeAndPersistHuaweiOlt(
    schema: string,
    device: NetworkDevice,
  ) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const result = await this.withTimeout(
      this.huaweiOlt.probe({
        ...this.zteConn(device),
        subtypeHint: device.subtype,
      }),
      55_000,
      'Huawei OLT probe',
    ).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    device.lastCheckedAt = new Date();
    if (!result.ok) {
      device.connectionStatus = 'disconnected';
      device.lastError = result.error ?? 'Connection failed';
      await this.persistProbedDevice(devices, device);
      return device;
    }
    this.probeFailStreak.delete(device.id);
    device.connectionStatus = 'connected';
    device.lastError = null;
    const detectedSubtype = detectHuaweiSubtypeFromProduct(result.product);
    if (detectedSubtype) device.subtype = detectedSubtype;
    device.metricBoardName =
      result.product ?? device.metricBoardName ?? 'Huawei OLT';
    device.metricIdentity = result.hostname ?? device.metricIdentity;
    const cleanSoftRaw =
      result.softVer
        ?.replace(/\s*[·|]\s*(ma5600t|ma5800|unknown)\s*$/i, '')
        .trim() || null;
    const cleanSoft =
      cleanSoftRaw && !/^(ma5600t|ma5800|unknown)$/i.test(cleanSoftRaw)
        ? cleanSoftRaw
        : null;
    device.metricVersion = cleanSoft || device.metricVersion;
    device.ponType = result.ponType ?? device.ponType;
    const dialect =
      result.firmwareFamily && result.firmwareFamily !== 'unknown'
        ? `dialect ${result.firmwareFamily}`
        : null;
    const parts = [result.rawCardSummary ?? null, cleanSoft, dialect];
    const community = device.snmpCommunity?.trim();
    if (community && device.mgmtHost) {
      const snmp = await this.huaweiSnmp.probeSnmp({
        host: device.mgmtHost,
        snmpPort: device.snmpPort,
        snmpCommunity: community,
      });
      parts.push(
        snmp.ok
          ? 'SNMP OK (monitoreo)'
          : `SNMP fail: ${(snmp.error ?? 'error').slice(0, 80)}`,
      );
    } else {
      parts.push('SNMP sin community RO');
    }
    device.metricSummary = parts.filter(Boolean).join(' · ') || null;
    if (!(await this.persistProbedDevice(devices, device))) {
      // Deleted while probing: skip metrics/type sync so nothing recreates it
      return device;
    }
    try {
      await this.recordMetricSample(schema, device, result);
    } catch {
      /* history is best effort */
    }
    try {
      await this.onuTypeSync.syncTypesForConnectedOlt(schema, device);
    } catch (err) {
      this.logger.warn(
        `Huawei ONU-type sync after probe: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return device;
  }

  private async probeAndPersistZteOlt(schema: string, device: NetworkDevice) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const protocol =
      device.mgmtProtocol === 'ssh' ? 'ssh' : ('telnet' as const);
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);

    const probeOnce = () =>
      this.withTimeout(
        this.zteOlt.probe({
          host: device.mgmtHost!,
          port,
          protocol,
          username: device.mgmtUsername!,
          password: device.mgmtPassword!,
          subtypeHint: device.subtype,
        }),
        55_000,
        'ZTE OLT probe',
      );

    let result = await probeOnce().catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (!result.ok) {
      await new Promise((r) => setTimeout(r, 800));
      result = await probeOnce().catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));
    }

    device.lastCheckedAt = new Date();
    if (result.ok) {
      this.probeFailStreak.delete(device.id);
      device.connectionStatus = 'connected';
      device.lastError = null;
      const detectedSubtype = detectOltSubtypeFromProduct(result.product);
      const boardLabel = detectedSubtype
        ? OLT_SUBTYPE_LABELS[detectedSubtype]
        : result.product;
      device.metricBoardName =
        boardLabel ?? device.metricBoardName ?? 'ZTE OLT';
      device.metricIdentity = result.hostname ?? device.metricIdentity;
      const softVer = result.softVer?.trim() || null;
      if (softVer) device.metricVersion = softVer;
      const family =
        detectFirmwareFamily(softVer, detectedSubtype ?? device.subtype) ??
        (result.firmwareFamily === 'c6xx'
          ? 'titan'
          : result.firmwareFamily === 'c3xx'
            ? detectFirmwareFamily(softVer)
            : null);
      const dialectNote =
        result.firmwareFamily && result.firmwareFamily !== 'unknown'
          ? `dialect ${result.firmwareFamily}`
          : null;
      const detectedPon = result.ponType;
      if (detectedPon) {
        device.ponType = detectedPon;
      }
      device.metricCpuLoad =
        result.cpuLoad != null && Number.isFinite(result.cpuLoad)
          ? Math.round(result.cpuLoad)
          : device.metricCpuLoad;
      device.metricFreeMemory =
        result.freeMemory != null
          ? String(result.freeMemory)
          : device.metricFreeMemory;
      device.metricTotalMemory =
        result.totalMemory != null
          ? String(result.totalMemory)
          : device.metricTotalMemory;
      device.metricUptime = result.uptime ?? device.metricUptime;
      device.metricTemperature =
        result.temperature != null && Number.isFinite(result.temperature)
          ? result.temperature
          : device.metricTemperature;
      const parts = [
        result.rawCardSummary ?? null,
        family ? (family === 'titan' ? 'FW Titan' : `FW ${family}.x`) : softVer,
        dialectNote,
        detectedPon
          ? `PON ${detectedPon === 'gpon_epon' ? 'GPON+EPON' : detectedPon.toUpperCase()}`
          : null,
        detectedSubtype &&
        device.subtype &&
        device.subtype !== 'zte_c3xx' &&
        detectedSubtype !== device.subtype
          ? `Detectado ${OLT_SUBTYPE_LABELS[detectedSubtype]}`
          : null,
      ].filter(Boolean);

      // SNMP RO health — does not block CLI success; never uses RW community.
      const community = device.snmpCommunity?.trim();
      let snmpMonitor: { ok: boolean; error?: string } | null = null;
      if (community && device.mgmtHost) {
        const snmp = await this.zteSnmp.probeSnmp({
          host: device.mgmtHost,
          snmpPort: device.snmpPort,
          snmpCommunity: community,
        });
        snmpMonitor = snmp.ok
          ? { ok: true }
          : { ok: false, error: snmp.error ?? 'fail' };
        parts.push(
          snmp.ok
            ? 'SNMP OK (monitoreo)'
            : `SNMP fail: ${(snmp.error ?? 'error').slice(0, 80)}`,
        );
      } else {
        parts.push('SNMP sin community RO');
        snmpMonitor = { ok: false, error: 'community missing' };
      }

      device.metricSummary = parts.length ? parts.join(' · ') : null;
      // Migrate legacy bucket or auto-set C6xx/C3xx when product is clear
      if (detectedSubtype) {
        if (
          !device.subtype ||
          device.subtype === 'zte_c3xx' ||
          (device.subtype.startsWith('zte_') &&
            detectedSubtype !== device.subtype &&
            (device.subtype.startsWith('zte_c6') ||
              detectedSubtype.startsWith('zte_c6')))
        ) {
          // Always adopt clear C6xx detection; migrate legacy; keep explicit C3xx unless C6xx detected
          if (
            device.subtype === 'zte_c3xx' ||
            !device.subtype ||
            detectedSubtype.startsWith('zte_c6')
          ) {
            device.subtype = detectedSubtype;
          }
        }
      }
      if (!(await this.persistProbedDevice(devices, device))) {
        // Deleted while probing: skip metrics/type sync so nothing recreates it
        return device;
      }

      try {
        await this.recordMetricSample(schema, device, result);
      } catch {
        // History is best-effort
      }

      // Silent ONU-type sync: OLT ↔ catalog + push missing profiles
      try {
        const sync = await this.onuTypeSync.syncTypesForConnectedOlt(
          schema,
          device,
        );
        if (!sync.ok) {
          device.lastError = device.lastError
            ? device.lastError
            : `ONU types: ${sync.error ?? 'sync parcial'}`;
        }
      } catch {
        // Type sync is best-effort; connection itself succeeded
      }

      // Attach ephemeral SNMP status for the caller (test connection UI).
      (
        device as NetworkDevice & { snmpMonitor?: typeof snmpMonitor }
      ).snmpMonitor = snmpMonitor;
    } else {
      const streak = (this.probeFailStreak.get(device.id) ?? 0) + 1;
      this.probeFailStreak.set(device.id, streak);
      const errMsg = result.error ?? 'Connection failed';
      const failThreshold = 3;
      let becameDown = false;
      if (device.connectionStatus === 'connected' && streak < failThreshold) {
        device.lastError = `Inestable (${streak}/${failThreshold}): ${errMsg}`;
      } else {
        becameDown = device.connectionStatus === 'connected';
        device.connectionStatus = 'disconnected';
        device.lastError = errMsg;
      }
      await this.persistProbedDevice(devices, device);
      if (becameDown) {
        void this.notifyTenantAdminsDeviceDown(schema, device);
      }
    }
    return device;
  }

  /** Avisa a owner/admin del tenant cuando un equipo pasa de conectado → caído. */
  private async notifyTenantAdminsDeviceDown(
    schema: string,
    device: NetworkDevice,
  ) {
    try {
      const tenant = await this.tenants.findOne({
        where: { schemaName: schema },
      });
      if (!tenant) return;

      const usersRepo = await this.tenantConnections.getUserRepository(schema);
      const admins = await usersRepo.find({
        where: [
          { role: 'owner', isActive: true },
          { role: 'admin', isActive: true },
        ],
      });
      if (admins.length === 0) return;

      let nodeLabel = '';
      if (device.nodeId) {
        try {
          const nodes =
            await this.tenantConnections.getNetworkNodeRepository(schema);
          const node = await nodes.findOne({ where: { id: device.nodeId } });
          if (node?.name) nodeLabel = ` · Nodo ${node.name}`;
        } catch {
          // ignore
        }
      }

      const typeLabel =
        DEVICE_TYPE_LABEL[device.type] ?? device.type ?? 'Equipo';
      const host = device.mgmtHost ? ` (${device.mgmtHost})` : '';
      const title = `Caída: ${device.name}`;
      const body = `${typeLabel} sin conexión${host}${nodeLabel}`;

      await Promise.all(
        admins.map((admin) =>
          this.support.notifyTenantUser({
            tenantId: tenant.id,
            userId: admin.id,
            type: 'device_down',
            title,
            body,
            link: '/app/topology',
            meta: {
              deviceId: device.id,
              deviceType: device.type,
              nodeId: device.nodeId,
              schema,
            },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo notificar caída de ${device.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timeout after ${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async recordMetricSample(
    schema: string,
    device: NetworkDevice,
    result: {
      cpuLoad?: number;
      freeMemory?: number;
      totalMemory?: number;
      temperature?: number;
      uptime?: string;
    },
  ) {
    const samples =
      await this.tenantConnections.getDeviceMetricSampleRepository(schema);
    const free = result.freeMemory;
    const total = result.totalMemory;
    let memoryUsedPct: number | null = null;
    if (
      free != null &&
      total != null &&
      Number.isFinite(free) &&
      Number.isFinite(total) &&
      total > 0
    ) {
      memoryUsedPct = Math.round(((total - free) / total) * 1000) / 10;
    }
    const uptimeSeconds = this.parseUptimeSeconds(result.uptime);
    await samples.save(
      samples.create({
        deviceId: device.id,
        sampledAt: new Date(),
        cpuLoad: result.cpuLoad ?? null,
        memoryUsedPct,
        temperature:
          result.temperature != null && Number.isFinite(result.temperature)
            ? result.temperature
            : null,
        uptimeSeconds: uptimeSeconds != null ? String(uptimeSeconds) : null,
      }),
    );

    // Keep ~48h of history
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await samples
      .createQueryBuilder()
      .delete()
      .from(DeviceMetricSample)
      .where('device_id = :deviceId', { deviceId: device.id })
      .andWhere('sampled_at < :cutoff', { cutoff })
      .execute();
  }

  /** Parse RouterOS `1w2d3h4m5s` or ZTE `6 Days, 6 Hours, 51 Minutes, 41 Seconds`. */
  private parseUptimeSeconds(uptime?: string | null): number | null {
    if (!uptime?.trim()) return null;
    const text = uptime.trim();

    // ZTE / verbose: "6 Days, 6 Hours, 51 Minutes, 41 Seconds"
    const verbose = text.match(
      /(?:(\d+)\s*days?)?[,\s]*(?:(\d+)\s*hours?)?[,\s]*(?:(\d+)\s*minutes?)?[,\s]*(?:(\d+)\s*seconds?)?/i,
    );
    if (
      verbose &&
      /day|hour|minute|second/i.test(text) &&
      (verbose[1] || verbose[2] || verbose[3] || verbose[4])
    ) {
      return (
        Number(verbose[1] || 0) * 86400 +
        Number(verbose[2] || 0) * 3600 +
        Number(verbose[3] || 0) * 60 +
        Number(verbose[4] || 0)
      );
    }

    const re = /(\d+)\s*([wdhms])/gi;
    let total = 0;
    let matched = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matched = true;
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      if (u === 'w') total += n * 7 * 24 * 3600;
      else if (u === 'd') total += n * 24 * 3600;
      else if (u === 'h') total += n * 3600;
      else if (u === 'm') total += n * 60;
      else if (u === 's') total += n;
    }
    return matched ? total : null;
  }

  async getDeviceMetricHistory(user: AuthUser, deviceId: string, hours = 6) {
    const schema = this.requireSchema(user);
    await this.refreshDeviceIfStale(schema, deviceId);

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const clampedHours = Math.min(Math.max(hours || 6, 1), 48);
    const since = new Date(Date.now() - clampedHours * 60 * 60 * 1000);
    const samples =
      await this.tenantConnections.getDeviceMetricSampleRepository(schema);
    const filtered = await samples
      .createQueryBuilder('s')
      .where('s.deviceId = :deviceId', { deviceId })
      .andWhere('s.sampledAt >= :since', { since })
      .orderBy('s.sampledAt', 'ASC')
      .getMany();

    return {
      deviceId: device.id,
      name: device.name,
      boardName: device.metricBoardName,
      hours: clampedHours,
      current: {
        cpuLoad: device.metricCpuLoad,
        freeMemory: device.metricFreeMemory,
        totalMemory: device.metricTotalMemory,
        uptime: device.metricUptime,
        temperature: device.metricTemperature,
        connectionStatus: device.connectionStatus,
      },
      samples: filtered.map((r) => ({
        at: r.sampledAt.toISOString(),
        cpuLoad: r.cpuLoad,
        memoryUsedPct: r.memoryUsedPct,
        temperature: r.temperature,
        uptimeSeconds: r.uptimeSeconds != null ? Number(r.uptimeSeconds) : null,
      })),
    };
  }

  /**
   * Upsert physical ethernet ports discovered from MikroTik.
   * Identity is default-name / MAC (stable), not the display name — so renames
   * on the router update the existing port instead of creating a duplicate.
   */
  private async syncMikrotikPhysicalPorts(
    schema: string,
    deviceId: string,
    physicalPorts: Array<{
      name: string;
      defaultName?: string;
      macAddress?: string;
      comment?: string;
      ipAddress?: string | null;
      ipAddresses?: string[];
      linkStatus: 'up' | 'down' | 'disabled';
      vlans?: Array<{
        vlanId: number;
        mode: 'tagged' | 'untagged';
        interfaceName?: string;
        ipAddresses?: string[];
        comment?: string;
      }>;
    }>,
  ) {
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const existing = await ports.find({
      where: { deviceId },
      order: { sortOrder: 'ASC' },
    });

    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
    const byDefaultName = new Map(
      existing
        .filter((p) => p.defaultName)
        .map((p) => [p.defaultName!.toLowerCase(), p]),
    );
    const byMac = new Map(
      existing
        .filter((p) => p.macAddress)
        .map((p) => [p.macAddress!.toLowerCase(), p]),
    );

    let nextOrder =
      existing.reduce((max, p) => Math.max(max, p.sortOrder), 0) + 1;

    const vlansKey = (
      vlans:
        | Array<{
            vlanId: number;
            mode: string;
            interfaceName?: string;
            ipAddresses?: string[];
            comment?: string;
          }>
        | null
        | undefined,
    ) =>
      JSON.stringify(
        (vlans ?? [])
          .map((v) => ({
            vlanId: v.vlanId,
            mode: v.mode,
            interfaceName: v.interfaceName ?? '',
            comment: v.comment ?? '',
            ipAddresses: [...(v.ipAddresses ?? [])].sort(),
          }))
          .sort((a, b) => a.vlanId - b.vlanId || a.mode.localeCompare(b.mode)),
      );

    const ipsKey = (ips: string[] | null | undefined) =>
      JSON.stringify([...(ips ?? [])].sort());

    const matchedIds = new Set<string>();

    const claim = (p: (typeof existing)[0] | undefined) => {
      if (!p || matchedIds.has(p.id)) return undefined;
      matchedIds.add(p.id);
      return p;
    };

    for (const phys of physicalPorts) {
      const defKey = phys.defaultName?.toLowerCase();
      const macKey = phys.macAddress?.toLowerCase();
      const nameKey = phys.name.toLowerCase();

      // Prefer stable identity (default-name / MAC) over display name
      const found =
        claim(defKey ? byDefaultName.get(defKey) : undefined) ??
        // Legacy rows: name was still the factory name before we stored defaultName
        claim(defKey ? byName.get(defKey) : undefined) ??
        claim(macKey ? byMac.get(macKey) : undefined) ??
        claim(byName.get(nameKey));

      const nextVlans = phys.vlans ?? [];
      const nextIps = phys.ipAddresses ?? [];
      const nextPrimary = phys.ipAddress ?? nextIps[0]?.split('/')[0] ?? null;
      const nextDefault = phys.defaultName?.trim() || null;
      const nextMac = phys.macAddress?.trim() || null;
      const nextComment = phys.comment?.trim() || '';

      if (found) {
        let dirty = false;
        if (found.name !== phys.name) {
          found.name = phys.name;
          dirty = true;
        }
        if (found.defaultName !== nextDefault) {
          found.defaultName = nextDefault;
          dirty = true;
        }
        if (found.macAddress !== nextMac) {
          found.macAddress = nextMac;
          dirty = true;
        }
        if ((found.comment ?? '') !== nextComment) {
          found.comment = nextComment;
          dirty = true;
        }
        if (found.ipAddress !== nextPrimary) {
          found.ipAddress = nextPrimary;
          dirty = true;
        }
        if (ipsKey(found.ipAddresses) !== ipsKey(nextIps)) {
          found.ipAddresses = nextIps;
          dirty = true;
        }
        if (found.linkStatus !== phys.linkStatus) {
          found.linkStatus = phys.linkStatus;
          dirty = true;
        }
        if (vlansKey(found.vlans) !== vlansKey(nextVlans)) {
          found.vlans = nextVlans;
          dirty = true;
        }
        if (!found.isSynced) {
          found.isSynced = true;
          dirty = true;
        }
        if (dirty) await ports.save(found);

        // Keep lookup maps coherent for later iterations
        byName.set(phys.name.toLowerCase(), found);
        if (nextDefault) byDefaultName.set(nextDefault.toLowerCase(), found);
        if (nextMac) byMac.set(nextMac.toLowerCase(), found);
        continue;
      }

      const created = await ports.save(
        ports.create({
          deviceId,
          name: phys.name,
          defaultName: nextDefault,
          macAddress: nextMac,
          comment: nextComment,
          ipAddress: nextPrimary,
          ipAddresses: nextIps,
          sortOrder: nextOrder++,
          linkStatus: phys.linkStatus,
          isSynced: true,
          vlans: nextVlans,
        }),
      );
      matchedIds.add(created.id);
      byName.set(phys.name.toLowerCase(), created);
      if (nextDefault) byDefaultName.set(nextDefault.toLowerCase(), created);
      if (nextMac) byMac.set(nextMac.toLowerCase(), created);
    }

    // Drop synced ports that are no longer on the MikroTik (topology links cascade)
    for (const orphan of existing) {
      if (!orphan.isSynced || matchedIds.has(orphan.id)) continue;
      await ports.delete({ id: orphan.id });
    }

    // Keep sortOrder aligned with natural name order
    const remaining = await ports.find({ where: { deviceId } });
    remaining.sort((a, b) => this.comparePortNames(a.name, b.name));
    for (let i = 0; i < remaining.length; i++) {
      const order = i + 1;
      if (remaining[i].sortOrder !== order) {
        remaining[i].sortOrder = order;
        await ports.save(remaining[i]);
      }
    }
  }

  async syncPortsFromDevice(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    await this.probeAndPersist(schema, id);
    return this.getDeviceDetail(user, id);
  }

  async createPort(user: AuthUser, dto: CreateNetworkPortDto) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    if (
      (isMikrotikRouterOsDevice(device.type, device.subtype) ||
        isMikrotikSwosDevice(device.type, device.subtype)) &&
      device.mgmtHost
    ) {
      throw new BadRequestException(
        'Los puertos de MikroTik se sincronizan automáticamente desde el equipo (solo lectura)',
      );
    }

    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const maxOrder = await ports
      .createQueryBuilder('p')
      .select('MAX(p.sortOrder)', 'max')
      .where('p.deviceId = :deviceId', { deviceId: dto.deviceId })
      .getRawOne<{ max: string | null }>();

    const port = await ports.save(
      ports.create({
        deviceId: dto.deviceId,
        name: dto.name.trim(),
        ipAddress: dto.ipAddress?.trim() || null,
        sortOrder:
          dto.sortOrder ??
          (maxOrder?.max != null ? Number(maxOrder.max) + 1 : 1),
        linkStatus: 'unknown',
        isSynced: false,
        vlans: [],
        ipAddresses: [],
      }),
    );
    return port;
  }

  /**
   * List IPs for a physical port or a VLAN interface under that port.
   * Pass `interfaceName` for VLAN L3 iface (e.g. vlan10); omit for the port itself.
   */
  async getPortAddresses(
    user: AuthUser,
    portId: string,
    interfaceName?: string,
  ) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    let port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const toRows = (rawList: unknown[] | null | undefined) => {
      const raw = rawList?.length ? rawList : [];
      return raw
        .map((item) => {
          if (typeof item === 'string') return { address: item };
          if (item && typeof item === 'object' && 'address' in item) {
            const obj = item as { id?: string; address?: string };
            return {
              id: obj.id || undefined,
              address: obj.address || '',
            };
          }
          return { address: String(item) };
        })
        .filter((a) => !!a.address);
    };

    const iface = interfaceName?.trim() || undefined;
    const targetLabel = iface || port.name;

    if (
      isMikrotikRouterOsDevice(device.type, device.subtype) &&
      device.mgmtHost &&
      device.mgmtUsername &&
      device.mgmtPassword
    ) {
      const staleMs = 12_000;
      const isStale =
        !device.lastCheckedAt ||
        Date.now() - device.lastCheckedAt.getTime() > staleMs;

      if (isStale) {
        try {
          await this.probeAndPersist(schema, device.id);
        } catch {
          // keep going with cache
        }
        port = (await ports.findOne({ where: { id: portId } })) ?? port;
      }

      if (iface && iface !== port.name) {
        const vlan = (port.vlans ?? []).find((v) => v.interfaceName === iface);
        return {
          portId: port.id,
          portName: targetLabel,
          interfaceName: iface,
          source: 'device' as const,
          addresses: toRows(
            vlan?.ipAddresses?.length ? vlan.ipAddresses : undefined,
          ),
        };
      }

      return {
        portId: port.id,
        portName: port.name,
        source: 'device' as const,
        addresses: toRows(
          port.ipAddresses?.length
            ? port.ipAddresses
            : port.ipAddress
              ? [port.ipAddress]
              : [],
        ),
      };
    }

    if (iface && iface !== port.name) {
      const vlan = (port.vlans ?? []).find((v) => v.interfaceName === iface);
      return {
        portId: port.id,
        portName: targetLabel,
        interfaceName: iface,
        source: 'local' as const,
        addresses: toRows(vlan?.ipAddresses),
      };
    }

    return {
      portId: port.id,
      portName: port.name,
      source: 'local' as const,
      addresses: toRows(
        port.ipAddresses?.length
          ? port.ipAddresses
          : port.ipAddress
            ? [port.ipAddress]
            : [],
      ),
    };
  }

  async updatePortAddresses(
    user: AuthUser,
    portId: string,
    dto: { addresses: Array<{ id?: string; address: string }> },
    interfaceName?: string,
  ) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const desired = (dto.addresses ?? []).map((a) => ({
      id: a.id,
      address: a.address.trim(),
    }));

    const iface = interfaceName?.trim() || port.name;
    const isVlanIface = iface !== port.name;

    if (
      isMikrotikRouterOsDevice(device.type, device.subtype) &&
      device.mgmtHost &&
      device.mgmtUsername &&
      device.mgmtPassword
    ) {
      const applied = await this.mikrotik.applyInterfaceAddresses({
        host: device.mgmtHost,
        port:
          device.mgmtPort ??
          (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
        username: device.mgmtUsername,
        password: device.mgmtPassword,
        protocol: device.mgmtProtocol ?? 'api_ssl',
        interfaceName: iface,
        desired,
      });
      if (!applied.ok) {
        throw new BadRequestException(
          applied.error ?? 'No se pudieron guardar las IPs en el equipo',
        );
      }

      const cidrs = applied.addresses.map((a) => a.address);

      if (isVlanIface) {
        const vlans = [...(port.vlans ?? [])];
        const idx = vlans.findIndex((v) => v.interfaceName === iface);
        if (idx >= 0) {
          vlans[idx] = { ...vlans[idx], ipAddresses: cidrs };
          port.vlans = vlans;
        }
      } else {
        port.ipAddresses = cidrs;
        port.ipAddress = cidrs[0]?.split('/')[0] ?? null;
      }
      await ports.save(port);

      return {
        portId: port.id,
        portName: iface,
        interfaceName: isVlanIface ? iface : undefined,
        source: 'device' as const,
        addresses: applied.addresses.map((a) => ({
          id: a.id,
          address: a.address,
        })),
      };
    }

    const cidrs = desired.map((d) => d.address).filter(Boolean);
    if (isVlanIface) {
      const vlans = [...(port.vlans ?? [])];
      const idx = vlans.findIndex((v) => v.interfaceName === iface);
      if (idx >= 0) {
        vlans[idx] = { ...vlans[idx], ipAddresses: cidrs };
        port.vlans = vlans;
      }
    } else {
      port.ipAddresses = cidrs;
      port.ipAddress = cidrs[0]?.split('/')[0] ?? null;
    }
    await ports.save(port);

    return {
      portId: port.id,
      portName: iface,
      interfaceName: isVlanIface ? iface : undefined,
      source: 'local' as const,
      addresses: cidrs.map((address) => ({ address })),
    };
  }

  /**
   * Create a VLAN L3 interface on a MikroTik physical port.
   * Interface name is always `vlan_<id>`; only vlanId + comment are required.
   */
  async createPortVlan(
    user: AuthUser,
    portId: string,
    vlanId: number,
    comment?: string,
  ) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    if (
      !isMikrotikRouterOsDevice(device.type, device.subtype) ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(
        'Solo se pueden crear VLANs L3 en equipos MikroTik RouterOS conectados',
      );
    }

    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }

    const ifaceName = `vlan_${vlanId}`;
    const existing = (port.vlans ?? []).find(
      (v) =>
        v.vlanId === vlanId ||
        v.interfaceName?.toLowerCase() === ifaceName.toLowerCase(),
    );
    if (existing) {
      throw new BadRequestException(
        `Ya existe VLAN ${vlanId} en el puerto ${port.name}`,
      );
    }

    const result = await this.mikrotik.createVlanInterface({
      host: device.mgmtHost,
      port:
        device.mgmtPort ?? (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
      parentInterface: port.name,
      vlanId,
      comment,
    });
    if (!result.ok) {
      throw new BadRequestException(
        result.error ?? 'No se pudo crear la VLAN en el equipo',
      );
    }

    await this.probeAndPersist(schema, device.id);
    return this.getDeviceDetail(user, device.id);
  }

  /**
   * Update comment on a physical port or VLAN L3 interface (writes to MikroTik).
   * `interfaceName` overrides the target (VLAN iface); omit for the port itself.
   */
  async updatePortComment(
    user: AuthUser,
    portId: string,
    comment: string,
    interfaceName?: string,
  ) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const next = comment.trim();
    const iface = interfaceName?.trim() || port.name;
    const isVlan =
      !!interfaceName?.trim() && interfaceName.trim() !== port.name;

    if (isVlan) {
      const vlan = (port.vlans ?? []).find((v) => v.interfaceName === iface);
      if (!vlan) {
        throw new BadRequestException(
          `VLAN con interfaz ${iface} no encontrada en este puerto`,
        );
      }
    }

    if (
      isMikrotikRouterOsDevice(device.type, device.subtype) &&
      device.mgmtHost &&
      device.mgmtUsername &&
      device.mgmtPassword
    ) {
      const result = await this.mikrotik.setInterfaceComment({
        host: device.mgmtHost,
        port:
          device.mgmtPort ??
          (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
        username: device.mgmtUsername,
        password: device.mgmtPassword,
        protocol: device.mgmtProtocol ?? 'api_ssl',
        interfaceName: iface,
        comment: next,
      });
      if (!result.ok) {
        throw new BadRequestException(
          result.error ?? 'No se pudo actualizar el comentario en el equipo',
        );
      }
    }

    if (isVlan) {
      const vlans = [...(port.vlans ?? [])];
      const idx = vlans.findIndex((v) => v.interfaceName === iface);
      if (idx >= 0) {
        vlans[idx] = {
          ...vlans[idx],
          comment: next || undefined,
        };
        port.vlans = vlans;
      }
    } else {
      port.comment = next;
    }
    await ports.save(port);

    return this.getDeviceDetail(user, device.id);
  }

  async updatePort(user: AuthUser, id: string, dto: UpdateNetworkPortDto) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found');
    if (port.isSynced) {
      throw new BadRequestException(
        'Puerto sincronizado desde el equipo: solo lectura',
      );
    }

    if (dto.name !== undefined) port.name = dto.name.trim();
    if (dto.ipAddress !== undefined) {
      port.ipAddress = dto.ipAddress?.trim() || null;
    }
    if (dto.sortOrder !== undefined) port.sortOrder = dto.sortOrder;

    return ports.save(port);
  }

  async deletePort(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id } });
    if (!port) throw new NotFoundException('Port not found');
    if (port.isSynced) {
      throw new BadRequestException(
        'No se puede borrar un puerto físico sincronizado',
      );
    }
    await ports.delete({ id });
    return { ok: true };
  }

  async createLink(user: AuthUser, dto: CreateNetworkLinkDto) {
    const schema = this.requireSchema(user);
    if (dto.portAId === dto.portBId) {
      throw new BadRequestException('Cannot link a port to itself');
    }

    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const [portA, portB] = await Promise.all([
      ports.findOne({ where: { id: dto.portAId } }),
      ports.findOne({ where: { id: dto.portBId } }),
    ]);
    if (!portA || !portB) throw new NotFoundException('Port not found');
    if (portA.deviceId === portB.deviceId) {
      throw new BadRequestException('Cannot link two ports on the same device');
    }

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const [devA, devB] = await Promise.all([
      devices.findOne({ where: { id: portA.deviceId } }),
      devices.findOne({ where: { id: portB.deviceId } }),
    ]);
    if (!devA || !devB) throw new NotFoundException('Device not found');

    const internetSide =
      devA.type === INTERNET_DEVICE_TYPE
        ? { internet: devA, other: devB }
        : devB.type === INTERNET_DEVICE_TYPE
          ? { internet: devB, other: devA }
          : null;
    if (
      internetSide &&
      !INTERNET_LINKABLE_TYPES.includes(internetSide.other.type)
    ) {
      throw new BadRequestException(
        'Only routers and switches can connect to Internet',
      );
    }

    const links = await this.tenantConnections.getNetworkLinkRepository(schema);
    const busy = await links.findOne({
      where: [
        { portAId: dto.portAId },
        { portBId: dto.portAId },
        { portAId: dto.portBId },
        { portBId: dto.portBId },
      ],
    });
    if (busy) {
      throw new BadRequestException('One or both ports are already linked');
    }

    // Normalize order for stable uniqueness (lexicographic uuid)
    const [a, b] =
      dto.portAId < dto.portBId
        ? [dto.portAId, dto.portBId]
        : [dto.portBId, dto.portAId];

    return links.save(links.create({ portAId: a, portBId: b }));
  }

  async deleteLink(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const links = await this.tenantConnections.getNetworkLinkRepository(schema);
    const link = await links.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await links.delete({ id });
    return { ok: true };
  }

  async getPortCandidates(user: AuthUser, portId: string) {
    const schema = this.requireSchema(user);
    await this.ensureInternetDevice(schema);

    const ports = await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const sourceDevice = await devices.findOne({
      where: { id: port.deviceId },
    });
    if (!sourceDevice) throw new NotFoundException('Device not found');

    const links = await this.tenantConnections.getNetworkLinkRepository(schema);
    const allLinks = await links.find();
    const usedPortIds = new Set<string>();
    for (const l of allLinks) {
      usedPortIds.add(l.portAId);
      usedPortIds.add(l.portBId);
    }

    let otherDevices = await devices.find({
      where: { id: Not(port.deviceId), isActive: true },
      order: { name: 'ASC' },
    });

    // From Internet: only router/switch. From other: Internet only if router/switch.
    if (sourceDevice.type === INTERNET_DEVICE_TYPE) {
      otherDevices = otherDevices.filter((d) =>
        INTERNET_LINKABLE_TYPES.includes(d.type),
      );
    } else if (!INTERNET_LINKABLE_TYPES.includes(sourceDevice.type)) {
      otherDevices = otherDevices.filter(
        (d) => d.type !== INTERNET_DEVICE_TYPE,
      );
    }

    if (otherDevices.length === 0) {
      return [];
    }

    const otherPorts = await ports.find({
      where: {
        deviceId: In(otherDevices.map((d) => d.id)),
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    const freeByDevice = new Map<string, typeof otherPorts>();
    for (const p of otherPorts) {
      if (usedPortIds.has(p.id)) continue;
      const list = freeByDevice.get(p.deviceId) ?? [];
      list.push(p);
      freeByDevice.set(p.deviceId, list);
    }

    return otherDevices
      .map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        ports: freeByDevice.get(d.id) ?? [],
      }))
      .filter((d) => d.ports.length > 0);
  }

  private requireRouterOsMikrotik(device: NetworkDevice) {
    if (!isMikrotikRouterOsDevice(device.type, device.subtype)) {
      throw new BadRequestException(
        'Solo disponible en equipos MikroTik RouterOS',
      );
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }
    return {
      host: device.mgmtHost,
      port:
        device.mgmtPort ?? (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
    };
  }

  async getDeviceBridgeConfig(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    const conn = this.requireRouterOsMikrotik(device);
    const result = await this.withTimeout(
      this.mikrotik.getBridgeConfig(conn),
      45_000,
      'bridge config',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo leer bridge');
    }
    return result;
  }

  async ensureDeviceBridge(
    user: AuthUser,
    id: string,
    dto: { name?: string },
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    const conn = this.requireRouterOsMikrotik(device);
    const result = await this.withTimeout(
      this.mikrotik.ensureBridge({
        ...conn,
        name: dto.name,
        vlanFiltering: true,
      }),
      30_000,
      'ensure bridge',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo crear bridge');
    }
    await this.probeAndPersist(schema, id).catch(() => undefined);
    return result;
  }

  async setDeviceBridgePort(
    user: AuthUser,
    id: string,
    dto: { interfaceName: string; bridge: string; pvid?: number },
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    const conn = this.requireRouterOsMikrotik(device);
    const result = await this.withTimeout(
      this.mikrotik.setBridgePort({
        ...conn,
        interfaceName: dto.interfaceName.trim(),
        bridge: dto.bridge.trim(),
        pvid: dto.pvid,
      }),
      30_000,
      'set bridge port',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo asignar el puerto al bridge',
      );
    }
    await this.probeAndPersist(schema, id).catch(() => undefined);
    return result;
  }

  async upsertDeviceBridgeVlan(
    user: AuthUser,
    id: string,
    dto: {
      bridge: string;
      vlanId: number;
      tagged: string[];
      untagged: string[];
    },
  ) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    const conn = this.requireRouterOsMikrotik(device);
    if (!Number.isInteger(dto.vlanId) || dto.vlanId < 1 || dto.vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }
    const result = await this.withTimeout(
      this.mikrotik.upsertBridgeVlan({
        ...conn,
        bridge: dto.bridge.trim(),
        vlanId: dto.vlanId,
        tagged: dto.tagged ?? [],
        untagged: dto.untagged ?? [],
      }),
      30_000,
      'upsert bridge vlan',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo guardar la VLAN del bridge',
      );
    }
    await this.probeAndPersist(schema, id).catch(() => undefined);
    return result;
  }
}
