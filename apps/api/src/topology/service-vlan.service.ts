import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  isHuaweiOltDevice,
  isManagedOltDevice,
  DEFAULT_OLT_PORTS,
} from './olt.constants';
import { isMikrotikRouterOsDevice } from './switch.constants';
import { portMoveError, resolveSwitchBridge } from './switch-bridge.util';
import { withVlanInCache } from './olt-vlan-cache.util';
import {
  planUplinkVlanChanges,
  uplinksCarryingVlan,
  withUplinkVlansInCache,
  type UplinkVlanPlan,
} from './olt-uplink-vlan.util';
import { saveDeviceIfPresent } from './device-persist.util';
import type { NetworkDevice } from './entities/network-device.entity';
import type { NetworkPort } from './entities/network-port.entity';
import type { ServiceVlan } from './entities/service-vlan.entity';
import { MikrotikClient } from './mikrotik.client';
import { ZteOltClient } from './zte-olt.client';
import { HuaweiOltClient } from './huawei-olt.client';
import {
  CreateServiceVlanDto,
  SERVICE_VLAN_PURPOSES,
  SyncServiceVlanDeviceDto,
  UpdateServiceVlanDto,
  type ServiceVlanPurpose,
} from './dto/service-vlan.dto';

type DeviceRef = { id: string; name: string };

function normalizePurpose(
  value: string | null | undefined,
): ServiceVlanPurpose {
  if (
    value &&
    (SERVICE_VLAN_PURPOSES as readonly string[]).includes(value)
  ) {
    return value as ServiceVlanPurpose;
  }
  return 'internet';
}

