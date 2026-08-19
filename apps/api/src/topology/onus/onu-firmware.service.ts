import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { In } from 'typeorm';
import type { AuthUser } from '../../auth/auth.types';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import type { OnuFirmwareImage } from '../shared/entities/onu-firmware-image.entity';
import type { Onu } from '../shared/entities/onu.entity';
import {
  GenieAcsNbiClient,
  deviceIdMatchesSerial,
  genieGet,
  resolveNbiBaseUrl,
  strVal,
} from '../shared/genieacs-nbi.client';
import { NetworkAuditService } from './network-audit.service';
import { normalizeOnuModelName } from './onu-model-catalog';
import {
  firmwareModelMatches,
  firmwareUpgradeSkipLabel,
  firmwareUpgradeSkipReason,
} from './onu-firmware.util';

const MAX_BYTES = 256 * 1024 * 1024;
const ACS_FILE_TYPE = '1 Firmware Upgrade Image';

export type FirmwareImageDto = {
  id: string;
  modelKey: string;
  version: string;
  fileName: string;
  byteSize: number;
  genieFileId: string | null;
  acsRegistered: boolean;
  note: string | null;
  createdAt: string;
};

export type FirmwareTargetDto = {
  onuId: string;
  sn: string | null;
  name: string | null;
  onuType: string | null;
  online: boolean;
  oltName: string;
  acsVersion: string | null;
  canUpgrade: boolean;
  skipReason: string | null;
};

