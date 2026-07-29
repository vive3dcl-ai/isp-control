import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type { IpPool } from './entities/ip-pool.entity';
import type { NetworkDevice } from './entities/network-device.entity';
import type { Onu } from './entities/onu.entity';
import { CreateIpPoolDto, UpdateIpPoolDto } from './dto/ip-pool.dto';
import { computeIpNetwork, firstFreeIp, isIpInUsable } from './ip-pool.util';
import { MikrotikClient } from './mikrotik.client';

@Injectable()
export class IpPoolService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly mikrotik: MikrotikClient,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private serialize(
    p: IpPool,
    opts: {
      oltName: string | null;
      routerName?: string | null;
      assigned: number;
      total: number;
      mikrotikMessage?: string | null;
    },
  ) {
    return {
      id: p.id,
      oltId: p.oltId,
      oltName: opts.oltName,
      routerId: p.routerId,
      routerName: opts.routerName ?? null,
      vlanId: p.vlanId,
      purpose: p.purpose,
      name: p.name,
      gateway: p.gateway,
      prefix: p.prefix,
      network: p.network,
      dns1: p.dns1,
      dns2: p.dns2,
      total: opts.total,
      assigned: opts.assigned,
      available: Math.max(0, opts.total - opts.assigned),
      mikrotikMessage: opts.mikrotikMessage ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
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
        device.mgmtPort ?? (device.mgmtProtocol === 'rest_https' ? 443 : 8729),
      username: device.mgmtUsername,
      password: device.mgmtPassword,
      protocol: device.mgmtProtocol ?? 'api_ssl',
    };
  }

  private vlanIface(vlanId: number) {
    return `vlan_${vlanId}`;
  }

  private gatewayCidr(gateway: string, prefix: number) {
    return `${gateway}/${prefix}`;
  }

  /** Ensure VLAN interface exists in topology cache for the router. */
  private async assertVlanOnRouter(
    schema: string,
    router: NetworkDevice,
    vlanId: number,
  ) {
    const portRepo =
      await this.tenantConnections.getNetworkPortRepository(schema);
    const ports = await portRepo.find({ where: { deviceId: router.id } });
    const iface = this.vlanIface(vlanId).toLowerCase();
    const found = ports.some((p) =>
      (p.vlans ?? []).some(
        (v) => v.vlanId === vlanId || v.interfaceName?.toLowerCase() === iface,
      ),
    );
    if (!found) {
      throw new BadRequestException(
        `La VLAN ${vlanId} no existe en ${router.name}. Créala primero en Ajustes → VLANs.`,
      );
    }
  }

  private async syncGatewayToMikrotik(params: {
    schema: string;
    router: NetworkDevice;
    vlanId: number;
    gateway: string;
    prefix: number;
    previous?: {
      router: NetworkDevice;
      vlanId: number;
      gateway: string;
      prefix: number;
    };
  }): Promise<string> {
    await this.assertVlanOnRouter(params.schema, params.router, params.vlanId);

    const address = this.gatewayCidr(params.gateway, params.prefix);
    const iface = this.vlanIface(params.vlanId);
    const prev = params.previous;

    // Same router + VLAN + gateway: only ensure address exists (idempotent).
    const unchanged =
      !!prev &&
      prev.router.id === params.router.id &&
      prev.vlanId === params.vlanId &&
      prev.gateway === params.gateway &&
      prev.prefix === params.prefix;

    // Moved to another router or VLAN: remove old gateway first.
    if (
      prev &&
      (prev.router.id !== params.router.id || prev.vlanId !== params.vlanId)
    ) {
      const oldAddr = this.gatewayCidr(prev.gateway, prev.prefix);
      const oldIface = this.vlanIface(prev.vlanId);
      await this.mikrotik.removeGatewayAddress({
        ...this.mikrotikConn(prev.router),
        interfaceName: oldIface,
        address: oldAddr,
      });
      const added = await this.mikrotik.upsertGatewayAddress({
        ...this.mikrotikConn(params.router),
        interfaceName: iface,
        address,
      });
      if (!added.ok) {
        throw new BadRequestException(
          added.error || 'No se pudo publicar el gateway en el Router',
        );
      }
      return added.message ?? `gateway ${address} en ${iface}`;
    }

    const result = await this.mikrotik.upsertGatewayAddress({
      ...this.mikrotikConn(params.router),
      interfaceName: iface,
      address,
      previousAddress:
        prev && !unchanged
          ? this.gatewayCidr(prev.gateway, prev.prefix)
          : undefined,
    });
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo publicar el gateway en el Router',
      );
    }
    return result.message ?? `gateway ${address} en ${iface}`;
  }

  private poolStats(gateway: string, prefix: number) {
    try {
      return computeIpNetwork(gateway, prefix);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid network',
      );
    }
  }

  /** Same as poolStats but never throws (for list rendering). */
  private poolStatsSafe(
    gateway: string,
    prefix: number,
  ): { totalUsable: number; network: string; gateway: string; prefix: number } {
    try {
      return computeIpNetwork(gateway, prefix);
    } catch {
      return {
        totalUsable: 0,
        network: gateway || '',
        gateway: gateway || '',
        prefix: prefix || 0,
      };
    }
  }

  private async deviceNames(
    schema: string,
    oltId: string,
    routerId: string | null,
  ) {
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const ids = [oltId, ...(routerId ? [routerId] : [])];
    const devices = await deviceRepo.find({ where: { id: In(ids) } });
    const byId = new Map(devices.map((d) => [d.id, d.name]));
    return {
      oltName: byId.get(oltId) ?? null,
      routerName: routerId ? (byId.get(routerId) ?? null) : null,
    };
  }

  async list(user: AuthUser, filters?: { purpose?: string; oltId?: string }) {
    const schema = this.requireSchema(user);
    try {
      await this.reclaimOrphanAllocations(schema);
    } catch {
      // Listing must still work if orphan cleanup fails.
    }

    const repo = await this.tenantConnections.getIpPoolRepository(schema);
    const where: {
      purpose?: 'internet' | 'management';
      oltId?: string;
    } = {};
    if (filters?.purpose === 'internet' || filters?.purpose === 'management') {
      where.purpose = filters.purpose;
    }
    if (filters?.oltId) where.oltId = filters.oltId;

    const pools = await repo.find({
      where: Object.keys(where).length ? where : undefined,
      order: { createdAt: 'ASC' },
    });

    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);

    const deviceIds = [
      ...new Set(
        pools.flatMap((p) =>
          [p.oltId, p.routerId].filter((x): x is string => !!x),
        ),
      ),
    ];
    const devices =
      deviceIds.length > 0
        ? await deviceRepo.find({ where: { id: In(deviceIds) } })
        : [];
    const nameById = new Map(devices.map((d) => [d.id, d.name]));

    const counts = new Map<string, number>();
    if (pools.length > 0) {
      const allocs = await allocRepo.find({
        where: { poolId: In(pools.map((p) => p.id)) },
      });
      for (const a of allocs) {
        counts.set(a.poolId, (counts.get(a.poolId) ?? 0) + 1);
      }
    }

    return {
      pools: pools.map((p) => {
        const net = this.poolStatsSafe(p.gateway, p.prefix);
        return this.serialize(p, {
          oltName: nameById.get(p.oltId) ?? null,
          routerName: p.routerId ? (nameById.get(p.routerId) ?? null) : null,
          assigned: counts.get(p.id) ?? 0,
          total: net.totalUsable,
        });
      }),
    };
  }

  async get(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getIpPoolRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('IP pool not found');

    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const assigned = await allocRepo.count({ where: { poolId: id } });
    const net = this.poolStats(p.gateway, p.prefix);
    const names = await this.deviceNames(schema, p.oltId, p.routerId);

    return this.serialize(p, {
      ...names,
      assigned,
      total: net.totalUsable,
    });
  }

  async create(user: AuthUser, dto: CreateIpPoolDto) {
    const schema = this.requireSchema(user);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({
      where: { id: dto.oltId, type: 'olt' },
    });
    if (!olt) throw new BadRequestException('OLT no encontrada');

    const router = await deviceRepo.findOne({
      where: { id: dto.routerId, type: 'router' },
    });
    if (!router || router.subtype !== 'mikrotik') {
      throw new BadRequestException('Selecciona un Router válido');
    }

    const net = this.poolStats(dto.gateway.trim(), dto.prefix);
    const repo = await this.tenantConnections.getIpPoolRepository(schema);

    if (dto.purpose === 'internet') {
      if (!dto.dns1?.trim()) {
        throw new BadRequestException(
          'DNS primario es obligatorio en pools de Internet (WAN)',
        );
      }
    }

    const existing = await repo.findOne({
      where: {
        oltId: dto.oltId,
        vlanId: dto.vlanId,
        purpose: dto.purpose,
      },
    });

    // Upsert: si ya existe el pool OLT+VLAN+purpose, actualizar en lugar de fallar.
    if (existing) {
      const allocRepo =
        await this.tenantConnections.getIpPoolAllocationRepository(schema);
      const allocs = await allocRepo.find({ where: { poolId: existing.id } });
      for (const a of allocs) {
        if (!isIpInUsable(a.ipAddress, net.usableHosts)) {
          throw new BadRequestException(
            `Ya existe el pool ${dto.purpose} VLAN ${dto.vlanId}, pero no se puede actualizar la red: la IP asignada ${a.ipAddress} quedaría fuera de ${net.gateway}/${net.prefix}`,
          );
        }
      }

      const sameGateway = await repo.findOne({
        where: {
          routerId: router.id,
          vlanId: dto.vlanId,
          gateway: net.gateway,
          prefix: net.prefix,
        },
      });
      if (sameGateway && sameGateway.id !== existing.id) {
        throw new BadRequestException(
          `El gateway ${net.gateway}/${net.prefix} ya está en otro pool de VLAN ${dto.vlanId} en este Router`,
        );
      }

      const prevRouter = existing.routerId
        ? await deviceRepo.findOne({ where: { id: existing.routerId } })
        : null;

      const mikrotikMessage = await this.syncGatewayToMikrotik({
        schema,
        router,
        vlanId: dto.vlanId,
        gateway: net.gateway,
        prefix: net.prefix,
        previous:
          prevRouter && existing.routerId
            ? {
                router: prevRouter,
                vlanId: existing.vlanId,
                gateway: existing.gateway,
                prefix: existing.prefix,
              }
            : undefined,
      });

      existing.routerId = router.id;
      existing.name = dto.name?.trim() || existing.name;
      existing.gateway = net.gateway;
      existing.prefix = net.prefix;
      existing.network = net.network;
      if (dto.purpose === 'internet') {
        existing.dns1 = dto.dns1!.trim();
        existing.dns2 = dto.dns2?.trim() || null;
      }
      const saved = await repo.save(existing);
      const assigned = await allocRepo.count({ where: { poolId: saved.id } });
      return this.serialize(saved, {
        oltName: olt.name,
        routerName: router.name,
        assigned,
        total: net.totalUsable,
        mikrotikMessage:
          (mikrotikMessage ? `${mikrotikMessage}. ` : '') +
          `Pool existente actualizado (VLAN ${dto.vlanId} ${dto.purpose}).`,
      });
    }

    const sameGateway = await repo.findOne({
      where: {
        routerId: router.id,
        vlanId: dto.vlanId,
        gateway: net.gateway,
        prefix: net.prefix,
      },
    });
    if (sameGateway) {
      throw new BadRequestException(
        `El gateway ${net.gateway}/${net.prefix} ya está en un pool de VLAN ${dto.vlanId} en este Router`,
      );
    }

    // Publishes gateway on vlan_N if missing; keeps it if already present.
    const mikrotikMessage = await this.syncGatewayToMikrotik({
      schema,
      router,
      vlanId: dto.vlanId,
      gateway: net.gateway,
      prefix: net.prefix,
    });

    const p = repo.create({
      oltId: dto.oltId,
      routerId: router.id,
      vlanId: dto.vlanId,
      purpose: dto.purpose,
      name: dto.name?.trim() || null,
      gateway: net.gateway,
      prefix: net.prefix,
      network: net.network,
      dns1: dto.purpose === 'internet' ? dto.dns1!.trim() : null,
      dns2:
        dto.purpose === 'internet' && dto.dns2?.trim() ? dto.dns2.trim() : null,
    });
    const saved = await repo.save(p);
    return this.serialize(saved, {
      oltName: olt.name,
      routerName: router.name,
      assigned: 0,
      total: net.totalUsable,
      mikrotikMessage,
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateIpPoolDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getIpPoolRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('IP pool not found');

    const gateway = dto.gateway?.trim() ?? p.gateway;
    const prefix = dto.prefix ?? p.prefix;
    const net = this.poolStats(gateway, prefix);

    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const allocs = await allocRepo.find({ where: { poolId: id } });
    for (const a of allocs) {
      if (!isIpInUsable(a.ipAddress, net.usableHosts)) {
        throw new BadRequestException(
          `No se puede cambiar la red: la IP asignada ${a.ipAddress} quedaría fuera del nuevo rango`,
        );
      }
    }

    if (dto.vlanId !== undefined && dto.vlanId !== p.vlanId) {
      const clash = await repo.findOne({
        where: {
          oltId: p.oltId,
          vlanId: dto.vlanId,
          purpose: p.purpose,
        },
      });
      if (clash && clash.id !== id) {
        throw new BadRequestException(
          `Ya existe un pool ${p.purpose} para VLAN ${dto.vlanId}`,
        );
      }
    }

    if (dto.name !== undefined) {
      p.name = dto.name?.trim() || null;
    }
    if (dto.dns1 !== undefined) {
      p.dns1 = dto.dns1?.trim() || null;
    }
    if (dto.dns2 !== undefined) {
      p.dns2 = dto.dns2?.trim() || null;
    }
    if (p.purpose === 'internet' && !p.dns1) {
      throw new BadRequestException(
        'DNS primario es obligatorio en pools de Internet (WAN)',
      );
    }

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const prevRouterId = p.routerId;
    const nextRouterId = dto.routerId ?? p.routerId;
    if (!nextRouterId) {
      throw new BadRequestException('Selecciona un MikroTik');
    }
    const router = await deviceRepo.findOne({
      where: { id: nextRouterId, type: 'router' },
    });
    if (!router || router.subtype !== 'mikrotik') {
      throw new BadRequestException('Selecciona un Router válido');
    }

    let prevRouter: NetworkDevice | null = null;
    if (prevRouterId) {
      prevRouter = await deviceRepo.findOne({
        where: { id: prevRouterId },
      });
    }

    const prevVlanId = p.vlanId;
    const prevGateway = p.gateway;
    const prevPrefix = p.prefix;
    const nextVlanId = dto.vlanId ?? p.vlanId;

    const mikrotikMessage = await this.syncGatewayToMikrotik({
      schema,
      router,
      vlanId: nextVlanId,
      gateway: net.gateway,
      prefix: net.prefix,
      previous:
        prevRouterId && prevRouter
          ? {
              router: prevRouter,
              vlanId: prevVlanId,
              gateway: prevGateway,
              prefix: prevPrefix,
            }
          : undefined,
    });

    p.vlanId = nextVlanId;
    p.routerId = router.id;
    p.gateway = net.gateway;
    p.prefix = net.prefix;
    p.network = net.network;

    const saved = await repo.save(p);
    const olt = await deviceRepo.findOne({ where: { id: p.oltId } });

    return this.serialize(saved, {
      oltName: olt?.name ?? null,
      routerName: router.name,
      assigned: allocs.length,
      total: net.totalUsable,
      mikrotikMessage,
    });
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getIpPoolRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('IP pool not found');

    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const assigned = await allocRepo.count({ where: { poolId: id } });
    if (assigned > 0) {
      throw new BadRequestException(
        `No se puede eliminar: hay ${assigned} IP(s) asignada(s). Libéralas primero.`,
      );
    }

    if (p.routerId) {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const router = await deviceRepo.findOne({
        where: { id: p.routerId },
      });
      if (router?.subtype === 'mikrotik') {
        await this.mikrotik.removeGatewayAddress({
          ...this.mikrotikConn(router),
          interfaceName: this.vlanIface(p.vlanId),
          address: this.gatewayCidr(p.gateway, p.prefix),
        });
      }
    }

    await repo.remove(p);
    return { ok: true };
  }

  async listAddresses(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getIpPoolRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('IP pool not found');

    await this.reclaimOrphanAllocations(schema, id);

    const net = this.poolStats(p.gateway, p.prefix);
    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const allocs = await allocRepo.find({ where: { poolId: id } });
    const byIp = new Map(allocs.map((a) => [a.ipAddress, a]));

    const onuIds = [
      ...new Set(
        allocs.map((a) => a.onuId).filter((x): x is string => Boolean(x)),
      ),
    ];
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onus =
      onuIds.length > 0
        ? await onuRepo.find({ where: { id: In(onuIds) } })
        : [];
    const onuById = new Map(onus.map((o) => [o.id, o]));

    const addresses = net.usableHosts.map((ip) => {
      const a = byIp.get(ip);
      const onu = a?.onuId ? onuById.get(a.onuId) : null;
      return {
        ip,
        status: a ? ('assigned' as const) : ('available' as const),
        onuId: a?.onuId ?? null,
        onuIf: onu?.onuIf ?? null,
        sn: onu?.sn ?? null,
        onuName: onu?.name ?? null,
      };
    });

    return {
      poolId: p.id,
      gateway: p.gateway,
      prefix: p.prefix,
      network: p.network,
      broadcast: net.broadcast,
      total: net.totalUsable,
      assigned: allocs.length,
      available: net.totalUsable - allocs.length,
      addresses,
    };
  }

  /**
   * Enable/disable TR069 on an ONU: bind profile + assign/release management IP.
   */
  async setOnuTr069(
    user: AuthUser,
    onuId: string,
    enabled: boolean,
    profileId?: string,
    vlanId?: number,
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    if (!enabled) {
      await this.releaseMgmtIp(schema, onu);
      onu.tr069ProfileId = null;
      await onuRepo.save(onu);
      return {
        enabled: false,
        tr069ProfileId: null as string | null,
        tr069ProfileName: null as string | null,
        mgmtIp: null as string | null,
      };
    }

    if (!profileId?.trim()) {
      throw new BadRequestException(
        'Selecciona un perfil TR069 para activarlo',
      );
    }

    const profileRepo =
      await this.tenantConnections.getTr069ProfileRepository(schema);
    const profile = await profileRepo.findOne({ where: { id: profileId } });
    if (!profile) throw new BadRequestException('Perfil TR069 no encontrado');

    // Prefer profiles attached to this OLT; still allow any tenant profile.
    const joinRepo =
      await this.tenantConnections.getTr069ProfileOltRepository(schema);
    const attached = await joinRepo.find({ where: { deviceId: onu.oltId } });
    if (
      attached.length > 0 &&
      !attached.some((j) => j.profileId === profileId)
    ) {
      throw new BadRequestException(
        `El perfil "${profile.name}" no está adjunto a esta OLT. Adjúntalo en Ajustes → TR069.`,
      );
    }

    const ipResult = await this.assignMgmtIp(schema, onu, vlanId);
    // reload after assign
    const fresh = await onuRepo.findOne({ where: { id: onuId } });
    if (!fresh) throw new NotFoundException('ONU not found');
    fresh.tr069ProfileId = profile.id;
    await onuRepo.save(fresh);

    return {
      enabled: true,
      tr069ProfileId: profile.id,
      tr069ProfileName: profile.name,
      mgmtIp: ipResult.mgmtIp,
    };
  }

  /**
   * @deprecated Prefer setOnuTr069 — kept for compatibility.
   */
  async setOnuMgmtIp(
    user: AuthUser,
    onuId: string,
    enabled: boolean,
    vlanId?: number,
  ) {
    if (!enabled) {
      const r = await this.setOnuTr069(user, onuId, false);
      return { mgmtIp: r.mgmtIp, enabled: false };
    }
    return this.setOnuTr069(user, onuId, true, undefined, vlanId).then((r) => ({
      mgmtIp: r.mgmtIp,
      enabled: r.enabled,
    }));
  }

  /**
   * Drop allocation rows that no longer belong to a live ONU.
   * Orphans (onu_id NULL / deleted ONU) used to keep .2/.3/.4 "taken".
   */
  private async reclaimOrphanAllocations(schema: string, poolId?: string) {
    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    if (poolId) {
      await allocRepo.delete({ poolId, onuId: IsNull() });
    } else {
      await allocRepo.delete({ onuId: IsNull() });
    }
    // Must use .from(...) — bare createQueryBuilder().delete() throws and
    // used to break GET /ip-pools (UI showed an empty list).
    const qb = allocRepo
      .createQueryBuilder()
      .delete()
      .from(allocRepo.metadata.target)
      .where('onu_id IS NOT NULL')
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM "${schema}"."onus" o WHERE o.id = onu_id)`,
      );
    if (poolId) {
      qb.andWhere('pool_id = :poolId', { poolId });
    }
    await qb.execute();
  }

  /** Pick lowest free IP, reclaiming orphans first; retry on unique conflict. */
  private async allocateLowestFreeIp(
    schema: string,
    poolId: string,
    onuId: string,
    usableHosts: string[],
  ) {
    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    await this.reclaimOrphanAllocations(schema, poolId);

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const allocs = await allocRepo.find({ where: { poolId } });
      const assigned = new Set(
        allocs.filter((a) => a.onuId).map((a) => a.ipAddress),
      );
      const free = firstFreeIp(usableHosts, assigned);
      if (!free) {
        throw new BadRequestException('El pool no tiene IPs libres');
      }
      try {
        return await allocRepo.save(
          allocRepo.create({
            poolId,
            ipAddress: free,
            onuId,
          }),
        );
      } catch (err) {
        lastError = err;
      }
    }
    throw new BadRequestException(
      lastError instanceof Error
        ? `Conflicto al asignar IP; reintenta (${lastError.message})`
        : 'Conflicto al asignar IP; reintenta',
    );
  }

  private async releaseMgmtIp(schema: string, onu: Onu) {
    await this.deleteOnuAllocationsForPurpose(schema, onu.id, 'management');
    onu.mgmtIp = null;
    onu.mgmtPoolId = null;
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    await onuRepo.save(onu);
    return { mgmtIp: null as string | null, enabled: false };
  }

  private async assignMgmtIp(schema: string, onu: Onu, vlanId?: number) {
    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    // NEVER use onu.vlan here — that is typically WAN, not management.
    // Prefer explicit management vlanId, else the OLT's management pool(s).
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    let pool: IpPool | null = null;

    if (vlanId != null) {
      pool = await poolRepo.findOne({
        where: {
          oltId: onu.oltId,
          vlanId,
          purpose: 'management',
        },
      });
      if (!pool) {
        throw new BadRequestException(
          `No hay pool de management en VLAN ${vlanId} para esta OLT`,
        );
      }
    } else {
      const candidates = await poolRepo.find({
        where: { oltId: onu.oltId, purpose: 'management' },
        order: { vlanId: 'ASC' },
      });
      if (candidates.length === 0) {
        throw new BadRequestException(
          'No hay pool de management para esta OLT. Crea uno en Ajustes → IP Pools (VLAN de administración, no la WAN).',
        );
      }
      if (candidates.length > 1) {
        throw new BadRequestException(
          `Hay ${candidates.length} pools de management en esta OLT (VLANs ${candidates.map((c) => c.vlanId).join(', ')}). Indica cuál usar.`,
        );
      }
      pool = candidates[0];
    }

    // Reuse existing allocation for this ONU in this pool (or matching mgmt_ip).
    const existingForOnu = await allocRepo.find({
      where: { onuId: onu.id, poolId: pool.id },
      order: { createdAt: 'DESC' },
    });
    if (existingForOnu.length > 0) {
      const keep =
        existingForOnu.find((a) => a.ipAddress === onu.mgmtIp) ??
        existingForOnu[0];
      for (const extra of existingForOnu) {
        if (extra.id !== keep.id) {
          await allocRepo.delete({ id: extra.id });
        }
      }
      onu.mgmtIp = keep.ipAddress;
      onu.mgmtPoolId = pool.id;
      await onuRepo.save(onu);
      return {
        mgmtIp: keep.ipAddress,
        enabled: true,
        mgmtVlan: pool.vlanId,
        mgmtGateway: pool.gateway,
        mgmtPrefix: pool.prefix,
      };
    }

    // Stale mgmt binding — clear only management-pool allocations for this ONU.
    await this.deleteOnuAllocationsForPurpose(schema, onu.id, 'management');

    const net = this.poolStats(pool.gateway, pool.prefix);
    const row = await this.allocateLowestFreeIp(
      schema,
      pool.id,
      onu.id,
      net.usableHosts,
    );
    const free = row.ipAddress;

    onu.mgmtIp = free;
    onu.mgmtPoolId = pool.id;
    await onuRepo.save(onu);

    return {
      mgmtIp: free,
      enabled: true,
      mgmtVlan: pool.vlanId,
      mgmtGateway: pool.gateway,
      mgmtPrefix: pool.prefix,
    };
  }

  private async deleteOnuAllocationsForPurpose(
    schema: string,
    onuId: string,
    purpose: 'internet' | 'management',
  ) {
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const pools = await poolRepo.find({ where: { purpose } });
    if (pools.length === 0) return;
    const ids = pools.map((p) => p.id);
    const allocs = await allocRepo.find({ where: { onuId } });
    for (const a of allocs) {
      if (ids.includes(a.poolId)) {
        await allocRepo.delete({ id: a.id });
      }
    }
  }

  async releaseWanIp(schema: string, onu: Onu) {
    await this.deleteOnuAllocationsForPurpose(schema, onu.id, 'internet');
    onu.wanIp = null;
    onu.wanPoolId = null;
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    await onuRepo.save(onu);
    return { wanIp: null as string | null };
  }

  /**
   * Assign (or reuse) a WAN/internet IP from the OLT's internet pool for vlanId.
   */
  async assignWanIp(schema: string, onu: Onu, vlanId: number) {
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const pool = await poolRepo.findOne({
      where: {
        oltId: onu.oltId,
        vlanId,
        purpose: 'internet',
      },
    });
    if (!pool) {
      throw new BadRequestException(
        `No hay pool de Internet (WAN) en VLAN ${vlanId} para esta OLT`,
      );
    }
    if (!pool.dns1) {
      throw new BadRequestException(
        `El pool WAN VLAN ${vlanId} no tiene DNS primario configurado`,
      );
    }

    const allocRepo =
      await this.tenantConnections.getIpPoolAllocationRepository(schema);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);

    // Keep existing IP if already in this pool; otherwise free other WAN allocs.
    let keep = (
      await allocRepo.find({
        where: { onuId: onu.id, poolId: pool.id },
        order: { createdAt: 'DESC' },
      })
    )[0];

    const internetPools = await poolRepo.find({
      where: { purpose: 'internet' },
    });
    const internetIds = new Set(internetPools.map((p) => p.id));
    const allOnu = await allocRepo.find({ where: { onuId: onu.id } });
    for (const a of allOnu) {
      if (!internetIds.has(a.poolId)) continue;
      if (keep && a.id === keep.id) continue;
      if (a.poolId === pool.id && keep && a.id !== keep.id) {
        await allocRepo.delete({ id: a.id });
        continue;
      }
      if (a.poolId !== pool.id) {
        await allocRepo.delete({ id: a.id });
      }
    }

    if (!keep) {
      const net = this.poolStats(pool.gateway, pool.prefix);
      keep = await this.allocateLowestFreeIp(
        schema,
        pool.id,
        onu.id,
        net.usableHosts,
      );
    }

    onu.wanIp = keep.ipAddress;
    onu.wanPoolId = pool.id;
    onu.vlan = pool.vlanId;
    // WAN estática gestionada ⇒ la ONU queda en modo router.
    onu.mode = 'router';
    await onuRepo.save(onu);
    return this.wanAssignResult(pool, keep.ipAddress);
  }

  private wanAssignResult(pool: IpPool, wanIp: string) {
    const mask = pool.prefix === 0 ? 0 : (~0 << (32 - pool.prefix)) >>> 0;
    const wanMask = [
      (mask >>> 24) & 255,
      (mask >>> 16) & 255,
      (mask >>> 8) & 255,
      mask & 255,
    ].join('.');
    return {
      wanIp,
      wanVlan: pool.vlanId,
      wanGateway: pool.gateway,
      wanPrefix: pool.prefix,
      wanDns1: pool.dns1!,
      wanDns2: pool.dns2,
      wanMask,
    };
  }

  /** Public: assign mgmt IP for a specific management VLAN (vlan change). */
  async assignMgmtIpForVlan(schema: string, onu: Onu, vlanId: number) {
    await this.deleteOnuAllocationsForPurpose(schema, onu.id, 'management');
    onu.mgmtIp = null;
    onu.mgmtPoolId = null;
    return this.assignMgmtIp(schema, onu, vlanId);
  }
}
