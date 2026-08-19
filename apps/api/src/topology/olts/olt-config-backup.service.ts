import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import type { AuthUser } from '../../auth/auth.types';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { ZteC3xxOltClient } from '../../drivers/olt/zte/c3xx/cli';
import { ZteTitanOltClient } from '../../drivers/olt/zte/titan/cli';
import { HuaweiOltClient } from '../../drivers/olt/huawei/huawei-olt.client';
import { resolveOltCli } from '../../drivers/olt/registry';
import { NetworkAuditService } from '../onus/network-audit.service';
import type { NetworkDevice } from '../shared/entities/network-device.entity';
import type { OltConfigSnapshot } from '../shared/entities/olt-config-snapshot.entity';
import {
  DEFAULT_OLT_PORTS,
  isHuaweiOltDevice,
  isManagedOltDevice,
} from './olt.constants';
import {
  OLT_BACKUP_KEEP,
  diffConfigLines,
  looksCompleteOltConfigDump,
  oltBackupDir,
  oltBackupFilePath,
} from './olt-config-backup.util';

export type OltConfigSnapshotDto = {
  id: string;
  oltId: string;
  source: 'scheduled' | 'manual';
  byteSize: number;
  sha256: string;
  complete: boolean;
  fileName: string;
  note: string | null;
  createdAt: string;
};