@Injectable()
export class OnuFirmwareService {
  private readonly logger = new Logger(OnuFirmwareService.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly audit: NetworkAuditService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private acs(): GenieAcsNbiClient {
    return new GenieAcsNbiClient(resolveNbiBaseUrl());
  }

  private diskRoot(schema: string): string {
    const env = process.env.FIRMWARE_DIR?.trim();
    const root = env
      ? path.resolve(env)
      : path.resolve(process.cwd(), 'data', 'firmware');
    return path.join(root, schema.replace(/[^a-zA-Z0-9._-]+/g, '_'));
  }

  private toDto(row: OnuFirmwareImage): FirmwareImageDto {
    return {
      id: row.id,
      modelKey: row.modelKey,
      version: row.version,
      fileName: row.fileName,
      byteSize: Number(row.byteSize) || 0,
      genieFileId: row.genieFileId,
      acsRegistered: Boolean(row.genieFileId),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(user: AuthUser) {
    const schema = this.requireSchema(user);
    const repo = await this.tenants.getOnuFirmwareImageRepository(schema);
    const rows = await repo.find({ order: { createdAt: 'DESC' } });
    return { images: rows.map((r) => this.toDto(r)) };
  }

  async upload(
    user: AuthUser,
    file: Express.Multer.File | undefined,
    fields: { modelKey?: string; version?: string; note?: string },
  ) {
    if (!file?.path && !file?.buffer) {
      throw new BadRequestException('Falta el archivo de firmware (campo file)');
    }
    const size = file.size ?? file.buffer?.length ?? 0;
    if (size <= 0) throw new BadRequestException('El archivo está vacío');
    if (size > MAX_BYTES) {
      throw new BadRequestException(
        `El firmware supera el máximo (${MAX_BYTES / (1024 * 1024)} MB)`,
      );
    }
    const modelKey = normalizeOnuModelName(fields.modelKey ?? '');
    if (!modelKey) throw new BadRequestException('Modelo de ONU requerido');
    const version = (fields.version ?? '').trim().slice(0, 80);
    if (!version) throw new BadRequestException('Versión requerida');
    const note = fields.note?.trim() ? fields.note.trim().slice(0, 500) : null;
    const original =
      path.basename(file.originalname || 'firmware.bin').replace(/\0/g, '') ||
      'firmware.bin';

    const schema = this.requireSchema(user);
    const repo = await this.tenants.getOnuFirmwareImageRepository(schema);
    const row = repo.create({
      modelKey,
      version,
      fileName: original.slice(0, 255),
      filePath: '',
      byteSize: String(size),
      genieFileId: null,
      note,
    });
    await repo.save(row);

    const dir = path.join(this.diskRoot(schema), row.id);
    const dest = path.join(dir, original.slice(0, 180) || 'firmware.bin');
    try {
      await fs.mkdir(dir, { recursive: true });
      if (file.path) {
        await fs.copyFile(file.path, dest);
        await fs.unlink(file.path).catch(() => undefined);
      } else if (file.buffer) {
        await fs.writeFile(dest, file.buffer);
      }
      row.filePath = dest;
      await repo.save(row);
    } catch (err) {
      await repo.delete({ id: row.id }).catch(() => undefined);
      throw new BadRequestException(
        `No se pudo guardar el archivo: ${err instanceof Error ? err.message : err}`,
      );
    }

    await this.registerOnAcs(schema, row);
    return {
      image: this.toDto(row),
      acsWarning: row.genieFileId
        ? null
        : 'Archivo guardado; GenieACS no registró la imagen. El upgrade avisará hasta que ACS esté disponible.',
    };
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo = await this.tenants.getOnuFirmwareImageRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Imagen de firmware no encontrada');

    if (row.genieFileId) {
      try {
        await this.acs().deleteFile(row.genieFileId);
      } catch (err) {
        this.logger.warn(
          `GenieACS DELETE ${row.genieFileId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (row.filePath) {
      await fs
        .rm(path.dirname(row.filePath), { recursive: true, force: true })
        .catch(() => undefined);
    }
    await repo.delete({ id: row.id });
    return { ok: true };
  }

  async targets(user: AuthUser, imageId: string) {
    const schema = this.requireSchema(user);
    const image = await this.loadImage(schema, imageId);
    const onuRepo = await this.tenants.getOnuRepository(schema);
    const onus = (await onuRepo.find()).filter((o) =>
      firmwareModelMatches(image.modelKey, o.onuType),
    );
    const oltNames = await this.oltNames(schema, onus);
    const acsMap = await this.acsBySerial(onus);

    const targets: FirmwareTargetDto[] = onus.map((o) => {
      const sn = o.sn?.trim() || null;
      const hit = sn ? acsMap.get(sn.toUpperCase()) : undefined;
      const skip = firmwareUpgradeSkipReason({
        sn,
        acsDeviceId: hit?.id ?? null,
        genieFileId: image.genieFileId,
      });
      return {
        onuId: o.id,
        sn,
        name: o.name,
        onuType: o.onuType,
        online: o.online,
        oltName: oltNames.get(o.oltId) ?? '',
        acsVersion: hit?.version ?? null,
        canUpgrade: skip == null && o.online,
        skipReason: skip
          ? firmwareUpgradeSkipLabel(skip)
          : o.online
            ? null
            : 'Fuera de línea',
      };
    });
    targets.sort((a, b) => (a.sn ?? '').localeCompare(b.sn ?? ''));
    return {
      image: this.toDto(image),
      targets,
      onlineCount: targets.filter((t) => t.online).length,
    };
  }

  async upgrade(
    user: AuthUser,
    imageId: string,
    body: { onuId?: string; allOnlineOfModel?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const image = await this.loadImage(schema, imageId);
    if (!body.onuId && !body.allOnlineOfModel) {
      throw new BadRequestException('Indica onuId o allOnlineOfModel');
    }
    if (body.onuId && body.allOnlineOfModel) {
      throw new BadRequestException('Usa onuId o allOnlineOfModel, no ambos');
    }

    if (!image.genieFileId) {
      await this.registerOnAcs(schema, image);
    }
    if (!image.genieFileId) {
      throw new BadRequestException(
        'La imagen no está en GenieACS. Revisa ACS y vuelve a subir o reintentar.',
      );
    }

    const onuRepo = await this.tenants.getOnuRepository(schema);
    let onus: Onu[];
    if (body.onuId) {
      const one = await onuRepo.findOne({ where: { id: body.onuId } });
      if (!one) throw new NotFoundException('ONU no encontrada');
      if (!firmwareModelMatches(image.modelKey, one.onuType)) {
        throw new BadRequestException(
          `La ONU no es del modelo ${image.modelKey}`,
        );
      }
      onus = [one];
    } else {
      onus = (await onuRepo.find()).filter(
        (o) => o.online && firmwareModelMatches(image.modelKey, o.onuType),
      );
    }

    const results: Array<{
      onuId: string;
      sn: string | null;
      ok: boolean;
      message: string;
    }> = [];
    const client = this.acs();
    const actor = this.audit.actorFromUser(user);

    for (const onu of onus) {
      const started = Date.now();
      const sn = onu.sn?.trim() || null;
      try {
        const device = sn ? await client.findBySerial(sn) : null;
        const deviceId =
          typeof device?._id === 'string' ? device._id : null;
        const skip = firmwareUpgradeSkipReason({
          sn,
          acsDeviceId: deviceId,
          genieFileId: image.genieFileId,
        });
        if (skip) {
          const message = firmwareUpgradeSkipLabel(skip);
          results.push({ onuId: onu.id, sn, ok: false, message });
          await this.audit.record(schema, {
            action: 'firmware_upgrade',
            ok: false,
            durationMs: Date.now() - started,
            sn,
            onuId: onu.id,
            oltId: onu.oltId,
            onuIf: onu.onuIf,
            detail: {
              reason: skip,
              imageId: image.id,
              version: image.version,
              modelKey: image.modelKey,
            },
            ...actor,
          });
          if (body.onuId) throw new BadRequestException(message);
          continue;
        }
        await client.enqueueTask(
          deviceId!,
          { name: 'download', file: image.genieFileId },
          { connectionRequest: true, timeoutMs: 8_000 },
        );
        await this.audit.record(schema, {
          action: 'firmware_upgrade',
          ok: true,
          durationMs: Date.now() - started,
          sn,
          onuId: onu.id,
          oltId: onu.oltId,
          onuIf: onu.onuIf,
          detail: {
            imageId: image.id,
            version: image.version,
            modelKey: image.modelKey,
            genieFileId: image.genieFileId,
          },
          ...actor,
        });
        results.push({
          onuId: onu.id,
          sn,
          ok: true,
          message: `Tarea Download encolada (${image.version})`,
        });
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        const message = err instanceof Error ? err.message : String(err);
        results.push({ onuId: onu.id, sn, ok: false, message });
        await this.audit.record(schema, {
          action: 'firmware_upgrade',
          ok: false,
          durationMs: Date.now() - started,
          sn,
          onuId: onu.id,
          oltId: onu.oltId,
          onuIf: onu.onuIf,
          detail: {
            error: message,
            imageId: image.id,
            version: image.version,
          },
          ...actor,
        });
        if (body.onuId) throw new BadRequestException(message);
      }
    }

    const queued = results.filter((r) => r.ok).length;
    return {
      image: this.toDto(image),
      queued,
      failed: results.length - queued,
      results,
    };
  }

  private async loadImage(
    schema: string,
    id: string,
  ): Promise<OnuFirmwareImage> {
    const repo = await this.tenants.getOnuFirmwareImageRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Imagen de firmware no encontrada');
    return row;
  }

  private acsFileName(schema: string, row: OnuFirmwareImage): string {
    const ext = path.extname(row.fileName) || '.bin';
    const safe = schema.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24);
    return `isp-fw-${safe}-${row.id}${ext}`;
  }

  private async registerOnAcs(
    schema: string,
    row: OnuFirmwareImage,
  ): Promise<void> {
    if (!row.filePath) return;
    try {
      await fs.access(row.filePath);
    } catch {
      return;
    }
    const fileName = this.acsFileName(schema, row);
    try {
      const body = await fs.readFile(row.filePath);
      await this.acs().putFile(fileName, body, {
        fileType: ACS_FILE_TYPE,
        productClass: row.modelKey,
        version: row.version,
      });
      row.genieFileId = fileName;
      const repo = await this.tenants.getOnuFirmwareImageRepository(schema);
      await repo.save(row);
    } catch (err) {
      this.logger.warn(
        `GenieACS PUT firmware ${row.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async oltNames(
    schema: string,
    onus: Onu[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(onus.map((o) => o.oltId))];
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const repo = await this.tenants.getNetworkDeviceRepository(schema);
    const olts = await repo.find({
      where: { id: In(ids) },
      select: ['id', 'name'],
    });
    for (const olt of olts) map.set(olt.id, olt.name);
    return map;
  }

  private async acsBySerial(
    onus: Onu[],
  ): Promise<Map<string, { id: string; version: string | null }>> {
    const out = new Map<string, { id: string; version: string | null }>();
    const sns = onus
      .map((o) => o.sn?.trim())
      .filter((s): s is string => Boolean(s));
    if (!sns.length) return out;
    try {
      const devices = await this.acs().findDevices(
        {},
        {
          projection:
            '_id,InternetGatewayDevice.DeviceInfo.SoftwareVersion,Device.DeviceInfo.SoftwareVersion',
        },
      );
      for (const sn of sns) {
        const device = devices.find((d) =>
          deviceIdMatchesSerial(typeof d._id === 'string' ? d._id : '', sn),
        );
        if (!device || typeof device._id !== 'string') continue;
        const version =
          strVal(
            genieGet(
              device,
              'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
            ),
          ) ?? strVal(genieGet(device, 'Device.DeviceInfo.SoftwareVersion'));
        out.set(sn.toUpperCase(), { id: device._id, version });
      }
    } catch (err) {
      this.logger.debug(
        `firmware ACS scan: ${err instanceof Error ? err.message : err}`,
      );
    }
    return out;
  }
}