@Injectable()
export class ServiceVlanService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly zteOlt: ZteOltClient,
    private readonly huaweiOlt: HuaweiOltClient,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private mikrotikConn(device: NetworkDevice) {
    if (
      !isMikrotikRouterOsDevice(device.type, device.subtype) ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(
        `${device.name} no es MikroTik RouterOS conectado`,
      );
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

  private zteConn(device: NetworkDevice) {
    if (
      !isManagedOltDevice(device.type, device.subtype) ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(`OLT ${device.name} no está conectada`);
    }
    const protocol: 'telnet' | 'ssh' =
      device.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    return {
      host: device.mgmtHost,
      port:
        device.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet),
      protocol,
      username: device.mgmtUsername,
      password: device.mgmtPassword,
    };
  }

  private oltCli(device: NetworkDevice): ZteOltClient {
    return (isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiOlt
      : this.zteOlt) as unknown as ZteOltClient;
  }

  /**
   * `discoverPresence` lee la presencia en OLT desde `oltVlanMeta`, así que
   * todo camino que confirme la VLAN en el equipo tiene que dejarla anotada.
   */
  private async rememberOltVlan(
    schema: string,
    device: NetworkDevice,
    vlanId: number,
    isolated?: boolean,
    description?: string | null,
    appliedUplinks?: { tagged: string[]; untagged: string[] },
  ): Promise<void> {
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const meta = {
      ...((device.oltVlanMeta ?? {}) as Record<string, { isolated?: boolean }>),
    };
    const prev = meta[String(vlanId)];
    const metaChanged =
      !prev || (isolated !== undefined && prev.isolated !== isolated);
    if (metaChanged) {
      meta[String(vlanId)] = {
        ...(prev ?? {}),
        ...(isolated === undefined ? {} : { isolated }),
      };
      device.oltVlanMeta = meta;
    }

    // Counterpart of forgetOltVlan: VLAN pickers (IP pools) are built from the
    // inventory cache, and it only refreshes every OLT_INVENTORY_CONFIG_TTL_MS
    // in the background. Without this the VLAN exists on the OLT but stays
    // invisible in those pickers for up to half an hour.
    const nextCache = withVlanInCache(device.oltInventoryCache, vlanId, {
      isolated,
      description,
    });
    if (nextCache) device.oltInventoryCache = nextCache;

    // Same reasoning for the uplink selector: it reads taggedVlans from this
    // cache, so without seeding it the VLAN we just tagged looks unassigned.
    const nextUplinks = appliedUplinks
      ? withUplinkVlansInCache(device.oltInventoryCache, vlanId, appliedUplinks)
      : null;
    if (nextUplinks) device.oltInventoryCache = nextUplinks;

    if (!metaChanged && !nextCache && !nextUplinks) return;
    await saveDeviceIfPresent(deviceRepo, device);
  }

  /** Contraparte de `rememberOltVlan`: borra meta y caché para que deje de listarse. */
  private async forgetOltVlan(
    schema: string,
    device: NetworkDevice,
    vlanId: number,
  ): Promise<void> {
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const meta = {
      ...((device.oltVlanMeta ?? {}) as Record<string, { isolated?: boolean }>),
    };
    delete meta[String(vlanId)];
    device.oltVlanMeta = meta;
    const cache = device.oltInventoryCache;
    if (cache?.vlans?.length) {
      device.oltInventoryCache = {
        ...cache,
        vlans: cache.vlans.filter((v) => v.vlanId !== vlanId),
      };
    }
    const withoutUplinkVlan = withUplinkVlansInCache(
      device.oltInventoryCache,
      vlanId,
      { untagged: uplinksCarryingVlan(cache?.uplinks ?? [], vlanId) },
    );
    if (withoutUplinkVlan) device.oltInventoryCache = withoutUplinkVlan;
    await saveDeviceIfPresent(deviceRepo, device);
  }

  private serialize(
    row: ServiceVlan,
    opts: {
      olts: DeviceRef[];
      routers: DeviceRef[];
      switches: DeviceRef[];
      syncMessages?: string[];
    },
  ) {
    return {
      id: row.id,
      vlanId: row.vlanId,
      description: row.description,
      purpose: normalizePurpose(row.purpose),
      oltIds: row.oltIds ?? [],
      routerIds: row.routerIds ?? [],
      switchIds: row.switchIds ?? [],
      /** OLT(s) where this VLAN currently exists (blank if none). */
      olt: opts.olts.length ? opts.olts.map((d) => d.name).join(', ') : null,
      /** Router(s) where this VLAN currently exists (blank if none). */
      router: opts.routers.length
        ? opts.routers.map((d) => d.name).join(', ')
        : null,
      /** Switch(es) where this VLAN currently exists (blank if none). */
      switch: opts.switches.length
        ? opts.switches.map((d) => d.name).join(', ')
        : null,
      olts: opts.olts,
      routers: opts.routers,
      switches: opts.switches,
      syncMessages: opts.syncMessages ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Discover VLAN presence from cached MikroTik ports + live/meta OLT data. */
  private async discoverPresence(schema: string): Promise<{
    byVlan: Map<
      number,
      {
        olts: DeviceRef[];
        routers: DeviceRef[];
        switches: DeviceRef[];
        comments: string[];
      }
    >;
    devices: NetworkDevice[];
  }> {
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const devices = await deviceRepo.find({ order: { name: 'ASC' } });
    const ports = await portRepo.find();
    const portsByDevice = new Map<string, NetworkPort[]>();
    for (const p of ports) {
      const list = portsByDevice.get(p.deviceId) ?? [];
      list.push(p);
      portsByDevice.set(p.deviceId, list);
    }

    const byVlan = new Map<
      number,
      {
        olts: DeviceRef[];
        routers: DeviceRef[];
        switches: DeviceRef[];
        comments: string[];
      }
    >();
    const ensure = (vlanId: number) => {
      let row = byVlan.get(vlanId);
      if (!row) {
        row = { olts: [], routers: [], switches: [], comments: [] };
        byVlan.set(vlanId, row);
      }
      return row;
    };

    const olts = devices.filter((d) => isManagedOltDevice(d.type, d.subtype));
    const routers = devices.filter(
      (d) => d.type === 'router' && d.subtype === 'mikrotik',
    );
    const switches = devices.filter(
      (d) => d.type === 'switch' && d.subtype === 'mikrotik_routeros',
    );

    for (const router of routers) {
      const devicePorts = portsByDevice.get(router.id) ?? [];
      const seen = new Set<number>();
      for (const port of devicePorts) {
        for (const v of port.vlans ?? []) {
          if (!v.vlanId || seen.has(v.vlanId)) continue;
          seen.add(v.vlanId);
          const row = ensure(v.vlanId);
          row.routers.push({ id: router.id, name: router.name });
          if (v.comment?.trim()) row.comments.push(v.comment.trim());
        }
      }
    }

    for (const sw of switches) {
      const devicePorts = portsByDevice.get(sw.id) ?? [];
      const seen = new Set<number>();
      for (const port of devicePorts) {
        for (const v of port.vlans ?? []) {
          if (!v.vlanId || seen.has(v.vlanId)) continue;
          seen.add(v.vlanId);
          const row = ensure(v.vlanId);
          row.switches.push({ id: sw.id, name: sw.name });
          if (v.comment?.trim()) row.comments.push(v.comment.trim());
        }
      }
    }

    for (const olt of olts) {
      const found = new Set<number>();
      const meta = olt.oltVlanMeta ?? {};
      for (const key of Object.keys(meta)) {
        const id = Number(key);
        if (Number.isInteger(id) && id >= 1 && id <= 4094) found.add(id);
      }
      // Do NOT open Telnet here — listing settings must stay DB/meta only.
      // Live OLT VLAN scrape stays on explicit sync/verify actions.
      for (const v of olt.oltInventoryCache?.vlans ?? []) {
        if (Number.isInteger(v.vlanId) && v.vlanId >= 1 && v.vlanId <= 4094) {
          found.add(v.vlanId);
          if (v.description?.trim()) {
            ensure(v.vlanId).comments.push(v.description.trim());
          }
        }
      }
      for (const vlanId of found) {
        if (vlanId === 1) continue;
        ensure(vlanId).olts.push({ id: olt.id, name: olt.name });
      }
    }

    return { byVlan, devices };
  }

  async list(user: AuthUser, opts?: { purpose?: ServiceVlanPurpose }) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const catalog = await repo.find({ order: { vlanId: 'ASC' } });
    const { byVlan } = await this.discoverPresence(schema);

    const catalogByVlan = new Map(catalog.map((c) => [c.vlanId, c]));
    const allIds = new Set<number>([
      ...catalog.map((c) => c.vlanId),
      ...(opts?.purpose ? [] : byVlan.keys()),
    ]);

    const rows = [...allIds]
      .sort((a, b) => a - b)
      .map((vlanId) => {
        const cat = catalogByVlan.get(vlanId);
        const live = byVlan.get(vlanId);
        const olts = live?.olts ?? [];
        const routers = live?.routers ?? [];
        const switches = live?.switches ?? [];
        const description =
          cat?.description ?? live?.comments.find((c) => !!c) ?? null;
        if (cat) {
          return this.serialize(cat, { olts, routers, switches });
        }
        // Discovered only — not yet in catalog
        return {
          id: null as string | null,
          vlanId,
          description,
          purpose: 'internet' as ServiceVlanPurpose,
          oltIds: olts.map((d) => d.id),
          routerIds: routers.map((d) => d.id),
          switchIds: switches.map((d) => d.id),
          olt: olts.length ? olts.map((d) => d.name).join(', ') : null,
          router: routers.length ? routers.map((d) => d.name).join(', ') : null,
          switch: switches.length
            ? switches.map((d) => d.name).join(', ')
            : null,
          olts,
          routers,
          switches,
          syncMessages: [] as string[],
          createdAt: null as string | null,
          updatedAt: null as string | null,
          discovered: true,
        };
      })
      .filter((row) =>
        opts?.purpose ? row.purpose === opts.purpose : true,
      );

    return { vlans: rows };
  }

  async create(user: AuthUser, dto: CreateServiceVlanDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const clash = await repo.findOne({ where: { vlanId: dto.vlanId } });
    if (clash) {
      throw new BadRequestException(
        `Ya existe VLAN ${dto.vlanId} en el catálogo`,
      );
    }
    const row = await repo.save(
      repo.create({
        vlanId: dto.vlanId,
        description: dto.description?.trim() || null,
        purpose: normalizePurpose(dto.purpose),
        oltIds: [],
        routerIds: [],
        switchIds: [],
      }),
    );
    return this.serialize(row, { olts: [], routers: [], switches: [] });
  }

  async update(user: AuthUser, id: string, dto: UpdateServiceVlanDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    let row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');

    if (dto.description !== undefined) {
      row.description =
        dto.description === null ? null : dto.description.trim() || null;
    }
    if (dto.purpose !== undefined) {
      row.purpose = normalizePurpose(dto.purpose);
    }
    if (dto.oltIds !== undefined) row.oltIds = dto.oltIds;
    if (dto.routerIds !== undefined) row.routerIds = dto.routerIds;
    if (dto.switchIds !== undefined) row.switchIds = dto.switchIds;
    row = await repo.save(row);

    const { byVlan } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    return this.serialize(row, {
      olts: live?.olts ?? [],
      routers: live?.routers ?? [],
      switches: live?.switches ?? [],
    });
  }

  /**
   * Create catalog row from a discovered VLAN (or reuse) and save assignments.
   * Device sync is done via syncDevice (step-by-step from the UI).
   */
  async upsertByVlanId(
    user: AuthUser,
    vlanId: number,
    dto: UpdateServiceVlanDto & { description?: string | null },
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    let row = await repo.findOne({ where: { vlanId } });
    if (!row) {
      row = await repo.save(
        repo.create({
          vlanId,
          description: dto.description?.trim() || null,
          purpose: normalizePurpose(dto.purpose),
          oltIds: dto.oltIds ?? [],
          routerIds: dto.routerIds ?? [],
          switchIds: dto.switchIds ?? [],
        }),
      );
    } else {
      if (dto.description !== undefined) {
        row.description =
          dto.description === null ? null : dto.description.trim() || null;
      }
      if (dto.purpose !== undefined) {
        row.purpose = normalizePurpose(dto.purpose);
      }
      if (dto.oltIds !== undefined) row.oltIds = dto.oltIds;
      if (dto.routerIds !== undefined) row.routerIds = dto.routerIds;
      if (dto.switchIds !== undefined) row.switchIds = dto.switchIds;
      row = await repo.save(row);
    }
    const { byVlan } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    return this.serialize(row, {
      olts: live?.olts ?? [],
      routers: live?.routers ?? [],
      switches: live?.switches ?? [],
    });
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');
    await repo.delete({ id });
    return { ok: true, message: `VLAN ${row.vlanId} eliminada del catálogo` };
  }

  /** Ensure VLAN on one OLT, MikroTik router (L3) or switch (bridge). */
  async syncDevice(user: AuthUser, id: string, dto: SyncServiceVlanDeviceDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await deviceRepo.findOne({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    if (dto.kind === 'olt') {
      if (!(row.oltIds ?? []).includes(device.id)) {
        row.oltIds = [...(row.oltIds ?? []), device.id];
        await repo.save(row);
      }
      const message = await this.ensureOnOlt(
        schema,
        device,
        row.vlanId,
        row.description,
        dto.uplinks,
      );
      return {
        ok: true,
        deviceId: device.id,
        deviceName: device.name,
        message,
      };
    }

    if (dto.kind === 'switch') {
      if (device.type !== 'switch' || device.subtype !== 'mikrotik_routeros') {
        throw new BadRequestException(
          'Solo switches MikroTik RouterOS admiten push de VLAN (bridge)',
        );
      }
      if (!(row.switchIds ?? []).includes(device.id)) {
        row.switchIds = [...(row.switchIds ?? []), device.id];
        await repo.save(row);
      }
      const portRepo =
        await this.tenantConnections.getNetworkPortRepository(schema);
      const ports = await portRepo.find({ where: { deviceId: device.id } });
      const message = await this.ensureOnSwitch(
        schema,
        device,
        ports,
        row.vlanId,
        row.description,
        dto.bridge,
        dto.ports,
        dto.createBridge,
      );
      return {
        ok: true,
        deviceId: device.id,
        deviceName: device.name,
        message,
      };
    }

    if (!(row.routerIds ?? []).includes(device.id)) {
      row.routerIds = [...(row.routerIds ?? []), device.id];
      await repo.save(row);
    }
    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const ports = await portRepo.find({ where: { deviceId: device.id } });
    const message = await this.ensureOnMikrotik(
      schema,
      device,
      ports,
      row.vlanId,
      row.description,
      dto.parentPortId,
    );
    return { ok: true, deviceId: device.id, deviceName: device.name, message };
  }

  /** Remove VLAN from one OLT / MikroTik router / switch and unassign it. */
  async removeFromDevice(
    user: AuthUser,
    id: string,
    dto: SyncServiceVlanDeviceDto,
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');
    if (row.vlanId === 1) {
      throw new BadRequestException('La VLAN 1 es del sistema');
    }

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await deviceRepo.findOne({ where: { id: dto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    let message: string;
    if (dto.kind === 'olt') {
      const conn = this.zteConn(device);
      const result = await this.oltCli(device).deleteVlan({
        ...conn,
        vlanId: row.vlanId,
      });
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudo eliminar la VLAN de la OLT',
        );
      }
      await this.forgetOltVlan(schema, device, row.vlanId);
      row.oltIds = (row.oltIds ?? []).filter((x) => x !== device.id);
      message = result.message ?? 'eliminada de la OLT';
    } else if (dto.kind === 'switch') {
      message = await this.removeFromSwitch(
        schema,
        device,
        row.vlanId,
        dto.bridge,
      );
      row.switchIds = (row.switchIds ?? []).filter((x) => x !== device.id);
    } else {
      const result = await this.mikrotik.deleteVlanInterface({
        ...this.mikrotikConn(device),
        vlanId: row.vlanId,
      });
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudo eliminar la VLAN del MikroTik',
        );
      }
      const portRepo =
        await this.tenantConnections.getNetworkPortRepository(schema);
      const ports = await portRepo.find({ where: { deviceId: device.id } });
      const iface = `vlan_${row.vlanId}`.toLowerCase();
      for (const port of ports) {
        const next = (port.vlans ?? []).filter(
          (v) =>
            v.vlanId !== row.vlanId && v.interfaceName?.toLowerCase() !== iface,
        );
        if (next.length !== (port.vlans ?? []).length) {
          port.vlans = next;
          await portRepo.save(port);
        }
      }
      row.routerIds = (row.routerIds ?? []).filter((x) => x !== device.id);
      message = result.missing
        ? 'no existía en el router'
        : `eliminada (vlan_${row.vlanId})`;
    }

    await repo.save(row);
    return { ok: true, deviceId: device.id, deviceName: device.name, message };
  }

  /** Confirm VLAN is present on all assigned devices. */
  async verify(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');

    const { byVlan, devices } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    const oltPresent = new Set((live?.olts ?? []).map((d) => d.id));
    const routerPresent = new Set((live?.routers ?? []).map((d) => d.id));
    const switchPresent = new Set((live?.switches ?? []).map((d) => d.id));

    const checks: Array<{
      deviceId: string;
      kind: 'olt' | 'router' | 'switch';
      ok: boolean;
      detail: string;
    }> = [];

    // Verificar es una acción explícita: si la caché no la conoce se consulta
    // la OLT por CLI en vez de dar por ausente algo que sí está configurado.
    const byId = new Map(devices.map((d) => [d.id, d]));
    const oltNames: string[] = [];
    for (const oltId of row.oltIds ?? []) {
      const device = byId.get(oltId);
      let ok = oltPresent.has(oltId);
      let detail = ok ? 'presente en OLT' : 'no encontrada en la OLT';
      if (!ok && device) {
        try {
          const scan = await this.oltCli(device).listVlans(
            this.zteConn(device),
          );
          if (scan.ok) {
            ok = scan.vlans.some((v) => v.vlanId === row.vlanId);
            detail = ok ? 'presente en OLT' : 'no encontrada en la OLT';
            if (ok) {
              await this.rememberOltVlan(
                schema,
                device,
                row.vlanId,
                undefined,
                row.description,
              );
            }
          } else {
            detail = scan.error
              ? `no se pudo leer la OLT: ${scan.error}`
              : 'no se pudo leer la OLT';
          }
        } catch (err) {
          detail = `no se pudo leer la OLT: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }
      if (ok) oltNames.push(device?.name ?? oltId);
      checks.push({ deviceId: oltId, kind: 'olt', ok, detail });
    }
    for (const routerId of row.routerIds ?? []) {
      const ok = routerPresent.has(routerId);
      checks.push({
        deviceId: routerId,
        kind: 'router',
        ok,
        detail: ok ? 'presente en router' : 'no encontrada en el router',
      });
    }

    const switchNames: string[] = [];
    for (const switchId of row.switchIds ?? []) {
      const device = byId.get(switchId);
      let ok = switchPresent.has(switchId);
      let detail = ok ? 'presente en switch' : 'no encontrada en el switch';
      if (!ok && device) {
        try {
          const cfg = await this.mikrotik.getBridgeConfig(
            this.mikrotikConn(device),
          );
          if (cfg.ok) {
            ok = (cfg.vlans ?? []).some((v) => v.vlanIds.includes(row.vlanId));
            detail = ok ? 'presente en switch' : 'no encontrada en el switch';
          } else {
            detail = cfg.error
              ? `no se pudo leer el switch: ${cfg.error}`
              : 'no se pudo leer el switch';
          }
        } catch (err) {
          detail = `no se pudo leer el switch: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }
      if (ok) switchNames.push(device?.name ?? switchId);
      checks.push({ deviceId: switchId, kind: 'switch', ok, detail });
    }

    const ok = checks.every((c) => c.ok);
    const missing = checks
      .filter((c) => !c.ok)
      .map((c) => `${byId.get(c.deviceId)?.name ?? c.deviceId} (${c.detail})`);
    return {
      ok,
      vlanId: row.vlanId,
      message: ok
        ? `VLAN ${row.vlanId} verificada en todos los equipos asignados`
        : `VLAN ${row.vlanId}: ${missing.join('; ')}`,
      checks,
      olt: oltNames.length ? oltNames.join(', ') : null,
      router: live?.routers?.length
        ? live.routers.map((d) => d.name).join(', ')
        : null,
      switch: switchNames.length ? switchNames.join(', ') : null,
    };
  }

  private async ensureOnOlt(
    schema: string,
    olt: NetworkDevice,
    vlanId: number,
    description: string | null,
    uplinks?: string[],
  ): Promise<string> {
    const conn = this.zteConn(olt);
    const plan = this.planOltUplinks(olt, vlanId, uplinks);
    const live = await this.oltCli(olt).listVlans(conn);
    const exists = live.ok && live.vlans.some((v) => v.vlanId === vlanId);

    // A VLAN that exists on the OLT but is missing from the uplink trunk never
    // leaves the chassis, so an "already there" VLAN still has to be pushed
    // when the uplink selection changes.
    if (exists && !plan) {
      await this.rememberOltVlan(schema, olt, vlanId, undefined, description);
      return 'ya existía en la OLT';
    }

    const result = await this.oltCli(olt).upsertVlan({
      ...conn,
      vlanId,
      description: description ?? undefined,
      // Isolation is only decided when creating; editing uplinks must not
      // silently flip it on a VLAN already in service.
      ...(exists ? {} : { isolated: true }),
      ...(plan ? { tagUplinks: plan.toTag, untagUplinks: plan.toUntag } : {}),
    });
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo crear en OLT');
    }
    await this.rememberOltVlan(
      schema,
      olt,
      vlanId,
      exists ? undefined : true,
      description,
      plan ? { tagged: plan.toTag, untagged: plan.toUntag } : undefined,
    );
    return (
      result.message ?? (exists ? 'actualizada en la OLT' : 'creada en la OLT')
    );
  }

  /**
   * Resolve the requested uplink selection against the cached inventory.
   * Returns null when there is nothing to change, so callers can keep the
   * cheap "already existed" path.
   */
  private planOltUplinks(
    olt: NetworkDevice,
    vlanId: number,
    uplinks?: string[],
  ): UplinkVlanPlan | null {
    if (!uplinks) return null;
    const plan = planUplinkVlanChanges({
      uplinks: olt.oltInventoryCache?.uplinks ?? [],
      vlanId,
      selected: uplinks,
    });
    if (plan.unknown.length) {
      throw new BadRequestException(
        `Uplink no encontrado en ${olt.name}: ${plan.unknown.join(', ')}`,
      );
    }
    return plan.toTag.length || plan.toUntag.length ? plan : null;
  }

  private async ensureOnMikrotik(
    schema: string,
    router: NetworkDevice,
    ports: NetworkPort[],
    vlanId: number,
    description: string | null,
    parentPortId?: string,
  ): Promise<string> {
    const ifaceName = `vlan_${vlanId}`;
    for (const port of ports) {
      const existing = (port.vlans ?? []).find(
        (v) =>
          v.vlanId === vlanId ||
          v.interfaceName?.toLowerCase() === ifaceName.toLowerCase(),
      );
      if (existing) {
        return 'ya existía en el router';
      }
    }

    if (!parentPortId) {
      throw new BadRequestException(
        'Selecciona el puerto físico / bridge donde crear la VLAN en el MikroTik',
      );
    }
    const parent = ports.find((p) => p.id === parentPortId);
    if (!parent) {
      throw new BadRequestException(
        'Puerto padre no encontrado en este MikroTik',
      );
    }
    if (/^vlan[_-]?/i.test(parent.name)) {
      throw new BadRequestException(
        'El puerto padre debe ser físico o bridge, no otra interfaz VLAN',
      );
    }

    const result = await this.mikrotik.createVlanInterface({
      ...this.mikrotikConn(router),
      parentInterface: parent.name,
      vlanId,
      comment: description ?? undefined,
    });
    if (!result.ok) {
      if (/already|exist|such/i.test(result.error ?? '')) {
        return 'ya existía en el router';
      }
      throw new BadRequestException(
        result.error || 'No se pudo crear la VLAN en MikroTik',
      );
    }

    // Cache so verify sees it without waiting for a full probe.
    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    parent.vlans = [
      ...(parent.vlans ?? []).filter(
        (v) =>
          v.vlanId !== vlanId &&
          v.interfaceName?.toLowerCase() !== ifaceName.toLowerCase(),
      ),
      {
        vlanId,
        mode: 'tagged',
        interfaceName: ifaceName,
        comment: description ?? undefined,
      },
    ];
    await portRepo.save(parent);

    return `creada (${ifaceName} en ${parent.name})`;
  }

  private async ensureOnSwitch(
    schema: string,
    device: NetworkDevice,
    ports: NetworkPort[],
    vlanId: number,
    description: string | null,
    bridgeName?: string,
    membership?: Array<{ portId: string; mode: 'tagged' | 'untagged' }>,
    createBridge?: boolean,
  ): Promise<string> {
    if (!membership?.length) {
      throw new BadRequestException(
        'Selecciona al menos un puerto (tagged o untagged) en el switch',
      );
    }

    const conn = this.mikrotikConn(device);

    const byId = new Map(ports.map((p) => [p.id, p]));
    const tagged: string[] = [];
    const untagged: string[] = [];
    const selected: Array<{
      port: NetworkPort;
      mode: 'tagged' | 'untagged';
    }> = [];

    for (const m of membership) {
      const port = byId.get(m.portId);
      if (!port) {
        throw new BadRequestException(`Puerto ${m.portId} no encontrado`);
      }
      if (/^vlan[_-]?/i.test(port.name) || /^lo$/i.test(port.name)) {
        throw new BadRequestException(
          `«${port.name}» no es un puerto físico válido para bridge VLAN`,
        );
      }
      selected.push({ port, mode: m.mode });
      if (m.mode === 'tagged') tagged.push(port.name);
      else untagged.push(port.name);
    }

    const liveCfg = await this.mikrotik.getBridgeConfig(conn);
    if (!liveCfg.ok) {
      throw new BadRequestException(
        liveCfg.error || 'No se pudo leer la configuración de bridge del switch',
      );
    }
    const livePorts = liveCfg.ports ?? [];
    const liveBridges = liveCfg.bridges ?? [];

    const resolved = resolveSwitchBridge({
      requested: bridgeName,
      createBridge,
      selectedPortNames: selected.map((s) => s.port.name),
      livePorts,
      liveBridgeNames: liveBridges.map((b) => b.name),
    });
    if (!resolved.ok) throw new BadRequestException(resolved.error);
    const bridge = resolved.bridge;

    // MikroTik expects the bridge itself in the tagged list when using
    // vlan-filtering with CPU/management access to the VLAN.
    if (!tagged.map((n) => n.toLowerCase()).includes(bridge.toLowerCase())) {
      tagged.push(bridge);
    }

    if (resolved.create) {
      const ensured = await this.mikrotik.ensureBridge({
        ...conn,
        name: bridge,
        vlanFiltering: true,
      });
      if (!ensured.ok) {
        throw new BadRequestException(
          ensured.error || 'No se pudo asegurar el bridge',
        );
      }
    }

    for (const { port, mode } of selected) {
      const existing = livePorts.find(
        (bp) => bp.interface.toLowerCase() === port.name.toLowerCase(),
      );
      const moveError = portMoveError({
        portName: port.name,
        currentBridge: existing?.bridge,
        targetBridge: bridge,
      });
      if (moveError) throw new BadRequestException(moveError);
      // Untagged → this VLAN is PVID. Tagged → keep existing PVID if already
      // on the bridge (don't clobber another access VLAN).
      const pvid =
        mode === 'untagged' ? vlanId : existing ? existing.pvid || 1 : 1;

      // A tagged port already on the bridge needs no port-level change: it only
      // has to appear in the VLAN's tagged list, handled by upsertBridgeVlan.
      if (existing && existing.pvid === pvid) continue;

      const set = await this.mikrotik.setBridgePort({
        ...conn,
        interfaceName: port.name,
        bridge,
        pvid,
      });
      if (!set.ok) {
        throw new BadRequestException(
          set.error || `No se pudo asignar ${port.name} al bridge`,
        );
      }
    }

    const vlanResult = await this.mikrotik.upsertBridgeVlan({
      ...conn,
      bridge,
      vlanId,
      tagged,
      untagged,
    });
    if (!vlanResult.ok) {
      throw new BadRequestException(
        vlanResult.error || 'No se pudo configurar bridge VLAN',
      );
    }

    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const selectedIds = new Set(selected.map((s) => s.port.id));
    for (const port of ports) {
      if (selectedIds.has(port.id)) {
        const mode = selected.find((s) => s.port.id === port.id)!.mode;
        port.vlans = [
          ...(port.vlans ?? []).filter((v) => v.vlanId !== vlanId),
          {
            vlanId,
            mode,
            comment: description ?? undefined,
          },
        ];
      } else {
        const next = (port.vlans ?? []).filter((v) => v.vlanId !== vlanId);
        if (next.length === (port.vlans ?? []).length) continue;
        port.vlans = next;
      }
      await portRepo.save(port);
    }

    const taggedLabel = tagged.filter((n) => n !== bridge).join(',') || '—';
    const untaggedLabel = untagged.join(',') || '—';
    return `bridge ${bridge}: tagged=[${taggedLabel}] untagged=[${untaggedLabel}]`;
  }

  private async removeFromSwitch(
    schema: string,
    device: NetworkDevice,
    vlanId: number,
    bridgeName?: string,
  ): Promise<string> {
    if (device.type !== 'switch' || device.subtype !== 'mikrotik_routeros') {
      throw new BadRequestException(
        'Solo switches MikroTik RouterOS admiten eliminar VLAN de bridge',
      );
    }
    const conn = this.mikrotikConn(device);

    const cfg = await this.mikrotik.getBridgeConfig(conn);
    const requested = bridgeName?.trim();
    const bridge =
      (cfg.ok
        ? (cfg.vlans ?? []).find(
            (v) =>
              v.vlanIds.includes(vlanId) &&
              (!requested ||
                v.bridge.toLowerCase() === requested.toLowerCase()),
          )?.bridge
        : undefined) ||
      requested ||
      'bridge';

    if (cfg.ok) {
      for (const bp of cfg.ports ?? []) {
        if (bp.pvid === vlanId && bp.interface) {
          await this.mikrotik.setBridgePort({
            ...conn,
            interfaceName: bp.interface,
            bridge: bp.bridge || bridge,
            pvid: 1,
          });
        }
      }
    }

    const result = await this.mikrotik.removeBridgeVlan({
      ...conn,
      bridge,
      vlanId,
    });
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo eliminar la VLAN del switch',
      );
    }

    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const ports = await portRepo.find({ where: { deviceId: device.id } });
    for (const port of ports) {
      const next = (port.vlans ?? []).filter((v) => v.vlanId !== vlanId);
      if (next.length !== (port.vlans ?? []).length) {
        port.vlans = next;
        await portRepo.save(port);
      }
    }

    return result.missing
      ? 'no existía en el switch'
      : `eliminada del bridge ${bridge}`;
  }
}
