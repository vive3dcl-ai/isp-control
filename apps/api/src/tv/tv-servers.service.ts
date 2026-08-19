import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { CreateTvServerDto, UpdateTvServerDto } from './dto/tv-server.dto';
import { TvServer } from './entities/tv-server.entity';
import {
  allocateNextMulticastIp,
  parseMulticastCidr,
} from './tv-multicast.util';
import { sshExec, sshWriteFile, withSsh } from './tv-ssh.util';

const AGENT_DIR_CANDIDATES = [
  process.env.ISP_TV_AGENT_DIR?.trim(),
  '/opt/isp-tv-agent',
  join(process.cwd(), '../../tv-agent/dist'),
  join(process.cwd(), '../tv-agent/dist'),
  join(__dirname, '../../../../tv-agent/dist'),
].filter(Boolean) as string[];

@Injectable()
export class TvServersService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly config: ConfigService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private serialize(row: TvServer) {
    return {
      id: row.id,
      deviceId: row.deviceId,
      name: row.name,
      sshHost: row.sshHost,
      sshPort: row.sshPort,
      sshUsername: row.sshUsername,
      hasSshPassword: !!row.sshPassword,
      apiBaseUrl: row.apiBaseUrl,
      hasApiToken: !!row.apiToken,
      apiListen: row.apiListen,
      multicastCidr: row.multicastCidr,
      multicastPort: row.multicastPort ?? 5000,
      agentVersion: row.agentVersion,
      status: row.status,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async repo(schema: string) {
    return this.tenantConnections.getTvServerRepository(schema);
  }

  /** Version shipped inside the API image (/opt/isp-tv-agent/VERSION). */
  bundledAgentVersion(): string {
    const extra = this.config.get<string>('ISP_TV_AGENT_DIR')?.trim();
    const dirs = [
      ...(extra ? [extra] : []),
      ...AGENT_DIR_CANDIDATES,
    ];
    for (const dir of dirs) {
      const p = join(dir, 'VERSION');
      if (existsSync(p)) {
        const v = readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    }
    return '0.0.0';
  }

  agentRelease() {
    return { version: this.bundledAgentVersion() };
  }

  /**
   * Refresh live agent version via /v1/health and compare to the binary
   * bundled in this API deploy.
   */
  async checkUpdate(user: AuthUser, id: string) {
    const row = await this.requireServer(user, id);
    const availableVersion = this.bundledAgentVersion();
    let installedVersion = row.agentVersion;
    let reachable = false;
    if (row.apiBaseUrl && row.apiToken) {
      try {
        const health = await this.agentFetch(row, '/v1/health');
        if (typeof health?.version === 'string' && health.version.trim()) {
          installedVersion = health.version.trim();
          row.agentVersion = installedVersion;
          row.status = 'online';
          row.lastError = null;
          const schema = this.requireSchema(user);
          const repo = await this.repo(schema);
          await repo.save(row);
        }
        reachable = true;
      } catch {
        reachable = false;
      }
    }
    const updateAvailable =
      availableVersion !== '0.0.0' &&
      (!installedVersion ||
        compareAgentVersions(availableVersion, installedVersion) > 0);
    return {
      serverId: row.id,
      installedVersion: installedVersion ?? null,
      availableVersion,
      updateAvailable,
      reachable,
      server: this.serialize(row),
    };
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.repo(schema);
    const rows = await repo.find({ order: { name: 'ASC' } });
    return { servers: rows.map((r) => this.serialize(r)) };
  }

  async get(user: AuthUser, id: string) {
    const row = await this.requireServer(user, id);
    return this.serialize(row);
  }

  private async requireServer(user: AuthUser, id: string): Promise<TvServer> {
    const schema = this.requireSchema(user);
    const repo = await this.repo(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Servidor TV no encontrado');
    return row;
  }

  async create(user: AuthUser, dto: CreateTvServerDto) {
    const schema = this.requireSchema(user);
    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const device = await devices.findOne({ where: { id: dto.deviceId } });
    if (!device || device.type !== 'server') {
      throw new BadRequestException(
        'Debes ligar un activo de topología tipo servidor',
      );
    }
    const repo = await this.repo(schema);
    const existing = await repo.findOne({ where: { deviceId: dto.deviceId } });
    if (existing) {
      throw new BadRequestException(
        'Ya existe un servidor TV ligado a ese activo',
      );
    }
    const listen = dto.apiListen?.trim() || ':8099';
    const listenPort = parseListenPort(listen);
    const apiBaseUrl =
      dto.apiBaseUrl?.trim() ||
      `http://${dto.sshHost.trim()}:${listenPort}`;

    let multicastCidr: string | null = null;
    const multicastPort = dto.multicastPort ?? 5000;
    if (dto.multicastCidr?.trim()) {
      multicastCidr = parseMulticastCidr(
        dto.multicastCidr,
        multicastPort,
      ).cidr;
    }

    const row = await repo.save(
      repo.create({
        deviceId: dto.deviceId,
        name: dto.name.trim(),
        sshHost: dto.sshHost.trim(),
        sshPort: dto.sshPort ?? 22,
        sshUsername: dto.sshUsername.trim(),
        sshPassword: dto.sshPassword,
        apiListen: listen,
        apiBaseUrl,
        multicastCidr,
        multicastPort,
        status: 'pending',
        lastError: null,
      }),
    );
    return this.serialize(row);
  }

  async update(user: AuthUser, id: string, dto: UpdateTvServerDto) {
    const schema = this.requireSchema(user);
    const repo = await this.repo(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Servidor TV no encontrado');

    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.multicastPort !== undefined) {
      row.multicastPort = dto.multicastPort;
    }
    if (dto.multicastCidr !== undefined) {
      const raw = dto.multicastCidr?.trim() || '';
      if (!raw) {
        row.multicastCidr = null;
      } else {
        row.multicastCidr = parseMulticastCidr(
          raw,
          row.multicastPort ?? 5000,
        ).cidr;
      }
    }
    await repo.save(row);
    return this.serialize(row);
  }

  /**
   * Next udp://IP:port in the server multicast pool (IP incremental, same port).
   */
  async nextOutput(user: AuthUser, id: string) {
    const row = await this.requireServer(user, id);
    if (!row.multicastCidr?.trim()) {
      throw new BadRequestException(
        'Define el segmento multicast del servidor (editar servidor) antes de asignar salidas',
      );
    }
    const range = parseMulticastCidr(
      row.multicastCidr,
      row.multicastPort ?? 5000,
    );
    let used: string[] = [];
    if (row.apiToken && row.apiBaseUrl) {
      try {
        const data = await this.agentFetch(row, '/v1/channels');
        const channels = Array.isArray(data?.channels) ? data.channels : [];
        used = channels
          .map((c: any) => c?.channel?.output ?? c?.output)
          .filter((o: unknown): o is string => typeof o === 'string');
      } catch {
        // Agent offline: still allocate from .1
        used = [];
      }
    }
    const output = allocateNextMulticastIp(range, used);
    return {
      output,
      multicastCidr: range.cidr,
      multicastPort: range.port,
    };
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.repo(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Servidor TV no encontrado');
    await repo.remove(row);
    return { ok: true };
  }

  /**
   * Run one install step. Front drives OperationProgressModal runners.
   */
  async installStep(
    user: AuthUser,
    id: string,
    step:
      | 'ssh'
      | 'detect'
      | 'upload'
      | 'install'
      | 'health'
      | 'rewrite'
      | 'verify',
  ) {
    const schema = this.requireSchema(user);
    const repo = await this.repo(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Servidor TV no encontrado');
    const needsSsh = ['ssh', 'detect', 'upload', 'install'].includes(step);
    if (needsSsh && !row.sshPassword) {
      throw new BadRequestException('Falta contraseña SSH');
    }
    const sshPassword = row.sshPassword ?? '';

    if (needsSsh || step === 'health') {
      row.status = 'installing';
      row.lastError = null;
      await repo.save(row);
    }

    try {
      let detail = '';
      if (step === 'ssh') {
        detail = await withSsh(
          {
            host: row.sshHost,
            port: row.sshPort,
            username: row.sshUsername,
            password: sshPassword,
          },
          async (client) => {
            const r = await sshExec(client, 'echo ISP_TV_SSH_OK && uname -s');
            if (r.code !== 0 || !r.stdout.includes('ISP_TV_SSH_OK')) {
              throw new Error(r.stderr || 'SSH falló');
            }
            return r.stdout.trim();
          },
        );
      } else if (step === 'detect') {
        detail = await withSsh(
          {
            host: row.sshHost,
            port: row.sshPort,
            username: row.sshUsername,
            password: sshPassword,
          },
          async (client) => {
            const r = await sshExec(
              client,
              [
                'uname -m',
                // Detect existing ffmpeg only — never install/upgrade (XtreamUI-safe).
                'FF=""',
                'command -v ffmpeg >/dev/null 2>&1 && FF=$(command -v ffmpeg)',
                '[ -z "$FF" ] && [ -x /usr/bin/ffmpeg ] && FF=/usr/bin/ffmpeg',
                '[ -z "$FF" ] && [ -x /usr/local/bin/ffmpeg ] && FF=/usr/local/bin/ffmpeg',
                '[ -z "$FF" ] && [ -x /home/xtreamcodes/iptv_xtream_codes/php/bin/ffmpeg ] && FF=/home/xtreamcodes/iptv_xtream_codes/php/bin/ffmpeg',
                '[ -z "$FF" ] && [ -x /home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg ] && FF=/home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg',
                'if [ -n "$FF" ]; then echo "FFMPEG_OK $FF"; else echo FFMPEG_MISSING; fi',
                'command -v systemctl >/dev/null && echo SYSTEMD_OK || echo SYSTEMD_MISSING',
              ].join('; '),
            );
            if (r.code !== 0) throw new Error(r.stderr || 'detect failed');
            const arch = r.stdout.split('\n')[0]?.trim() || '';
            if (!/^(x86_64|amd64|aarch64|arm64)$/.test(arch)) {
              throw new Error(`Arquitectura no soportada: ${arch}`);
            }
            if (r.stdout.includes('FFMPEG_MISSING')) {
              throw new Error(
                'No hay ffmpeg en el servidor. No lo instalamos automáticamente (para no tocar XtreamUI). Instálalo o deja el binario de Xtream y reintenta.',
              );
            }
            if (r.stdout.includes('SYSTEMD_MISSING')) {
              throw new Error('systemd no disponible en el servidor');
            }
            const ffLine =
              r.stdout
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l.startsWith('FFMPEG_OK')) || 'FFMPEG_OK';
            return `${r.stdout.trim()}\n(reusando ${ffLine.replace('FFMPEG_OK', '').trim() || 'ffmpeg existente'}; no se instala ni actualiza)`;
          },
        );
      } else if (step === 'upload') {
        detail = await withSsh(
          {
            host: row.sshHost,
            port: row.sshPort,
            username: row.sshUsername,
            password: sshPassword,
          },
          async (client) => {
            const archR = await sshExec(client, 'uname -m');
            const arch = archR.stdout.trim();
            const goArch =
              arch === 'aarch64' || arch === 'arm64' ? 'arm64' : 'amd64';
            const { binary, installSh } = this.resolveAgentArtifacts(goArch);
            await sshExec(client, 'mkdir -p /tmp/isp-tv-install && chmod 755 /tmp/isp-tv-install');
            await sshWriteFile(
              client,
              '/tmp/isp-tv-install/isp-tv-agent',
              binary,
              0o755,
            );
            await sshWriteFile(
              client,
              '/tmp/isp-tv-install/install.sh',
              installSh,
              0o755,
            );
            return `subido agent linux-${goArch} (${binary.length} bytes)`;
          },
        );
      } else if (step === 'install') {
        detail = await withSsh(
          {
            host: row.sshHost,
            port: row.sshPort,
            username: row.sshUsername,
            password: sshPassword,
          },
          async (client) => {
            const listen = row.apiListen || ':8099';
            const qListen = listen.replace(/'/g, `'\\''`);
            const script = `/tmp/isp-tv-install/install.sh /tmp/isp-tv-install/isp-tv-agent '${qListen}'`;
            const isRoot = row.sshUsername === 'root';
            const cmd = isRoot
              ? script
              : `echo ${shellEscape(sshPassword)} | sudo -S -p '' ${script}`;
            const r = await sshExec(client, cmd, 180_000);
            const out = `${r.stdout}\n${r.stderr}`;
            if (r.code !== 0 || !out.includes('ISP_TV_INSTALL_OK')) {
              throw new Error(
                out.trim() ||
                  'Install falló (¿sudo sin password para este usuario?)',
              );
            }
            const token = out
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.startsWith('ISP_TV_TOKEN='))
              ?.slice('ISP_TV_TOKEN='.length);
            if (!token) throw new Error('Install OK pero no se recibió token');
            row.apiToken = token;
            if (!row.apiBaseUrl) {
              row.apiBaseUrl = `http://${row.sshHost}:${parseListenPort(listen)}`;
            }
            await repo.save(row);
            return 'agente instalado y token capturado';
          },
        );
      } else if (step === 'health') {
        if (!row.apiToken || !row.apiBaseUrl) {
          throw new Error('Falta api token / base URL — corre install antes');
        }
        const health = await this.agentFetch(row, '/v1/health');
        row.agentVersion =
          typeof health?.version === 'string' ? health.version : row.agentVersion;
        row.status = 'online';
        row.lastError = null;
        await repo.save(row);
        detail = `online v${row.agentVersion ?? '?'}`;
      } else if (step === 'rewrite') {
        detail = await this.rewriteChannelsAfterUpdate(row);
      } else if (step === 'verify') {
        detail = await this.verifyChannelsAfterUpdate(row);
        row.status = 'online';
        row.lastError = null;
        await repo.save(row);
      }

      if (step !== 'health' && step !== 'verify') {
        await repo.save(row);
      }
      return { ok: true, step, detail };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      row.status = 'error';
      row.lastError = msg;
      await repo.save(row);
      throw new BadRequestException(msg);
    }
  }

  /** Rewrite failover units + restart previously active channels. */
  private async rewriteChannelsAfterUpdate(row: TvServer): Promise<string> {
    if (!row.apiToken || !row.apiBaseUrl) {
      throw new Error('Falta API del agente');
    }
    const data = await this.agentFetch(row, '/v1/maintenance/repair-channels', {
      method: 'POST',
    });
    const total = Number(data?.total ?? 0);
    const repaired = Number(data?.repaired ?? 0);
    const restarted = Number(data?.restarted ?? 0);
    const failed = Number(data?.failed ?? 0);
    if (failed > 0) {
      const errs = Array.isArray(data?.channels)
        ? data.channels
            .filter((c: any) => c?.error)
            .map((c: any) => `${c.name || c.id}: ${c.error}`)
            .slice(0, 5)
            .join('; ')
        : '';
      throw new Error(
        `Repair falló en ${failed}/${total}${errs ? ` — ${errs}` : ''}`,
      );
    }
    const withBackups = Array.isArray(data?.channels)
      ? data.channels.filter((c: any) => Number(c?.sourceCount ?? 0) > 1).length
      : 0;
    return `${repaired} units reescritas, ${restarted} reiniciadas, ${withBackups} con respaldos`;
  }

  /** Poll until running channels report link=up; validate sources persisted. */
  private async verifyChannelsAfterUpdate(row: TvServer): Promise<string> {
    if (!row.apiToken || !row.apiBaseUrl) {
      throw new Error('Falta API del agente');
    }
    const deadline = Date.now() + 60_000;
    let lastDetail = 'sin canales';
    while (Date.now() < deadline) {
      const data = await this.agentFetch(row, '/v1/channels');
      const channels = Array.isArray(data?.channels) ? data.channels : [];
      if (channels.length === 0) {
        return 'sin canales que verificar';
      }
      const missingSources = channels.filter((rowCh: any) => {
        const ch = rowCh?.channel ?? rowCh;
        const sources = Array.isArray(ch?.sources) ? ch.sources : [];
        const source = typeof ch?.source === 'string' ? ch.source : '';
        return sources.length === 0 && !source.trim();
      });
      if (missingSources.length > 0) {
        throw new Error(
          `${missingSources.length} canal(es) sin fuente tras actualizar`,
        );
      }
      const running = channels.filter((rowCh: any) => {
        const st = rowCh?.status ?? {};
        return st.state === 'running' || st.state === 'starting';
      });
      if (running.length === 0) {
        const withBackups = channels.filter((rowCh: any) => {
          const ch = rowCh?.channel ?? rowCh;
          return Array.isArray(ch?.sources) && ch.sources.length > 1;
        }).length;
        return `${channels.length} canales OK (ninguno en marcha), ${withBackups} con respaldos`;
      }
      const down = running.filter((rowCh: any) => {
        const st = rowCh?.status ?? {};
        return st.link !== 'up';
      });
      if (down.length === 0) {
        const withBackups = channels.filter((rowCh: any) => {
          const ch = rowCh?.channel ?? rowCh;
          return Array.isArray(ch?.sources) && ch.sources.length > 1;
        }).length;
        return `${running.length}/${channels.length} UP, ${withBackups} con respaldos`;
      }
      lastDetail = `esperando UP: ${down.length}/${running.length} aún down`;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`Timeout verificando canales — ${lastDetail}`);
  }

  private resolveAgentArtifacts(goArch: 'amd64' | 'arm64'): {
    binary: Buffer;
    installSh: Buffer;
  } {
    const extra = this.config.get<string>('ISP_TV_AGENT_DIR')?.trim();
    const dirs = [
      ...(extra ? [extra] : []),
      ...AGENT_DIR_CANDIDATES,
    ];
    for (const dir of dirs) {
      const binPath = join(dir, `isp-tv-agent-linux-${goArch}`);
      const shPath = join(dir, 'install.sh');
      if (existsSync(binPath) && existsSync(shPath)) {
        return {
          binary: readFileSync(binPath),
          installSh: readFileSync(shPath),
        };
      }
    }
    throw new ServiceUnavailableException(
      `No hay binario isp-tv-agent-linux-${goArch} (busca en /opt/isp-tv-agent o apps/tv-agent/dist)`,
    );
  }

  async agentFetch(
    row: TvServer,
    path: string,
    init?: RequestInit & { raw?: boolean },
  ): Promise<any> {
    if (!row.apiBaseUrl || !row.apiToken) {
      throw new BadRequestException('Servidor TV sin API configurada');
    }
    const url = `${row.apiBaseUrl.replace(/\/$/, '')}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${row.apiToken}`,
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ServiceUnavailableException(
        `No se pudo contactar el agente: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (init?.raw) return res;
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const msg =
        (body && (body.error || body.message)) ||
        `Agente HTTP ${res.status}`;
      throw new BadRequestException(String(msg));
    }
    return body;
  }

  async proxy(
    user: AuthUser,
    id: string,
    path: string,
    init?: RequestInit,
  ) {
    const row = await this.requireServer(user, id);
    return this.agentFetch(row, path, init);
  }

  async proxyMultipart(
    user: AuthUser,
    id: string,
    path: string,
    form: FormData,
  ) {
    const row = await this.requireServer(user, id);
    return this.agentFetch(row, path, { method: 'POST', body: form as any });
  }

  async fetchLogo(user: AuthUser, id: string, channelId: string) {
    const row = await this.requireServer(user, id);
    if (!row.apiBaseUrl || !row.apiToken) {
      throw new BadRequestException('Servidor TV sin API configurada');
    }
    const url = `${row.apiBaseUrl.replace(/\/$/, '')}/v1/logos/${channelId}`;
    let r: Response;
    try {
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${row.apiToken}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ServiceUnavailableException(
        e instanceof Error ? e.message : String(e),
      );
    }
    if (!r.ok) throw new NotFoundException('Logo no encontrado');
    return {
      contentType: r.headers.get('content-type') || 'image/png',
      buffer: Buffer.from(await r.arrayBuffer()),
    };
  }

  async hostMetrics(user: AuthUser, id: string) {
    const row = await this.requireServer(user, id);
    try {
      const host = await this.agentFetch(row, '/v1/host');
      if (row.status !== 'online') {
        row.status = 'online';
        row.lastError = null;
        const schema = this.requireSchema(user);
        await (await this.repo(schema)).save(row);
      }
      return { server: this.serialize(row), host };
    } catch (e) {
      row.status = 'offline';
      row.lastError = e instanceof Error ? e.message : String(e);
      const schema = this.requireSchema(user);
      await (await this.repo(schema)).save(row);
      throw e;
    }
  }
}

function parseListenPort(listen: string): number {
  const m = listen.trim().match(/:(\d+)\s*$/);
  if (m) return Number(m[1]);
  const n = Number(listen);
  return Number.isFinite(n) && n > 0 ? n : 8099;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Compare dotted versions (e.g. 0.2.0). Returns >0 if a > b. */
export function compareAgentVersions(a: string, b: string): number {
  const pa = a
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x) || 0);
  const pb = b
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length, 1);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
