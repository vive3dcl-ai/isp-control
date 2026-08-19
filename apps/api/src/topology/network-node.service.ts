import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  CreateNetworkNodeDto,
  CreateNodeHeaderDto,
  NodeHeaderPortDto,
  UpdateNetworkNodeDto,
  UpdateNodeHeaderDto,
} from './shared/dto/network-node.dto';
import type { NetworkDevice } from './shared/entities/network-device.entity';
import type { NetworkNode } from './shared/entities/network-node.entity';
import type { NodeHeader, NodeHeaderPort } from './shared/entities/node-header.entity';

export type NodeAssetStatus = 'online' | 'offline' | 'unknown';
export type NodeHealth = 'ok' | 'degraded' | 'down' | 'unknown';

@Injectable()
export class NetworkNodeService {
  constructor(private readonly tenantConnections: TenantConnectionService) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private assetStatus(d: NetworkDevice): NodeAssetStatus {
    if (!d.mgmtHost?.trim()) return 'unknown';
    if (d.connectionStatus === 'connected') return 'online';
    if (
      d.connectionStatus === 'disconnected' ||
      d.connectionStatus === 'error'
    ) {
      return 'offline';
    }
    return 'unknown';
  }

  private rollupHealth(statuses: NodeAssetStatus[]): NodeHealth {
    const monitored = statuses.filter((s) => s !== 'unknown');
    if (!monitored.length) return 'unknown';
    const offline = monitored.filter((s) => s === 'offline').length;
    if (offline === 0) return 'ok';
    if (offline === monitored.length) return 'down';
    return 'degraded';
  }