@Injectable()
export class OltConfigBackupService {
  private readonly logger = new Logger(OltConfigBackupService.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly audit: NetworkAuditService,
    private readonly zteC3xx: ZteC3xxOltClient,
    private readonly zteTitan: ZteTitanOltClient,
    private readonly huawei: HuaweiOltClient,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private toDto(row: OltConfigSnapshot): OltConfigSnapshotDto {
    return {
      id: row.id,
      oltId: row.oltId,
      source: row.source,
      byteSize: row.byteSize,
      sha256: row.sha256,
      complete: row.complete,
      fileName: row.fileName,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private conn(olt: NetworkDevice) {
    if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
      throw new BadRequestException('OLT sin credenciales de gestión');
    }
    const protocol: 'telnet' | 'ssh' =
      olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const port =
      olt.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);
    return {
      host: olt.mgmtHost,
      port,
      protocol,
      username: olt.mgmtUsername,
      password: olt.mgmtPassword,
    };
  }

  private async requireOlt(schema: string, oltId: string): Promise<NetworkDevice> {
    const repo = await this.tenants.getNetworkDeviceRepository(schema);
    const olt = await repo.findOne({ where: { id: oltId } });
    if (!olt) throw new NotFoundException('Equipo no encontrado');
    if (!isManagedOltDevice(olt.type, olt.subtype)) {
      throw new BadRequestException('El equipo no es una OLT gestionada');
    }
    return olt;
  }

  async list(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    await this.requireOlt(schema, oltId);
    const repo = await this.tenants.getOltConfigSnapshotRepository(schema);
    const rows = await repo.find({
      where: { oltId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { snapshots: rows.map((r) => this.toDto(r)) };
  }

  async capture(
    user: AuthUser | null,
    schema: string,
    oltId: string,
    source: 'scheduled' | 'manual',
  ) {
    const olt = await this.requireOlt(schema, oltId);
    const t0 = Date.now();
    const vendor: 'zte' | 'huawei' = isHuaweiOltDevice(olt.type, olt.subtype)
      ? 'huawei'
      : 'zte';
    const cli = resolveOltCli(olt, {
      zteC3xx: this.zteC3xx,
      zteTitan: this.zteTitan,
      huawei: this.huawei,
    });
    const text = await cli.dumpRunningConfig({
      ...this.conn(olt),
      priority: source === 'manual' ? 'interactive' : 'background',
    });
    const complete = looksCompleteOltConfigDump(text, vendor);
    const buf = Buffer.from(text, 'utf8');
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const repo = await this.tenants.getOltConfigSnapshotRepository(schema);
    const row = repo.create({
      oltId: olt.id,
      source,
      byteSize: buf.length,
      sha256,
      complete,
      fileName: '',
      note: complete ? null : 'Dump incompleto o truncado',
    });
    await repo.save(row);
    const fileName = `${row.id}.cfg`;
    const dest = oltBackupFilePath(schema, olt.id, fileName);
    try {
      await fs.mkdir(oltBackupDir(schema, olt.id), { recursive: true });
      await fs.writeFile(dest, buf);
      row.fileName = fileName;
      await repo.save(row);
    } catch (err) {
      await repo.delete({ id: row.id }).catch(() => undefined);
      throw new BadRequestException(
        `No se pudo guardar el archivo: ${err instanceof Error ? err.message : err}`,
      );
    }
    await this.prune(schema, olt.id);
    await this.audit.record(schema, {
      action: 'olt_config_backup',
      ok: true,
      durationMs: Date.now() - t0,
      oltId: olt.id,
      detail: {
        source,
        complete,
        byteSize: buf.length,
        snapshotId: row.id,
      },
      ...(user ? this.audit.actorFromUser(user) : { actorKind: 'system' as const }),
    });
    return this.toDto(row);
  }

  async captureNow(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    return this.capture(user, schema, oltId, 'manual');
  }

  async download(user: AuthUser, oltId: string, snapId: string) {
    const schema = this.requireSchema(user);
    await this.requireOlt(schema, oltId);
    const row = await this.loadSnap(schema, oltId, snapId);
    const dest = oltBackupFilePath(schema, oltId, row.fileName);
    try {
      await fs.access(dest);
    } catch {
      throw new NotFoundException('Archivo de respaldo no encontrado en disco');
    }
    const downloadName = `${row.createdAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.cfg`;
    return {
      stream: createReadStream(dest),
      fileName: downloadName,
      byteSize: row.byteSize,
    };
  }

  async diff(user: AuthUser, oltId: string, aId: string, bId: string) {
    const schema = this.requireSchema(user);
    await this.requireOlt(schema, oltId);
    if (!aId || !bId || aId === bId) {
      throw new BadRequestException('Indica dos copias distintas (a y b)');
    }
    const a = await this.loadSnap(schema, oltId, aId);
    const b = await this.loadSnap(schema, oltId, bId);
    const textA = await fs.readFile(
      oltBackupFilePath(schema, oltId, a.fileName),
      'utf8',
    );
    const textB = await fs.readFile(
      oltBackupFilePath(schema, oltId, b.fileName),
      'utf8',
    );
    const { added, removed, hunks } = diffConfigLines(textA, textB);
    return {
      a: this.toDto(a),
      b: this.toDto(b),
      added,
      removed,
      truncated: hunks.length >= 400,
      hunks,
    };
  }

  async setTechnicianMode(user: AuthUser, oltId: string, on: boolean) {
    const schema = this.requireSchema(user);
    const olt = await this.requireOlt(schema, oltId);
    olt.technicianMode = on;
    const repo = await this.tenants.getNetworkDeviceRepository(schema);
    await repo.save(olt);
    await this.audit.record(schema, {
      action: 'olt_technician_mode',
      ok: true,
      oltId: olt.id,
      detail: { technicianMode: on },
      ...this.audit.actorFromUser(user),
    });
    return { id: olt.id, technicianMode: olt.technicianMode };
  }

  async snapshotSchema(schema: string): Promise<void> {
    const repo = await this.tenants.getNetworkDeviceRepository(schema);
    const olts = await repo.find({
      where: { type: 'olt', isActive: true },
    });
    const snapRepo = await this.tenants.getOltConfigSnapshotRepository(schema);
    const minAgeMs = 20 * 60 * 60 * 1000;
    for (const olt of olts) {
      if (!isManagedOltDevice(olt.type, olt.subtype)) continue;
      if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) continue;
      const last = await snapRepo.findOne({
        where: { oltId: olt.id },
        order: { createdAt: 'DESC' },
      });
      if (last && Date.now() - last.createdAt.getTime() < minAgeMs) continue;
      try {
        await this.capture(null, schema, olt.id, 'scheduled');
      } catch (err) {
        this.logger.warn(
          `backup OLT ${olt.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async loadSnap(
    schema: string,
    oltId: string,
    id: string,
  ): Promise<OltConfigSnapshot> {
    const repo = await this.tenants.getOltConfigSnapshotRepository(schema);
    const row = await repo.findOne({ where: { id, oltId } });
    if (!row) throw new NotFoundException('Copia de config no encontrada');
    return row;
  }

  private async prune(schema: string, oltId: string): Promise<void> {
    const repo = await this.tenants.getOltConfigSnapshotRepository(schema);
    const rows = await repo.find({
      where: { oltId },
      order: { createdAt: 'DESC' },
    });
    const extra = rows.slice(OLT_BACKUP_KEEP);
    for (const row of extra) {
      await fs
        .unlink(oltBackupFilePath(schema, oltId, row.fileName))
        .catch(() => undefined);
      await repo.delete({ id: row.id });
    }
  }
}
