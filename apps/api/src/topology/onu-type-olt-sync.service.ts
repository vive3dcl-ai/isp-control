import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { OnuCatalogItem } from './entities/onu-catalog.entity';
import type { NetworkDevice } from './entities/network-device.entity';
import { OnuCatalogAdminService } from './onu-catalog-admin.service';
import { inferOnuVendor, normalizeOnuModelName } from './onu-model-catalog';
import { ZteOltClient } from './zte-olt.client';
import { HuaweiOltClient } from './huawei-olt.client';
import {
  VENDOR_PROBE_ORDER,
  vendorFromSn,
  type OnuTypeProfileSpec,
  type OnuVendorKind,
} from './zte-olt-onu-type.util';
import {
  DEFAULT_OLT_PORTS,
  isHuaweiOltDevice,
  isManagedOltDevice,
} from './olt.constants';

export type OnuTypeSyncStep = {
  step: string;
  status: 'ok' | 'skip' | 'fail' | 'info';
  message: string;
  typeName?: string;
};

export type AuthorizeProbeStep = {
  step:
    | 'sync_types'
    | 'ensure_type'
    | 'try_type'
    | 'sw_info'
    | 'create_real_type'
    | 'done';
  status: 'ok' | 'fail' | 'skip' | 'info';
  message: string;
  typeName?: string;
  model?: string;
};

@Injectable()
export class OnuTypeOltSyncService {
  private readonly logger = new Logger(OnuTypeOltSyncService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly zteOlt: ZteOltClient,
    private readonly huaweiOlt: HuaweiOltClient,
    private readonly onuCatalog: OnuCatalogAdminService,
    @InjectRepository(OnuCatalogItem)
    private readonly catalogRepo: Repository<OnuCatalogItem>,
  ) {}

  private oltCli(device: NetworkDevice) {
    return isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiOlt
      : this.zteOlt;
  }

  private zteConn(device: NetworkDevice) {
    const protocol: 'telnet' | 'ssh' =
      device.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const port =
      device.mgmtPort ??
      (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);
    return {
      host: device.mgmtHost!,
      port,
      protocol,
      username: device.mgmtUsername!,
      password: device.mgmtPassword!,
    };
  }