  private serializeDevice(d: NetworkDevice) {
    const status = this.assetStatus(d);
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      subtype: d.subtype,
      mgmtHost: d.mgmtHost,
      connectionStatus: d.connectionStatus,
      lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
      /** Solo online / offline / unknown para UI de nodos. */
      status,
      online: status === 'online',
    };
  }

  private serializeNode(node: NetworkNode, devices: NetworkDevice[]) {
    const assets = devices.map((d) => this.serializeDevice(d));
    const health = this.rollupHealth(assets.map((a) => a.status));
    return {
      id: node.id,
      name: node.name,
      note: node.note,
      isRented: node.isRented,
      contactName: node.contactName,
      contactPhone: node.contactPhone,
      contactEmail: node.contactEmail,
      street: node.street,
      city: node.city,
      zipCode: node.zipCode,
      latitude: node.latitude,
      longitude: node.longitude,
      isActive: node.isActive,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
      health,
      assetCount: assets.length,
      onlineCount: assets.filter((a) => a.status === 'online').length,
      offlineCount: assets.filter((a) => a.status === 'offline').length,
      assets,
    };
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const nodes = await nodeRepo.find({
      order: { name: 'ASC' },
    });
    const devices = await deviceRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    const byNode = new Map<string, NetworkDevice[]>();
    for (const d of devices) {
      if (!d.nodeId) continue;
      const list = byNode.get(d.nodeId) ?? [];
      list.push(d);
      byNode.set(d.nodeId, list);
    }
    return nodes.map((n) => this.serializeNode(n, byNode.get(n.id) ?? []));
  }

  async get(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const node = await nodeRepo.findOne({ where: { id } });
    if (!node) throw new NotFoundException('Nodo no encontrado');
    const devices = await deviceRepo.find({
      where: { nodeId: id, isActive: true },
      order: { name: 'ASC' },
    });
    return this.serializeNode(node, devices);
  }

  async create(user: AuthUser, dto: CreateNetworkNodeDto) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nombre requerido');
    const node = nodeRepo.create({
      name,
      note: dto.note?.trim() ?? '',
      isRented: dto.isRented ?? false,
      contactName: dto.isRented ? (dto.contactName?.trim() ?? '') : '',
      contactPhone: dto.isRented ? (dto.contactPhone?.trim() ?? '') : '',
      contactEmail: dto.isRented
        ? (dto.contactEmail?.toLowerCase().trim() ?? '')
        : '',
      street: dto.street?.trim() ?? '',
      city: dto.city?.trim() ?? '',
      zipCode: dto.zipCode?.trim() ?? '',
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      isActive: dto.isActive ?? true,
    });
    const saved = await nodeRepo.save(node);
    return this.get(user, saved.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateNetworkNodeDto) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const node = await nodeRepo.findOne({ where: { id } });
    if (!node) throw new NotFoundException('Nodo no encontrado');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Nombre requerido');
      node.name = name;
    }
    if (dto.note !== undefined) node.note = dto.note.trim();
    if (dto.isRented !== undefined) node.isRented = dto.isRented;
    if (dto.contactName !== undefined)
      node.contactName = dto.contactName.trim();
    if (dto.contactPhone !== undefined)
      node.contactPhone = dto.contactPhone.trim();
    if (dto.contactEmail !== undefined)
      node.contactEmail = dto.contactEmail.toLowerCase().trim();
    if (dto.street !== undefined) node.street = dto.street.trim();
    if (dto.city !== undefined) node.city = dto.city.trim();
    if (dto.zipCode !== undefined) node.zipCode = dto.zipCode.trim();
    if (dto.latitude !== undefined) node.latitude = dto.latitude;
    if (dto.longitude !== undefined) node.longitude = dto.longitude;
    if (dto.isActive !== undefined) node.isActive = dto.isActive;

    if (!node.isRented) {
      node.contactName = '';
      node.contactPhone = '';
      node.contactEmail = '';
    }

    await nodeRepo.save(node);
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const node = await nodeRepo.findOne({ where: { id } });
    if (!node) throw new NotFoundException('Nodo no encontrado');
    await deviceRepo
      .createQueryBuilder()
      .update()
      .set({ nodeId: null })
      .where('node_id = :id', { id })
      .execute();
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    await headerRepo.delete({ nodeId: id });
    await nodeRepo.delete({ id });
    return { ok: true };
  }

  /** Activos de topología disponibles (sin nodo o ya en este nodo). */
  async listAssignableDevices(user: AuthUser, nodeId: string) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const node = await nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('Nodo no encontrado');

    const devices = await deviceRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    return devices
      .filter((d) => d.type !== 'internet')
      .filter((d) => !d.nodeId || d.nodeId === nodeId)
      .map((d) => ({
        ...this.serializeDevice(d),
        assigned: d.nodeId === nodeId,
        nodeId: d.nodeId,
      }));
  }

  async setDevices(user: AuthUser, nodeId: string, deviceIds: string[]) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const node = await nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('Nodo no encontrado');

    const unique = [...new Set(deviceIds)];
    if (unique.length) {
      const found = await deviceRepo
        .createQueryBuilder('d')
        .where('d.id IN (:...ids)', { ids: unique })
        .getMany();
      if (found.length !== unique.length) {
        throw new BadRequestException('Uno o más activos no existen');
      }
      for (const d of found) {
        if (d.type === 'internet') {
          throw new BadRequestException(
            'El activo Internet no se puede asignar a un nodo',
          );
        }
        if (d.nodeId && d.nodeId !== nodeId) {
          throw new BadRequestException(
            `El activo «${d.name}» ya pertenece a otro nodo`,
          );
        }
      }
    }

    // Desasignar los que salen de este nodo
    await deviceRepo
      .createQueryBuilder()
      .update()
      .set({ nodeId: null })
      .where('node_id = :nodeId', { nodeId })
      .execute();

    if (unique.length) {
      await deviceRepo
        .createQueryBuilder()
        .update()
        .set({ nodeId })
        .where('id IN (:...ids)', { ids: unique })
        .execute();
    }

    return this.get(user, nodeId);
  }

  // —— Cabeceras de fibra (ODF) ——

  private serializeHeader(h: NodeHeader) {
    return {
      id: h.id,
      nodeId: h.nodeId,
      name: h.name,
      description: h.description,
      portCount: h.portCount,
      ports: this.normalizePorts(h.portCount, h.ports),
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  }

  /** Garantiza un puerto por índice 1..portCount con la forma completa. */
  private normalizePorts(
    portCount: number,
    ports: Array<Partial<NodeHeaderPort>> | null | undefined,
  ): NodeHeaderPort[] {
    const byIndex = new Map<number, Partial<NodeHeaderPort>>();
    for (const p of ports ?? []) {
      if (typeof p?.index === 'number') byIndex.set(p.index, p);
    }
    return Array.from({ length: portCount }, (_, i) => {
      const p = byIndex.get(i + 1) ?? {};
      return {
        index: i + 1,
        name: (p.name ?? '').trim(),
        description: (p.description ?? '').trim(),
        deviceId: p.deviceId || null,
        devicePortId: p.devicePortId || null,
        devicePortName: p.devicePortName?.trim() || null,
        cableId: p.cableId || null,
        tubeId: p.tubeId || null,
        fiberId: p.fiberId || null,
      };
    });
  }

  async listHeaders(user: AuthUser, nodeId: string) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    const node = await nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('Nodo no encontrado');
    const headers = await headerRepo.find({
      where: { nodeId },
      order: { createdAt: 'ASC' },
    });
    return headers.map((h) => this.serializeHeader(h));
  }

  async createHeader(user: AuthUser, nodeId: string, dto: CreateNodeHeaderDto) {
    const schema = this.requireSchema(user);
    const nodeRepo =
      await this.tenantConnections.getNetworkNodeRepository(schema);
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    const node = await nodeRepo.findOne({ where: { id: nodeId } });
    if (!node) throw new NotFoundException('Nodo no encontrado');
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nombre requerido');
    const header = headerRepo.create({
      nodeId,
      name,
      description: dto.description?.trim() ?? '',
      portCount: dto.portCount,
      ports: this.normalizePorts(dto.portCount, []),
    });
    const saved = await headerRepo.save(header);
    return this.serializeHeader(saved);
  }

  async updateHeader(
    user: AuthUser,
    nodeId: string,
    headerId: string,
    dto: UpdateNodeHeaderDto,
  ) {
    const schema = this.requireSchema(user);
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    const header = await headerRepo.findOne({
      where: { id: headerId, nodeId },
    });
    if (!header) throw new NotFoundException('Cabecera no encontrada');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Nombre requerido');
      header.name = name;
    }
    if (dto.description !== undefined) {
      header.description = dto.description.trim();
    }
    if (dto.portCount !== undefined) header.portCount = dto.portCount;
    if (dto.ports !== undefined) {
      header.ports = this.normalizePorts(header.portCount, dto.ports);
    } else if (dto.portCount !== undefined) {
      header.ports = this.normalizePorts(header.portCount, header.ports);
    }

    const saved = await headerRepo.save(header);
    return this.serializeHeader(saved);
  }

  /** Actualiza un solo puerto de la cabecera (asignaciones parciales). */
  async updateHeaderPort(
    user: AuthUser,
    nodeId: string,
    headerId: string,
    dto: NodeHeaderPortDto,
  ) {
    const schema = this.requireSchema(user);
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    const header = await headerRepo.findOne({
      where: { id: headerId, nodeId },
    });
    if (!header) throw new NotFoundException('Cabecera no encontrada');
    if (dto.index < 1 || dto.index > header.portCount) {
      throw new BadRequestException('Puerto fuera de rango');
    }
    const ports = this.normalizePorts(header.portCount, header.ports);
    header.ports = ports.map((p) =>
      p.index === dto.index
        ? this.normalizePorts(header.portCount, [{ ...p, ...dto }]).find(
            (x) => x.index === dto.index,
          )!
        : p,
    );
    const saved = await headerRepo.save(header);
    return this.serializeHeader(saved);
  }

  async removeHeader(user: AuthUser, nodeId: string, headerId: string) {
    const schema = this.requireSchema(user);
    const headerRepo =
      await this.tenantConnections.getNodeHeaderRepository(schema);
    const header = await headerRepo.findOne({
      where: { id: headerId, nodeId },
    });
    if (!header) throw new NotFoundException('Cabecera no encontrada');
    await headerRepo.delete({ id: headerId });
    return { ok: true };
  }

  /** Puntos para el mapa de red (nodos con coords + salud). */
  async listMapMarkers(user: AuthUser) {
    const list = await this.list(user);
    return list
      .filter(
        (n) =>
          n.isActive &&
          n.latitude != null &&
          n.longitude != null &&
          Number.isFinite(n.latitude) &&
          Number.isFinite(n.longitude),
      )
      .map((n) => ({
        id: n.id,
        kind: 'node' as const,
        lat: n.latitude as number,
        lng: n.longitude as number,
        label: n.name,
        subtitle: [n.street, n.city].filter(Boolean).join(', ') || null,
        health: n.health,
        onlineCount: n.onlineCount,
        offlineCount: n.offlineCount,
        assetCount: n.assetCount,
      }));
  }
}
