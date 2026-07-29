import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type { Tr069Profile } from './entities/tr069-profile.entity';
import type { Tr069ProfileOlt } from './entities/tr069-profile-olt.entity';
import {
  CreateTr069ProfileDto,
  SetTr069ProfileOltsDto,
  UpdateTr069ProfileDto,
} from './dto/tr069.dto';
import { randomPassword } from './vpn-script.util';
import { Socket } from 'node:net';
import {
  GenieAcsNbiClient,
  deviceIdMatchesSerial,
  genieGet,
  resolveNbiBaseUrl,
  strVal,
} from './genieacs-nbi.client';

export const DEFAULT_TR069_ACS_PORT = 14501;
export const DEFAULT_TR069_NBI_PORT = 7557;
export const DEFAULT_TR069_FS_PORT = 7567;
export const DEFAULT_TR069_INFORM_INTERVAL = 300;

export type AcsServiceStatus = 'online' | 'offline' | 'unknown';

@Injectable()
export class Tr069Service {
  constructor(private readonly tenantConnections: TenantConnectionService) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  /** TCP probe of ACS host:port (CWMP listener). */
  private async probeTcp(
    host: string,
    port: number,
    timeoutMs = 2500,
  ): Promise<AcsServiceStatus> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;
      const done = (status: AcsServiceStatus) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(status);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done('online'));
      socket.once('timeout', () => done('offline'));
      socket.once('error', () => done('offline'));
      try {
        socket.connect(port, host);
      } catch {
        done('offline');
      }
    });
  }

  /**
   * Probe ACS ports. ONU-facing URL may be a VPN tunnel IP (e.g. 10.69.x.2)
   * unreachable from the API process — also try docker-host published ports.
   */
  private async probeAcsServices(acsUrl: string, acsPort: number) {
    const ep = this.parseAcsEndpoint(acsUrl, acsPort);
    const cwmpPort = ep?.port || acsPort || DEFAULT_TR069_ACS_PORT;
    const nbiFromEnv = this.hostFromUrl(process.env.TR069_NBI_URL);
    const candidates = [
      // Prefer Docker service name (shared netns with GenieACS in prod).
      process.env.TR069_ACS_PROBE_HOST,
      nbiFromEnv,
      'vpn-concentrator',
      ep?.host,
      'host.docker.internal',
      '172.17.0.1',
      '127.0.0.1',
    ].filter((h): h is string => Boolean(h?.trim()));

    // Unique preserve order
    const seen = new Set<string>();
    const hosts = candidates.filter((h) => {
      const key = h.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let probeHost: string | null = null;
    let cwmp: AcsServiceStatus = 'offline';
    for (const host of hosts) {
      const st = await this.probeTcp(host, cwmpPort);
      if (st === 'online') {
        probeHost = host;
        cwmp = 'online';
        break;
      }
    }

    let nbi: AcsServiceStatus = 'offline';
    let fs: AcsServiceStatus = 'offline';
    let nbiEndpoint: string | null = null;
    if (probeHost) {
      nbi = await this.probeTcp(probeHost, DEFAULT_TR069_NBI_PORT);
      fs = await this.probeTcp(probeHost, DEFAULT_TR069_FS_PORT);
      if (nbi === 'online') {
        nbiEndpoint = `http://${probeHost}:${DEFAULT_TR069_NBI_PORT}`;
      }
    }

    return { cwmp, nbi, fs, nbiEndpoint, probedVia: probeHost };
  }

  private hostFromUrl(raw: string | undefined): string | null {
    const v = raw?.trim();
    if (!v) return null;
    try {
      return new URL(v).hostname || null;
    } catch {
      return null;
    }
  }

  private parseAcsEndpoint(acsUrl: string, fallbackPort: number) {
    try {
      const u = new URL(acsUrl);
      const port =
        u.port && Number(u.port)
          ? Number(u.port)
          : u.protocol === 'https:'
            ? 443
            : fallbackPort || 80;
      return { host: u.hostname, port };
    } catch {
      return null;
    }
  }

  async getStatus(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const profiles = await repo.find({ order: { name: 'ASC' } });

    const faults: Array<{
      when: string;
      profileId: string;
      profileName: string;
      deviceId: string | null;
      channel: string;
      code: string;
      message: string;
      retries: number;
    }> = [];

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const managed = await onuRepo.find({
      where: { tr069ProfileId: Not(IsNull()) },
      order: { updatedAt: 'DESC' },
    });

    const oltIds = [...new Set(managed.map((o) => o.oltId))];
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olts =
      oltIds.length > 0
        ? await deviceRepo.find({ where: { id: In(oltIds) } })
        : [];
    const oltName = new Map(olts.map((d) => [d.id, d.name]));
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    let acsDevices: Record<string, unknown>[] = [];
    let acsDevicesCount: number | null = null;
    try {
      const nbi = new GenieAcsNbiClient(resolveNbiBaseUrl());
      acsDevices = await nbi.findDevices({});
      acsDevicesCount = acsDevices.length;
    } catch {
      acsDevices = [];
      acsDevicesCount = null;
    }

    const parseLastInform = (device: Record<string, unknown> | undefined) => {
      if (!device) return null;
      const li = device._lastInform;
      if (li instanceof Date) return li.toISOString();
      if (typeof li === 'string') return li;
      if (li && typeof li === 'object' && '$date' in li) {
        return String(li.$date);
      }
      return null;
    };

    const onus = managed.map((o) => {
      const profile = o.tr069ProfileId
        ? profileById.get(o.tr069ProfileId)
        : undefined;
      const sn = (o.sn || '').trim();
      const acs = sn
        ? acsDevices.find((d) =>
            deviceIdMatchesSerial(
              typeof d._id === 'string' || typeof d._id === 'number'
                ? String(d._id)
                : '',
              sn,
            ),
          )
        : undefined;
      const lastInform = parseLastInform(acs);
      const model =
        strVal(genieGet(acs, 'InternetGatewayDevice.DeviceInfo.ModelName')) ??
        strVal(genieGet(acs, 'Device.DeviceInfo.ModelName')) ??
        o.onuType;
      const nowMs = Date.now();
      let state = 'not_in_acs';
      if (acs) {
        if (lastInform) {
          const t = Date.parse(lastInform);
          state =
            Number.isFinite(t) && nowMs - t < 60 * 60 * 1000
              ? 'online'
              : 'stale';
        } else {
          state = 'in_acs';
        }
      } else if (o.mgmtIp) {
        state = 'waiting_inform';
      }
      return {
        deviceId: acs ? String(acs._id) : o.id,
        serial: sn || o.id,
        oltName: oltName.get(o.oltId) ?? null,
        model: model ?? null,
        description: o.name || o.description || null,
        ip: o.mgmtIp,
        lastInform,
        state,
        profileId: o.tr069ProfileId || '',
        profileName: profile?.name ?? '—',
      };
    });

    const now = Date.now();
    const onlineCutoffMs = 60 * 60 * 1000;
    let onlineInformed = 0;
    let notInformedRecently = 0;
    for (const o of onus) {
      if (!o.lastInform) {
        notInformedRecently += 1;
        continue;
      }
      const t = Date.parse(o.lastInform);
      if (Number.isFinite(t) && now - t < onlineCutoffMs) onlineInformed += 1;
      else notInformedRecently += 1;
    }

    const acsHealth = await Promise.all(
      profiles.map(async (p) => {
        const health = await this.probeAcsServices(p.acsUrl, p.acsPort);
        return {
          profileId: p.id,
          profileName: p.name,
          type: 'integrated' as const,
          nbiEndpoint: health.nbiEndpoint,
          acsUrl: p.acsUrl,
          services: {
            cwmp: health.cwmp,
            nbi: health.nbi,
            fs: health.fs,
          },
          devicesInAcs: acsDevicesCount,
          faults: faults.filter((f) => f.profileId === p.id).length,
        };
      }),
    );

    return {
      summary: {
        managedOnus: onus.length,
        onlineInformed,
        notInformedRecently,
        activeFaults: faults.length,
      },
      acsHealth,
      faults,
      onus,
      refreshedAt: new Date().toISOString(),
    };
  }

  private async loadOlts(
    schema: string,
    profileIds: string[],
  ): Promise<Map<string, { id: string; name: string }[]>> {
    const map = new Map<string, { id: string; name: string }[]>();
    if (profileIds.length === 0) return map;

    const joinRepo =
      await this.tenantConnections.getTr069ProfileOltRepository(schema);
    const joins = await joinRepo.find({
      where: { profileId: In(profileIds) },
    });
    if (joins.length === 0) return map;

    const deviceIds = [...new Set(joins.map((j) => j.deviceId))];
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const devices = await deviceRepo.find({
      where: { id: In(deviceIds), type: 'olt' },
    });
    const byId = new Map(devices.map((d) => [d.id, d]));

    for (const j of joins) {
      const d = byId.get(j.deviceId);
      if (!d) continue;
      const list = map.get(j.profileId) ?? [];
      list.push({ id: d.id, name: d.name });
      map.set(j.profileId, list);
    }
    return map;
  }

  private serialize(
    p: Tr069Profile,
    olts: { id: string; name: string }[],
    cwmpStatus: AcsServiceStatus = 'unknown',
  ) {
    return {
      id: p.id,
      name: p.name,
      acsUrl: p.acsUrl,
      acsPort: p.acsPort,
      acsUsername: p.acsUsername,
      acsPassword: p.acsPassword,
      connectionRequestUsername: p.connectionRequestUsername,
      connectionRequestPassword: p.connectionRequestPassword,
      periodicInformEnable: p.periodicInformEnable,
      periodicInformInterval: p.periodicInformInterval,
      cwmpStatus,
      oltIds: olts.map((o) => o.id),
      olts,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private async cwmpStatusFor(
    acsUrl: string,
    acsPort: number,
  ): Promise<AcsServiceStatus> {
    const health = await this.probeAcsServices(acsUrl, acsPort);
    return health.cwmp;
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const profiles = await repo.find({ order: { name: 'ASC' } });
    const oltMap = await this.loadOlts(
      schema,
      profiles.map((p) => p.id),
    );
    const statuses = await Promise.all(
      profiles.map((p) => this.cwmpStatusFor(p.acsUrl, p.acsPort)),
    );
    const cwmpStatus = statuses.some((s) => s === 'online')
      ? 'online'
      : statuses.length > 0
        ? 'offline'
        : 'unknown';
    return {
      profiles: profiles.map((p, i) =>
        this.serialize(p, oltMap.get(p.id) ?? [], statuses[i] ?? 'unknown'),
      ),
      cwmpStatus,
    };
  }

  async get(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('TR069 profile not found');
    const oltMap = await this.loadOlts(schema, [id]);
    const cwmp = await this.cwmpStatusFor(p.acsUrl, p.acsPort);
    return this.serialize(p, oltMap.get(id) ?? [], cwmp);
  }

  private async defaultAcsUrl(
    schema: string,
    port: number,
    explicit?: string,
  ): Promise<string> {
    if (explicit?.trim()) return explicit.trim();

    const vpnRepo = await this.tenantConnections.getVpnTunnelRepository(schema);

    const tunnels = await vpnRepo.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    const tunnel = tunnels[0];
    if (!tunnel?.serverAddress) {
      throw new BadRequestException(
        'No hay túnel VPN. Crea uno en Topología → VPN (concentrador), o indica acsUrl manualmente.',
      );
    }
    return `http://${tunnel.serverAddress}:${port}`;
  }

  async create(user: AuthUser, dto: CreateTr069ProfileDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);

    const port = dto.acsPort ?? DEFAULT_TR069_ACS_PORT;
    const acsUrl = await this.defaultAcsUrl(schema, port, dto.acsUrl);
    const name = (dto.name?.trim() || 'ISP Control').slice(0, 120);

    const existing = await repo.findOne({ where: { name } });
    if (existing) {
      throw new BadRequestException(`Ya existe un perfil con nombre "${name}"`);
    }

    const p = repo.create({
      name,
      acsUrl,
      acsPort: port,
      acsUsername: dto.acsUsername?.trim() || `acs_${randomPassword(6)}`,
      acsPassword: dto.acsPassword?.trim() || randomPassword(14),
      connectionRequestUsername:
        dto.connectionRequestUsername?.trim() || `cr_${randomPassword(6)}`,
      connectionRequestPassword:
        dto.connectionRequestPassword?.trim() || randomPassword(14),
      periodicInformEnable: dto.periodicInformEnable ?? true,
      periodicInformInterval:
        dto.periodicInformInterval ?? DEFAULT_TR069_INFORM_INTERVAL,
    });
    const saved = await repo.save(p);
    const cwmp = await this.cwmpStatusFor(saved.acsUrl, saved.acsPort);
    return this.serialize(saved, [], cwmp);
  }

  async update(user: AuthUser, id: string, dto: UpdateTr069ProfileDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('TR069 profile not found');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name required');
      const clash = await repo.findOne({ where: { name } });
      if (clash && clash.id !== id) {
        throw new BadRequestException(
          `Ya existe un perfil con nombre "${name}"`,
        );
      }
      p.name = name;
    }
    if (dto.acsUrl !== undefined) p.acsUrl = dto.acsUrl.trim();
    if (dto.acsPort !== undefined) p.acsPort = dto.acsPort;
    if (dto.acsUsername !== undefined) p.acsUsername = dto.acsUsername.trim();
    if (dto.acsPassword !== undefined) p.acsPassword = dto.acsPassword.trim();
    if (dto.connectionRequestUsername !== undefined) {
      p.connectionRequestUsername = dto.connectionRequestUsername.trim();
    }
    if (dto.connectionRequestPassword !== undefined) {
      p.connectionRequestPassword = dto.connectionRequestPassword.trim();
    }
    if (dto.periodicInformEnable !== undefined) {
      p.periodicInformEnable = dto.periodicInformEnable;
    }
    if (dto.periodicInformInterval !== undefined) {
      p.periodicInformInterval = dto.periodicInformInterval;
    }

    const saved = await repo.save(p);
    const oltMap = await this.loadOlts(schema, [id]);
    const cwmp = await this.cwmpStatusFor(saved.acsUrl, saved.acsPort);
    return this.serialize(saved, oltMap.get(id) ?? [], cwmp);
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('TR069 profile not found');

    const joinRepo =
      await this.tenantConnections.getTr069ProfileOltRepository(schema);
    await joinRepo.delete({ profileId: id });
    await repo.remove(p);
    return { ok: true };
  }

  async setOlts(user: AuthUser, id: string, dto: SetTr069ProfileOltsDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getTr069ProfileRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('TR069 profile not found');

    const deviceIds = [...new Set(dto.deviceIds ?? [])];
    if (deviceIds.length > 0) {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const devices = await deviceRepo.find({
        where: { id: In(deviceIds), type: 'olt' },
      });
      if (devices.length !== deviceIds.length) {
        throw new BadRequestException(
          'Uno o más deviceIds no son OLTs válidos',
        );
      }
    }

    const joinRepo =
      await this.tenantConnections.getTr069ProfileOltRepository(schema);
    await joinRepo.delete({ profileId: id });
    if (deviceIds.length > 0) {
      const rows: Tr069ProfileOlt[] = deviceIds.map((deviceId) =>
        joinRepo.create({ profileId: id, deviceId }),
      );
      await joinRepo.save(rows);
    }

    const oltMap = await this.loadOlts(schema, [id]);
    const cwmp = await this.cwmpStatusFor(p.acsUrl, p.acsPort);
    return this.serialize(p, oltMap.get(id) ?? [], cwmp);
  }
}