  /**
   * After OLT connects: pull OLT types into catalog/tenant, push missing
   * approved catalog profiles onto the OLT.
   */
  async syncTypesForConnectedOlt(
    schema: string,
    device: NetworkDevice,
  ): Promise<{ ok: boolean; steps: OnuTypeSyncStep[]; error?: string }> {
    const steps: OnuTypeSyncStep[] = [];
    if (!device.mgmtHost || !device.mgmtUsername || !device.mgmtPassword) {
      return {
        ok: false,
        steps,
        error: 'OLT sin credenciales',
      };
    }

    try {
      if (!isManagedOltDevice(device.type, device.subtype)) {
        return {
          ok: false,
          steps,
          error: 'OLT no gestionada (ZTE/Huawei)',
        };
      }
      const listed = await this.oltCli(device).listOnuTypes(
        this.zteConn(device),
      );
      if (!listed.ok) {
        return {
          ok: false,
          steps,
          error: listed.error || 'No se pudo leer onu-type de la OLT',
        };
      }

      steps.push({
        step: 'read_olt',
        status: 'ok',
        message: `${listed.types.length} type(s) en la OLT`,
      });

      const onOlt = new Set(listed.types.map((t) => t.name.toLowerCase()));

      // OLT → admin catalog only (do NOT flood tenant types list)
      let imported = 0;
      for (const t of listed.types) {
        const item = await this.onuCatalog.ensureModelSeen(schema, t.name, {
          syncToTenant: false,
        });
        if (item) imported += 1;
      }
      steps.push({
        step: 'import_type',
        status: 'ok',
        message: `${imported} type(s) sincronizados a catálogo admin (sin agregar a la lista del tenant)`,
      });

      // Tenant types → OLT (solo los que el ISP tiene en Ajustes → ONUs)
      const typeRepo =
        await this.tenantConnections.getOnuTypeRepository(schema);
      const tenantTypes = await typeRepo.find();
      for (const t of tenantTypes) {
        const name = normalizeOnuModelName(t.name);
        if (!name || onOlt.has(name.toLowerCase())) continue;
        const created = await this.oltCli(device).ensureOnuTypeOnOlt({
          ...this.zteConn(device),
          spec: this.specFromTenant(t),
        });
        if (created.ok) {
          onOlt.add(name.toLowerCase());
          steps.push({
            step: 'push_type',
            status: 'ok',
            message: created.created
              ? `Perfil tenant «${name}» cargado en la OLT`
              : `Perfil «${name}» ya en OLT`,
            typeName: name,
          });
        } else {
          steps.push({
            step: 'push_type',
            status: 'fail',
            message: created.error || `No se pudo cargar «${name}»`,
            typeName: name,
          });
        }
      }

      // Approved catalog → OLT silently (no copy into tenant type list)
      const approved = await this.catalogRepo.find({
        where: { isActive: true, registrationStatus: 'approved' },
      });
      let pushed = 0;
      const MAX_CATALOG_PUSH = 20;
      for (const item of approved) {
        const name = normalizeOnuModelName(item.name);
        if (!name) continue;
        if (onOlt.has(name.toLowerCase())) continue;
        if (pushed >= MAX_CATALOG_PUSH) {
          steps.push({
            step: 'push_type',
            status: 'skip',
            message: `Límite de ${MAX_CATALOG_PUSH} perfiles nuevos por sync; el resto se cargará al autorizar`,
          });
          break;
        }
        const created = await this.oltCli(device).ensureOnuTypeOnOlt({
          ...this.zteConn(device),
          spec: this.specFromCatalog(item),
        });
        if (created.ok) {
          onOlt.add(name.toLowerCase());
          if (created.created) pushed += 1;
          steps.push({
            step: 'push_type',
            status: 'ok',
            message: created.created
              ? `Perfil catálogo «${name}» cargado en la OLT`
              : `Perfil «${name}» ya en OLT`,
            typeName: name,
          });
        } else {
          steps.push({
            step: 'push_type',
            status: 'fail',
            message: created.error || `No se pudo cargar «${name}»`,
            typeName: name,
          });
          this.logger.warn(
            `Push onu-type ${name} → ${device.name}: ${created.error}`,
          );
        }
      }

      return { ok: true, steps };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`syncTypesForConnectedOlt ${device.name}: ${message}`);
      return { ok: false, steps, error: message };
    }
  }

  private specFromCatalog(item: OnuCatalogItem): OnuTypeProfileSpec {
    return {
      name: normalizeOnuModelName(item.name),
      ponType: item.ponType === 'epon' ? 'epon' : 'gpon',
      description: item.note || null,
      ethernetPorts: item.ethernetPorts || 1,
      wifiSsids: item.wifiSsids || 0,
      voipPorts: item.voipPorts || 0,
      catv: !!item.catv,
    };
  }

  private specFromTenant(row: {
    name: string;
    ponType: string;
    ethernetPorts: number;
    wifiSsids: number;
    voipPorts: number;
    catv: boolean;
  }): OnuTypeProfileSpec {
    return {
      name: normalizeOnuModelName(row.name),
      ponType: row.ponType === 'epon' ? 'epon' : 'gpon',
      ethernetPorts: row.ethernetPorts || 1,
      wifiSsids: row.wifiSsids || 0,
      voipPorts: row.voipPorts || 0,
      catv: !!row.catv,
    };
  }

  /** Build ordered candidate type names for authorize probe. */
  async buildAuthorizeCandidates(
    schema: string,
    sn: string,
    ponType: 'gpon' | 'epon',
    preferredType?: string | null,
  ): Promise<
    Array<{ name: string; vendor: OnuVendorKind; spec: OnuTypeProfileSpec }>
  > {
    const snVendor = vendorFromSn(sn);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const tenantTypes = await typeRepo.find();
    const approved = await this.catalogRepo.find({
      where: { isActive: true, registrationStatus: 'approved' },
    });

    const byName = new Map<
      string,
      { name: string; vendor: OnuVendorKind; spec: OnuTypeProfileSpec }
    >();

    const add = (nameRaw: string, vendor: string, spec: OnuTypeProfileSpec) => {
      const name = normalizeOnuModelName(nameRaw);
      if (!name) return;
      if (
        spec.ponType !== ponType &&
        ponType === 'gpon' &&
        spec.ponType === 'epon'
      )
        return;
      const key = name.toLowerCase();
      if (byName.has(key)) return;
      const v = (vendor as OnuVendorKind) || inferOnuVendor(name);
      byName.set(key, {
        name,
        vendor:
          v === 'huawei' || v === 'zte' || v === 'fiberhome' ? v : 'other',
        spec: { ...spec, name, ponType },
      });
    };

    for (const t of tenantTypes) {
      if (t.ponType && t.ponType !== ponType) continue;
      add(t.name, t.vendor, this.specFromTenant(t));
    }
    // Catalog approved — used silently if tenant list is small / missing model
    for (const c of approved) {
      add(c.name, c.vendor, this.specFromCatalog(c));
    }

    const all = [...byName.values()];
    const preferred = preferredType ? normalizeOnuModelName(preferredType) : '';

    const vendorOrder: OnuVendorKind[] =
      snVendor === 'other'
        ? [...VENDOR_PROBE_ORDER]
        : [snVendor, ...VENDOR_PROBE_ORDER.filter((v) => v !== snVendor)];

    const ordered: typeof all = [];
    const used = new Set<string>();
    const tenantNames = new Set(
      tenantTypes.map((t) => normalizeOnuModelName(t.name).toLowerCase()),
    );

    if (preferred) {
      const hit = all.find(
        (a) => a.name.toLowerCase() === preferred.toLowerCase(),
      );
      if (hit) {
        ordered.push(hit);
        used.add(hit.name.toLowerCase());
      } else {
        ordered.push({
          name: preferred,
          vendor: snVendor,
          spec: {
            name: preferred,
            ponType,
            ethernetPorts: 4,
            wifiSsids: 0,
            voipPorts: 0,
            catv: false,
          },
        });
        used.add(preferred.toLowerCase());
      }
    }

    // Prefer tenant-managed types first, then catalog (silent)
    for (const preferTenant of [true, false]) {
      for (const v of vendorOrder) {
        for (const a of all) {
          if (a.vendor !== v) continue;
          if (used.has(a.name.toLowerCase())) continue;
          const isTenant = tenantNames.has(a.name.toLowerCase());
          if (preferTenant !== isTenant) continue;
          ordered.push(a);
          used.add(a.name.toLowerCase());
        }
      }
    }

    // Cap probes to keep CLI session reasonable
    return ordered.slice(0, 10);
  }

  async ensureTypeOnOlt(device: NetworkDevice, spec: OnuTypeProfileSpec) {
    return this.oltCli(device).ensureOnuTypeOnOlt({
      ...this.zteConn(device),
      spec,
    });
  }
}
