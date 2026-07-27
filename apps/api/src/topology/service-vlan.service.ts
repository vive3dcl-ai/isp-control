import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { isZteOltDevice, DEFAULT_OLT_PORTS } from './olt.constants';
import type { NetworkDevice } from './entities/network-device.entity';
import type { NetworkPort } from './entities/network-port.entity';
import type { ServiceVlan } from './entities/service-vlan.entity';
import { MikrotikClient } from './mikrotik.client';
import { ZteOltClient } from './zte-olt.client';
import {
  CreateServiceVlanDto,
  UpdateServiceVlanDto,
} from './dto/service-vlan.dto';

type DeviceRef = { id: string; name: string };

@Injectable()
export class ServiceVlanService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
    private readonly zteOlt: ZteOltClient,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private mikrotikConn(device: NetworkDevice) {
    if (
      device.subtype !== 'mikrotik' ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      throw new BadRequestException(
        `Router ${device.name} no es MikroTik conectado`,
      );
    }
    return {
      host: device.mgmtHost,
      port:
        device.mgmtPort ??
        (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
    };
  }

  private zteConn(device: NetworkDevice) {
    if (
      !isZteOltDevice(device.type, device.subtype) ||
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

  private serialize(
    row: ServiceVlan,
    opts: {
      olts: DeviceRef[];
      routers: DeviceRef[];
      syncMessages?: string[];
    },
  ) {
    return {
      id: row.id,
      vlanId: row.vlanId,
      description: row.description,
      oltIds: row.oltIds ?? [],
      routerIds: row.routerIds ?? [],
      /** OLT(s) where this VLAN currently exists (blank if none). */
      olt: opts.olts.length
        ? opts.olts.map((d) => d.name).join(', ')
        : null,
      /** Router(s) where this VLAN currently exists (blank if none). */
      router: opts.routers.length
        ? opts.routers.map((d) => d.name).join(', ')
        : null,
      olts: opts.olts,
      routers: opts.routers,
      syncMessages: opts.syncMessages ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Discover VLAN presence from cached MikroTik ports + live/meta OLT data. */
  private async discoverPresence(schema: string): Promise<{
    byVlan: Map<
      number,
      { olts: DeviceRef[]; routers: DeviceRef[]; comments: string[] }
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
      { olts: DeviceRef[]; routers: DeviceRef[]; comments: string[] }
    >();
    const ensure = (vlanId: number) => {
      let row = byVlan.get(vlanId);
      if (!row) {
        row = { olts: [], routers: [], comments: [] };
        byVlan.set(vlanId, row);
      }
      return row;
    };

    const olts = devices.filter((d) => isZteOltDevice(d.type, d.subtype));
    const routers = devices.filter(
      (d) => d.type === 'router' && d.subtype === 'mikrotik',
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

    await Promise.all(
      olts.map(async (olt) => {
        const found = new Set<number>();
        const meta = olt.oltVlanMeta ?? {};
        for (const key of Object.keys(meta)) {
          const id = Number(key);
          if (Number.isInteger(id) && id >= 1 && id <= 4094) found.add(id);
        }
        try {
          if (olt.mgmtHost && olt.mgmtUsername && olt.mgmtPassword) {
            const live = await this.zteOlt.listVlans(this.zteConn(olt));
            if (live.ok) {
              for (const v of live.vlans) {
                if (v.vlanId === 1) continue; // skip system clutter unless catalogued
                found.add(v.vlanId);
                if (v.description?.trim()) {
                  ensure(v.vlanId).comments.push(v.description.trim());
                }
              }
            }
          }
        } catch {
          /* use meta only */
        }
        for (const vlanId of found) {
          if (vlanId === 1) continue;
          ensure(vlanId).olts.push({ id: olt.id, name: olt.name });
        }
      }),
    );

    return { byVlan, devices };
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    const catalog = await repo.find({ order: { vlanId: 'ASC' } });
    const { byVlan } = await this.discoverPresence(schema);

    const catalogByVlan = new Map(catalog.map((c) => [c.vlanId, c]));
    const allIds = new Set<number>([
      ...catalog.map((c) => c.vlanId),
      ...byVlan.keys(),
    ]);

    const rows = [...allIds]
      .sort((a, b) => a - b)
      .map((vlanId) => {
        const cat = catalogByVlan.get(vlanId);
        const live = byVlan.get(vlanId);
        const olts = live?.olts ?? [];
        const routers = live?.routers ?? [];
        const description =
          cat?.description ??
          live?.comments.find((c) => !!c) ??
          null;
        if (cat) {
          return this.serialize(cat, { olts, routers });
        }
        // Discovered only — not yet in catalog
        return {
          id: null as string | null,
          vlanId,
          description,
          oltIds: olts.map((d) => d.id),
          routerIds: routers.map((d) => d.id),
          olt: olts.length ? olts.map((d) => d.name).join(', ') : null,
          router: routers.length
            ? routers.map((d) => d.name).join(', ')
            : null,
          olts,
          routers,
          syncMessages: [] as string[],
          createdAt: null as string | null,
          updatedAt: null as string | null,
          discovered: true,
        };
      });

    return { vlans: rows };
  }

  async create(user: AuthUser, dto: CreateServiceVlanDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    const clash = await repo.findOne({ where: { vlanId: dto.vlanId } });
    if (clash) {
      throw new BadRequestException(`Ya existe VLAN ${dto.vlanId} en el catálogo`);
    }
    const row = await repo.save(
      repo.create({
        vlanId: dto.vlanId,
        description: dto.description?.trim() || null,
        oltIds: [],
        routerIds: [],
      }),
    );
    return this.serialize(row, { olts: [], routers: [] });
  }

  async update(user: AuthUser, id: string, dto: UpdateServiceVlanDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    let row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');

    if (dto.description !== undefined) {
      row.description =
        dto.description === null ? null : dto.description.trim() || null;
    }
    if (dto.oltIds !== undefined) row.oltIds = dto.oltIds;
    if (dto.routerIds !== undefined) row.routerIds = dto.routerIds;
    row = await repo.save(row);

    const { byVlan } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    return this.serialize(row, {
      olts: live?.olts ?? [],
      routers: live?.routers ?? [],
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
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    let row = await repo.findOne({ where: { vlanId } });
    if (!row) {
      row = await repo.save(
        repo.create({
          vlanId,
          description: dto.description?.trim() || null,
          oltIds: dto.oltIds ?? [],
          routerIds: dto.routerIds ?? [],
        }),
      );
    } else {
      if (dto.description !== undefined) {
        row.description =
          dto.description === null ? null : dto.description.trim() || null;
      }
      if (dto.oltIds !== undefined) row.oltIds = dto.oltIds;
      if (dto.routerIds !== undefined) row.routerIds = dto.routerIds;
      row = await repo.save(row);
    }
    const { byVlan } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    return this.serialize(row, {
      olts: live?.olts ?? [],
      routers: live?.routers ?? [],
    });
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');
    await repo.delete({ id });
    return { ok: true, message: `VLAN ${row.vlanId} eliminada del catálogo` };
  }

  /** Ensure VLAN on one OLT or MikroTik (idempotent). */
  async syncDevice(
    user: AuthUser,
    id: string,
    dto: { deviceId: string; kind: 'olt' | 'router'; parentPortId?: string },
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
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
        device,
        row.vlanId,
        row.description,
      );
      return { ok: true, deviceId: device.id, deviceName: device.name, message };
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

  /** Remove VLAN from one OLT or MikroTik and unassign it. */
  async removeFromDevice(
    user: AuthUser,
    id: string,
    dto: { deviceId: string; kind: 'olt' | 'router' },
  ) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
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
      const result = await this.zteOlt.deleteVlan({ ...conn, vlanId: row.vlanId });
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'No se pudo eliminar la VLAN de la OLT',
        );
      }
      const meta = { ...((device.oltVlanMeta ?? {}) as Record<string, unknown>) };
      delete meta[String(row.vlanId)];
      device.oltVlanMeta = meta as typeof device.oltVlanMeta;
      await deviceRepo.save(device);
      row.oltIds = (row.oltIds ?? []).filter((x) => x !== device.id);
      message = result.message ?? 'eliminada de la OLT';
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
            v.vlanId !== row.vlanId &&
            v.interfaceName?.toLowerCase() !== iface,
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
    const repo =
      await this.tenantConnections.getServiceVlanRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('VLAN not found');

    const { byVlan } = await this.discoverPresence(schema);
    const live = byVlan.get(row.vlanId);
    const oltPresent = new Set((live?.olts ?? []).map((d) => d.id));
    const routerPresent = new Set((live?.routers ?? []).map((d) => d.id));

    const checks: Array<{
      deviceId: string;
      kind: 'olt' | 'router';
      ok: boolean;
      detail: string;
    }> = [];

    for (const oltId of row.oltIds ?? []) {
      const ok = oltPresent.has(oltId);
      checks.push({
        deviceId: oltId,
        kind: 'olt',
        ok,
        detail: ok ? 'presente en OLT' : 'no encontrada en la OLT',
      });
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

    const ok = checks.every((c) => c.ok);
    return {
      ok,
      vlanId: row.vlanId,
      message: ok
        ? `VLAN ${row.vlanId} verificada en todos los equipos asignados`
        : `VLAN ${row.vlanId}: faltan equipos`,
      checks,
      olt: live?.olts?.length
        ? live.olts.map((d) => d.name).join(', ')
        : null,
      router: live?.routers?.length
        ? live.routers.map((d) => d.name).join(', ')
        : null,
    };
  }

  private async ensureOnOlt(
    olt: NetworkDevice,
    vlanId: number,
    description: string | null,
  ): Promise<string> {
    const conn = this.zteConn(olt);
    const live = await this.zteOlt.listVlans(conn);
    if (live.ok && live.vlans.some((v) => v.vlanId === vlanId)) {
      return 'ya existía en la OLT';
    }
    const result = await this.zteOlt.upsertVlan({
      ...conn,
      vlanId,
      description: description ?? undefined,
      isolated: true,
    });
    if (!result.ok) {
      throw new BadRequestException(result.error || 'No se pudo crear en OLT');
    }
    return result.message ?? 'creada en la OLT';
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
}
