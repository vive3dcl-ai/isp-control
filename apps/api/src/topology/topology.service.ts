import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, Not } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type {
  NetworkDeviceType,
} from './entities/network-device.entity';
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
import { MikrotikClient } from './mikrotik.client';
import { ZteOltClient } from './zte-olt.client';
import type { NetworkDevice } from './entities/network-device.entity';
import { DeviceMetricSample } from './entities/device-metric-sample.entity';
import {
  DEFAULT_OLT_PORTS,
  detectFirmwareFamily,
  detectOltSubtypeFromProduct,
  isZteOltDevice,
  OLT_SELECTABLE_SUBTYPES,
  OLT_SUBTYPE_LABELS,
} from './olt.constants';
import { formatVlanList } from './zte-olt-uplink.util';
import { OnuTypeOltSyncService } from './onu-type-olt-sync.service';

function formatUplinkVlans(vlans: number[]): string {
  return formatVlanList(vlans);
}

const INTERNET_PORT_COUNT = 8;

@Injectable()
export class TopologyService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly zteOlt: ZteOltClient,
    private readonly onuTypeSync: OnuTypeOltSyncService,
  ) {}

  /** Consecutive probe failures per device — avoid flapping on blips. */
  private readonly probeFailStreak = new Map<string, number>();
  /** Skip overlapping probes (OLT CLI is slow; concurrent sessions collide). */
  private readonly probeInFlight = new Set<string>();

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  /** Natural order: ether1, ether2, … ether10, sfp1 */
  private comparePortNames(a: string, b: string) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  /** Never expose password; expose hasPassword instead. */
  private sanitizeDevice<T extends NetworkDevice>(device: T) {
    const { mgmtPassword, mgmtEnablePassword: _enable, ...rest } = device;
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

    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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
    if (
      dto.subtype &&
      dto.type !== 'router' &&
      dto.type !== 'olt'
    ) {
      throw new BadRequestException(
        'Subtype is only valid for routers and OLTs',
      );
    }

    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);

    const device = await devices.save(
      devices.create({
        name: dto.name.trim(),
        type: dto.type as NetworkDeviceType,
        subtype:
          dto.type === 'router' || dto.type === 'olt'
            ? (dto.subtype ?? null)
            : null,
        note: dto.note?.trim() ?? '',
        isActive: dto.isActive ?? true,
        connectionStatus: 'unknown',
        mgmtConnectionMode: 'public',
      }),
    );

    const count =
      dto.type === 'router' && dto.subtype === 'mikrotik'
        ? 0
        : dto.type === 'olt'
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
      if (dto.type !== 'router' && dto.type !== 'olt') device.subtype = null;
    }
    if (dto.subtype !== undefined) {
      if (device.type !== 'router' && device.type !== 'olt') {
        throw new BadRequestException(
          'Subtype is only valid for routers and OLTs',
        );
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
    if (
      isZteOltDevice(device.type, device.subtype) &&
      device.connectionStatus === 'connected'
    ) {
      const devices =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const raw = await devices.findOne({ where: { id } });
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onuCount = await onuRepo.count({ where: { oltId: id } });
      suggestOnuImport =
        onuCount === 0 && !raw?.onusImportPromptedAt;
    }

    return {
      ...device,
      suggestOnuImport,
      ports: device.ports.map((p) => {
        const linked = p.linkedPortId
          ? portMap.get(p.linkedPortId)
          : undefined;
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
   * OLTs need a longer window — full CLI probe is slower than MikroTik API.
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
    const probeable =
      device.subtype === 'mikrotik' ||
      isZteOltDevice(device.type, device.subtype);
    if (!probeable) return;
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      return;
    }
    const age =
      maxAgeMs ??
      (isZteOltDevice(device.type, device.subtype) ? 30_000 : 12_000);
    if (
      device.lastCheckedAt &&
      Date.now() - device.lastCheckedAt.getTime() < age
    ) {
      return;
    }
    await this.probeAndPersist(schema, deviceId);
  }

  /** Background poll: MikroTik routers + ZTE OLTs with credentials. */
  async pollMikrotikDevicesInSchema(schema: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const targets = await devices.find({
      where: [
        { type: 'router', subtype: 'mikrotik', isActive: true },
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
        if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
          return;
        }
        try {
          await this.probeAndPersist(schema, device.id);
        } catch {
          // Individual device failures are persisted in probeAndPersist
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
    if (device.type !== 'router' && device.type !== 'olt') {
      throw new BadRequestException(
        'Management connection is only available for routers and OLTs',
      );
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

    // Defaults for MikroTik
    if (device.subtype === 'mikrotik') {
      if (!device.mgmtProtocol) device.mgmtProtocol = 'api_ssl';
      if (!device.mgmtPort) {
        device.mgmtPort =
          device.mgmtProtocol === 'rest_https' ? 443 : 8729;
      }
    }

    // Defaults for ZTE OLT
    if (isZteOltDevice(device.type, device.subtype)) {
      if (!device.mgmtConnectionMode) device.mgmtConnectionMode = 'public';
      if (!device.mgmtProtocol || !['telnet', 'ssh'].includes(device.mgmtProtocol)) {
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
    if (dto.mgmtProtocol === 'telnet' && dto.mgmtPort == null) {
      device.mgmtPort = DEFAULT_OLT_PORTS.telnet;
    }
    if (dto.mgmtProtocol === 'ssh' && dto.mgmtPort == null) {
      device.mgmtPort = DEFAULT_OLT_PORTS.ssh;
    }

    await devices.save(device);

    // Auto-probe after save if credentials present
    if (device.mgmtHost && device.mgmtUsername && device.mgmtPassword) {
      await this.probeAndPersist(schema, device.id);
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
    if (!isZteOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a ZTE OLT');
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
      this.zteOlt.listCards({
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
        softVer: c.softVer
          ? c.softVer.replace(/^V/i, '')
          : null,
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
    if (!isZteOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a ZTE OLT');
    }
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      throw new BadRequestException('Management credentials not configured');
    }

    const protocol =
      device.mgmtProtocol === 'ssh' ? 'ssh' : ('telnet' as const);
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);

    const rack = opts?.rack ?? '1';
    const shelf = opts?.shelf ?? '1';

    const result = await this.withTimeout(
      this.zteOlt.rebootCard({
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

  private async requireZteOlt(schema: string, id: string) {
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (!isZteOltDevice(device.type, device.subtype)) {
      throw new BadRequestException('Device is not a ZTE OLT');
    }
    return device;
  }

  async getDevicePonPorts(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.listPonPorts(this.zteConn(device)),
      180_000,
      'ZTE OLT PON ports',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron leer los puertos PON',
      );
    }
    const probedAt = result.probedAt;
    return {
      deviceId: device.id,
      probedAt,
      summary: result.summary,
      ports: result.ports.map((p) => ({
        ...p,
        adminState: p.adminEnabled ? 'Enabled' : 'Disabled',
        loadPct:
          p.maxOnus > 0
            ? Math.round((p.onuOnline / p.maxOnus) * 1000) / 10
            : 0,
        infoUpdated: probedAt,
      })),
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
    const device = await this.requireZteOlt(schema, id);
    if (!dto.ifName?.trim()) {
      throw new BadRequestException('ifName required');
    }
    const result = await this.withTimeout(
      this.zteOlt.configurePonPort({
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
    return result;
  }

  async enableAllDevicePonPorts(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.enableAllPonPorts(this.zteConn(device)),
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
    const device = await this.requireZteOlt(schema, id);
    const conn = this.zteConn(device);
    if (opts.ifName) {
      const result = await this.withTimeout(
        this.zteOlt.rebootOnusOnIf({ ...conn, ifName: opts.ifName }),
        180_000,
        'ZTE OLT reboot ONUs on port',
      );
      if (!result.ok) {
        throw new BadRequestException(result.error || 'Fallo al reiniciar ONUs');
      }
      return result;
    }
    const result = await this.withTimeout(
      this.zteOlt.rebootAllOnus({ ...conn, slot: opts.slot }),
      300_000,
      'ZTE OLT reboot all ONUs',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'Fallo al reiniciar ONUs');
    }
    return result;
  }

  async getRogueDetect(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.getRogueDetect(this.zteConn(device)),
      90_000,
      'ZTE OLT rogue detect status',
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
    const device = await this.requireZteOlt(schema, id);
    if (!dto.slots?.length) {
      throw new BadRequestException('Selecciona al menos una ranura');
    }
    const result = await this.withTimeout(
      this.zteOlt.setRogueDetect({
        ...this.zteConn(device),
        slots: dto.slots,
        enable: dto.enable,
        locate: dto.locate,
        autoShutdown: dto.autoShutdown,
      }),
      60_000,
      'ZTE OLT set rogue detect',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo aplicar');
    }
    return result;
  }

  async checkRogueOnus(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.checkRogueOnus(this.zteConn(device)),
      45_000,
      'ZTE OLT check rogue',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo consultar');
    }
    return result;
  }

  async getDeviceUplinks(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.listUplinks(this.zteConn(device)),
      120_000,
      'ZTE OLT uplinks',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron leer los uplinks',
      );
    }
    return {
      deviceId: device.id,
      probedAt: result.probedAt,
      summary: result.summary,
      uplinks: result.uplinks.map((u) => ({
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
        infoUpdated: result.probedAt,
      })),
    };
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
    const device = await this.requireZteOlt(schema, id);
    if (!dto.ifName?.trim()) {
      throw new BadRequestException('ifName required');
    }
    const result = await this.withTimeout(
      this.zteOlt.configureUplink({
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
    return result;
  }

  async getDeviceVlans(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.listVlans(this.zteConn(device)),
      120_000,
      'ZTE OLT vlans',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron leer las VLANs',
      );
    }
    const meta = (device.oltVlanMeta ?? {}) as Record<
      string,
      {
        isolated?: boolean;
      }
    >;
    // Tipo = pools (fuente de verdad). IPTV solo informativo desde la OLT.
    const poolRepo =
      await this.tenantConnections.getIpPoolRepository(schema);
    const pools = await poolRepo.find({ where: { oltId: device.id } });
    const mgmtVlans = new Set<number>();
    const internetVlans = new Set<number>();
    for (const p of pools) {
      if (p.purpose === 'management') mgmtVlans.add(p.vlanId);
      if (p.purpose === 'internet') internetVlans.add(p.vlanId);
    }
    return {
      deviceId: device.id,
      probedAt: result.probedAt,
      summary: result.summary,
      vlans: result.vlans.map((v) => {
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
          isolated:
            typeof m.isolated === 'boolean' ? m.isolated : v.isolated,
          onuCount: v.onuCount,
          isSystem: v.isSystem || v.vlanId === 1,
        };
      }),
    };
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
    const device = await this.requireZteOlt(schema, id);
    const vlanId = Number(dto.vlanId);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }

    const live = await this.withTimeout(
      this.zteOlt.listVlans(this.zteConn(device)),
      120_000,
      'ZTE OLT vlans before upsert',
    );
    const existsOnOlt =
      live.ok && live.vlans.some((v) => v.vlanId === vlanId);

    // New VLANs are always isolated; edits may toggle.
    const isolated =
      !existsOnOlt ? true : dto.isolated !== undefined ? !!dto.isolated : true;

    const result = await this.withTimeout(
      this.zteOlt.upsertVlan({
        ...this.zteConn(device),
        vlanId,
        description: dto.description,
        isolated,
      }),
      120_000,
      'ZTE OLT upsert vlan',
    );
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo guardar la VLAN');
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
    await deviceRepo.save(device);

    return result;
  }

  async deleteDeviceVlan(user: AuthUser, id: string, vlanId: number) {
    const schema = this.requireSchema(user);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await this.requireZteOlt(schema, id);
    if (!Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094) {
      throw new BadRequestException('VLAN ID inválido (1–4094)');
    }
    if (vlanId === 1) {
      throw new BadRequestException(
        'La VLAN 1 es del sistema y no se puede eliminar',
      );
    }
    const result = await this.withTimeout(
      this.zteOlt.deleteVlan({
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
    await deviceRepo.save(device);
    return result;
  }

  async getDeviceSpeedProfiles(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.listSpeedProfiles(this.zteConn(device)),
      120_000,
      'ZTE OLT speed profiles',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudieron leer los perfiles de velocidad',
      );
    }
    return {
      deviceId: device.id,
      probedAt: result.probedAt,
      profiles: result.profiles,
    };
  }

  async upsertDeviceSpeedProfile(
    user: AuthUser,
    id: string,
    dto: { name: string; downloadMbps: number; uploadMbps: number },
  ) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    const result = await this.withTimeout(
      this.zteOlt.upsertSpeedProfile({
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
    return result;
  }

  async deleteDeviceSpeedProfile(user: AuthUser, id: string, name: string) {
    const schema = this.requireSchema(user);
    const device = await this.requireZteOlt(schema, id);
    // Resolve exact UP/DOWN names from live list when possible
    const live = await this.withTimeout(
      this.zteOlt.listSpeedProfiles(this.zteConn(device)),
      90_000,
      'ZTE OLT speed profiles before delete',
    );
    const match = live.ok
      ? live.profiles.find(
          (p) => p.name.toLowerCase() === decodeURIComponent(name).toLowerCase(),
        )
      : null;
    const result = await this.withTimeout(
      this.zteOlt.deleteSpeedProfile({
        ...this.zteConn(device),
        name: decodeURIComponent(name),
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
    if (device.subtype !== 'mikrotik') {
      throw new BadRequestException('Device is not a MikroTik router');
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

    const port =
      device.mgmtPort ?? (protocol === 'api_plain' ? 8728 : 8729);
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
    if (this.probeInFlight.has(deviceId)) {
      return;
    }
    this.probeInFlight.add(deviceId);
    try {
      return await this.probeAndPersistUnlocked(schema, deviceId);
    } finally {
      this.probeInFlight.delete(deviceId);
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
      await devices.save(device);
      return device;
    }

    if (isZteOltDevice(device.type, device.subtype)) {
      return this.probeAndPersistZteOlt(schema, device);
    }

    if (device.subtype !== 'mikrotik') {
      device.connectionStatus = 'error';
      device.lastError = `Probe not implemented for subtype ${device.subtype ?? 'unknown'} yet`;
      device.lastCheckedAt = new Date();
      await devices.save(device);
      return device;
    }

    const probeParams = {
      host: device.mgmtHost,
      port:
        device.mgmtPort ??
        (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
    };

    // Retry transient RouterOS API drops (“Connection closed”, timeouts…)
    let result = await this.mikrotik.probe(probeParams);
    if (!result.ok) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        result = await this.mikrotik.probe(probeParams);
        if (result.ok) break;
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
      await devices.save(device);

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
      if (
        device.connectionStatus === 'connected' &&
        streak < failThreshold
      ) {
        device.lastError = `Inestable (${streak}/${failThreshold}): ${errMsg}`;
        // Keep connected + last metrics so the dashboard doesn't flap
      } else {
        device.connectionStatus = 'disconnected';
        device.lastError = errMsg;
      }
      await devices.save(device);
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
      const family = detectFirmwareFamily(softVer);
      const detectedPon = result.ponType;
      if (detectedPon) {
        device.ponType = detectedPon;
      }
      device.metricCpuLoad =
        result.cpuLoad != null && Number.isFinite(result.cpuLoad)
          ? Math.round(result.cpuLoad)
          : device.metricCpuLoad;
      device.metricFreeMemory =
        result.freeMemory != null ? String(result.freeMemory) : device.metricFreeMemory;
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
        family ? `FW ${family}.x` : softVer,
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
      device.metricSummary = parts.length ? parts.join(' · ') : null;
      // Migrate legacy bucket only when product is clear
      if (device.subtype === 'zte_c3xx' && detectedSubtype) {
        device.subtype = detectedSubtype;
      }
      await devices.save(device);

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
    } else {
      const streak = (this.probeFailStreak.get(device.id) ?? 0) + 1;
      this.probeFailStreak.set(device.id, streak);
      const errMsg = result.error ?? 'Connection failed';
      const failThreshold = 3;
      if (
        device.connectionStatus === 'connected' &&
        streak < failThreshold
      ) {
        device.lastError = `Inestable (${streak}/${failThreshold}): ${errMsg}`;
      } else {
        device.connectionStatus = 'disconnected';
        device.lastError = errMsg;
      }
      await devices.save(device);
    }
    return device;
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
        uptimeSeconds:
          uptimeSeconds != null ? String(uptimeSeconds) : null,
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
        (Number(verbose[1] || 0) * 86400) +
        (Number(verbose[2] || 0) * 3600) +
        (Number(verbose[3] || 0) * 60) +
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

  async getDeviceMetricHistory(
    user: AuthUser,
    deviceId: string,
    hours = 6,
  ) {
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
        uptimeSeconds:
          r.uptimeSeconds != null ? Number(r.uptimeSeconds) : null,
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const existing = await ports.find({
      where: { deviceId },
      order: { sortOrder: 'ASC' },
    });

    const byName = new Map(
      existing.map((p) => [p.name.toLowerCase(), p]),
    );
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
    if (device.subtype === 'mikrotik' && device.mgmtHost) {
      throw new BadRequestException(
        'Los puertos de MikroTik se sincronizan automáticamente desde el equipo (solo lectura)',
      );
    }

    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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
      device.subtype === 'mikrotik' &&
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
        const vlan = (port.vlans ?? []).find(
          (v) => v.interfaceName === iface,
        );
        return {
          portId: port.id,
          portName: targetLabel,
          interfaceName: iface,
          source: 'device' as const,
          addresses: toRows(
            vlan?.ipAddresses?.length
              ? vlan.ipAddresses
              : undefined,
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
    let port = await ports.findOne({ where: { id: portId } });
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
      device.subtype === 'mikrotik' &&
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    if (
      device.subtype !== 'mikrotik' ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(
        'Solo se pueden crear VLANs en equipos MikroTik conectados',
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
        device.mgmtPort ??
        (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: port.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const next = comment.trim();
    const iface = interfaceName?.trim() || port.name;
    const isVlan = !!interfaceName?.trim() && interfaceName.trim() !== port.name;

    if (isVlan) {
      const vlan = (port.vlans ?? []).find((v) => v.interfaceName === iface);
      if (!vlan) {
        throw new BadRequestException(
          `VLAN con interfaz ${iface} no encontrada en este puerto`,
        );
      }
    }

    if (
      device.subtype === 'mikrotik' &&
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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
    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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

    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
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

    const links =
      await this.tenantConnections.getNetworkLinkRepository(schema);
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
    const links =
      await this.tenantConnections.getNetworkLinkRepository(schema);
    const link = await links.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await links.delete({ id });
    return { ok: true };
  }

  async getPortCandidates(user: AuthUser, portId: string) {
    const schema = this.requireSchema(user);
    await this.ensureInternetDevice(schema);

    const ports =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const port = await ports.findOne({ where: { id: portId } });
    if (!port) throw new NotFoundException('Port not found');

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const sourceDevice = await devices.findOne({
      where: { id: port.deviceId },
    });
    if (!sourceDevice) throw new NotFoundException('Device not found');

    const links =
      await this.tenantConnections.getNetworkLinkRepository(schema);
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
}
