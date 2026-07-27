import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { OnuCatalogItem } from './entities/onu-catalog.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type { OnuProfile } from './entities/onu-profile.entity';
import {
  ONU_CATALOG_SEEDS,
  imageKeyForVendorCapability,
  inferOnuVendor,
  normalizeOnuModelName,
  resolveOnuImageUrl,
} from './onu-model-catalog';

export type UpsertOnuCatalogDto = {
  vendor: string;
  name: string;
  ponType: string;
  ethernetPorts?: number;
  wifiSsids?: number;
  voipPorts?: number;
  catv?: boolean;
  capability?: string;
  allowCustomProfiles?: boolean;
  defaultProfileCode?: string | null;
  imageKey?: string;
  note?: string;
  isActive?: boolean;
  registrationStatus?: 'approved' | 'pending';
};

const GENERIC_PROFILE_SEEDS = [
  {
    code: 'generic_1',
    name: 'Generic_1',
    description:
      'Bridge/SFU: etiqueta VLAN en el puerto Ethernet físico eth_0/1.',
    vlanCli: 'vlan port eth_0/1 mode tag',
    portKind: 'eth',
    sortOrder: 1,
  },
  {
    code: 'generic_2',
    name: 'Generic_2',
    description:
      'Bridge/SFU: VLAN sin etiqueta (untag) en eth_0/1 (acceso).',
    vlanCli: 'vlan port eth_0/1 mode untag',
    portKind: 'eth',
    sortOrder: 2,
  },
  {
    code: 'generic_3',
    name: 'Generic_3',
    description:
      'Multi-ETH: etiqueta VLAN en eth_0/2 (segundo puerto LAN).',
    vlanCli: 'vlan port eth_0/2 mode tag',
    portKind: 'eth',
    sortOrder: 3,
  },
  {
    code: 'generic_4',
    name: 'Generic_4',
    description: 'Híbrido en eth_0/1 (tag+untag según firmware).',
    vlanCli: 'vlan port eth_0/1 mode hybrid',
    portKind: 'eth',
    sortOrder: 4,
  },
  {
    code: 'generic_5',
    name: 'Generic_5',
    description:
      'HGU/router: VLAN untag vía interfaz virtual VEIP (veip_1).',
    vlanCli: 'vlan port veip_1 mode untag',
    portKind: 'veip',
    sortOrder: 5,
  },
  {
    code: 'generic_6',
    name: 'Generic_6',
    description:
      'HGU/router: VLAN tag vía VEIP — usa «vlan port veip_1 mode tag».',
    vlanCli: 'vlan port veip_1 mode tag',
    portKind: 'veip',
    sortOrder: 6,
  },
] as const;

@Injectable()
export class OnuCatalogAdminService {
  constructor(
    @InjectRepository(OnuCatalogItem)
    private readonly catalogRepo: Repository<OnuCatalogItem>,
    @InjectRepository(Tenant)
    private readonly tenantsRepo: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
  ) {}

  private serialize(row: OnuCatalogItem) {
    return {
      id: row.id,
      vendor: row.vendor,
      vendorLabel:
        row.vendor === 'zte'
          ? 'ZTE'
          : row.vendor === 'huawei'
            ? 'Huawei'
            : row.vendor,
      name: row.name,
      ponType: row.ponType,
      ponTypeLabel: row.ponType.toUpperCase(),
      ethernetPorts: row.ethernetPorts,
      wifiSsids: row.wifiSsids,
      voipPorts: row.voipPorts,
      catv: row.catv,
      capability: row.capability,
      capabilityLabel:
        row.capability === 'bridging' ? 'Bridging' : 'Bridging/Routing',
      allowCustomProfiles: row.allowCustomProfiles,
      defaultProfileCode: row.defaultProfileCode,
      imageKey: row.imageKey,
      imageUrl: resolveOnuImageUrl(row.imageKey),
      note: row.note,
      isActive: row.isActive,
      registrationStatus: row.registrationStatus ?? 'approved',
    };
  }

  /** Rename legacy Huawei-/ZTE- prefixed catalog names to model codes. */
  private async migrateLegacyModelNames() {
    const rows = await this.catalogRepo.find();
    for (const row of rows) {
      const next = normalizeOnuModelName(row.name);
      if (!next || next.toLowerCase() === row.name.toLowerCase()) continue;
      const dup = await this.catalogRepo.findOne({
        where: { name: ILike(next) },
      });
      if (dup && dup.id !== row.id) {
        await this.catalogRepo.remove(row);
      } else {
        row.name = next;
        if (!row.registrationStatus) row.registrationStatus = 'approved';
        await this.catalogRepo.save(row);
      }
    }
  }

  async ensureSeeded() {
    await this.migrateLegacyModelNames();
    const existing = await this.catalogRepo.find({ select: ['name'] });
    const have = new Set(
      existing.map((r) => normalizeOnuModelName(r.name).toLowerCase()),
    );
    let inserted = 0;
    for (const s of ONU_CATALOG_SEEDS) {
      const name = normalizeOnuModelName(s.name);
      if (have.has(name.toLowerCase())) continue;
      await this.catalogRepo.save(
        this.catalogRepo.create({
          vendor: s.vendor,
          name,
          ponType: s.ponType,
          ethernetPorts: s.ethernetPorts,
          wifiSsids: s.wifiSsids,
          voipPorts: s.voipPorts,
          catv: s.catv,
          capability: s.capability,
          allowCustomProfiles: s.allowCustomProfiles,
          defaultProfileCode: s.defaultProfileCode,
          imageKey: s.imageKey,
          note: s.note ?? '',
          isActive: true,
          registrationStatus: 'approved',
        }),
      );
      have.add(name.toLowerCase());
      inserted += 1;
    }
    const count = await this.catalogRepo.count();
    return { seeded: inserted > 0, inserted, count };
  }

  async list() {
    const seed = await this.ensureSeeded();
    // Do not dump the full catalog into every tenant on seed.
    const rows = await this.catalogRepo.find({
      order: { registrationStatus: 'DESC', vendor: 'ASC', name: 'ASC' },
    });
    return { items: rows.map((r) => this.serialize(r)), ...seed };
  }

  async create(dto: UpsertOnuCatalogDto) {
    await this.ensureSeeded();
    const name = normalizeOnuModelName(dto.name ?? '');
    if (!name) throw new BadRequestException('Modelo requerido');
    if (!dto.vendor?.trim()) {
      throw new BadRequestException('Fabricante requerido');
    }
    if (!['gpon', 'epon'].includes(dto.ponType)) {
      throw new BadRequestException('Tipo PON inválido');
    }
    const dup = await this.catalogRepo.findOne({
      where: { name: ILike(name) },
    });
    if (dup) {
      throw new BadRequestException(`Ya existe «${name}» en el catálogo`);
    }
    const capability = dto.capability ?? 'bridging_routing';
    const vendor = dto.vendor.trim().toLowerCase();
    const imageKey =
      dto.imageKey?.trim() ||
      imageKeyForVendorCapability(vendor, capability);
    const row = await this.catalogRepo.save(
      this.catalogRepo.create({
        vendor,
        name,
        ponType: dto.ponType,
        ethernetPorts: dto.ethernetPorts ?? 1,
        wifiSsids: dto.wifiSsids ?? 0,
        voipPorts: dto.voipPorts ?? 0,
        catv: dto.catv ?? false,
        capability,
        allowCustomProfiles: dto.allowCustomProfiles ?? true,
        defaultProfileCode: dto.defaultProfileCode ?? null,
        imageKey,
        note: dto.note ?? '',
        isActive: dto.isActive ?? true,
        registrationStatus: dto.registrationStatus ?? 'approved',
      }),
    );
    // Approved models are available when tenants detect them — do not push to all.
    if (row.registrationStatus === 'approved') {
      await this.enrichTenantsThatHaveModel(name);
    }
    return this.serialize(row);
  }

  async update(id: string, dto: Partial<UpsertOnuCatalogDto>) {
    const row = await this.catalogRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Modelo no encontrado');
    if (dto.name !== undefined) {
      const name = normalizeOnuModelName(dto.name);
      if (!name) throw new BadRequestException('Modelo requerido');
      const dup = await this.catalogRepo.findOne({
        where: { name: ILike(name) },
      });
      if (dup && dup.id !== id) {
        throw new BadRequestException(`Ya existe «${name}» en el catálogo`);
      }
      row.name = name;
    }
    if (dto.vendor !== undefined) row.vendor = dto.vendor.trim().toLowerCase();
    if (dto.ponType !== undefined) row.ponType = dto.ponType;
    if (dto.ethernetPorts !== undefined) row.ethernetPorts = dto.ethernetPorts;
    if (dto.wifiSsids !== undefined) row.wifiSsids = dto.wifiSsids;
    if (dto.voipPorts !== undefined) row.voipPorts = dto.voipPorts;
    if (dto.catv !== undefined) row.catv = dto.catv;
    if (dto.capability !== undefined) row.capability = dto.capability;
    if (dto.allowCustomProfiles !== undefined) {
      row.allowCustomProfiles = dto.allowCustomProfiles;
    }
    if (dto.defaultProfileCode !== undefined) {
      row.defaultProfileCode = dto.defaultProfileCode;
    }
    if (dto.imageKey !== undefined && dto.imageKey.trim()) {
      row.imageKey = dto.imageKey.trim();
    } else if (dto.vendor !== undefined || dto.capability !== undefined) {
      row.imageKey = imageKeyForVendorCapability(row.vendor, row.capability);
    }
    if (dto.note !== undefined) row.note = dto.note;
    if (dto.isActive !== undefined) row.isActive = dto.isActive;
    if (dto.registrationStatus !== undefined) {
      row.registrationStatus = dto.registrationStatus;
    }
    await this.catalogRepo.save(row);
    // Refresh specs only for tenants that already have this model.
    if (row.registrationStatus === 'approved') {
      await this.enrichTenantsThatHaveModel(row.name);
    }
    return this.serialize(row);
  }

  async approve(id: string) {
    return this.update(id, { registrationStatus: 'approved', isActive: true });
  }

  async remove(id: string) {
    const row = await this.catalogRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Modelo no encontrado');
    await this.catalogRepo.remove(row);
    return { ok: true };
  }

  /**
   * Refresh approved catalog specs into tenants that already have the model.
   * Does NOT add models to tenants that never detected/created them.
   */
  async propagateToAllTenants() {
    const tenants = await this.tenantsRepo.find();
    let synced = 0;
    for (const t of tenants) {
      if (!t.schemaName) continue;
      try {
        await this.enrichTenantExistingTypes(t.schemaName);
        synced += 1;
      } catch {
        /* ignore broken schemas */
      }
    }
    return { synced };
  }

  async enrichTenantsThatHaveModel(modelName: string) {
    const name = normalizeOnuModelName(modelName);
    if (!name) return;
    const item = await this.findCatalogByModel(name);
    if (!item || item.registrationStatus !== 'approved') return;
    const tenants = await this.tenantsRepo.find();
    for (const t of tenants) {
      if (!t.schemaName) continue;
      try {
        const typeRepo =
          await this.tenantConnections.getOnuTypeRepository(t.schemaName);
        const existing = await typeRepo.find();
        const has = existing.some(
          (r) =>
            normalizeOnuModelName(r.name).toLowerCase() === name.toLowerCase(),
        );
        if (has) await this.ensureCatalogItemInTenant(t.schemaName, item);
      } catch {
        /* ignore */
      }
    }
  }

  /** Approved + active models only. */
  async listActiveCatalog(): Promise<OnuCatalogItem[]> {
    await this.ensureSeeded();
    return this.catalogRepo.find({
      where: { isActive: true, registrationStatus: 'approved' },
      order: { vendor: 'ASC', name: 'ASC' },
    });
  }

  /** Lookup catalog row by model name (no create). */
  async getByModelName(raw: string): Promise<OnuCatalogItem | null> {
    await this.ensureSeeded();
    return this.findCatalogByModel(raw);
  }

  private async findCatalogByModel(
    raw: string,
  ): Promise<OnuCatalogItem | null> {
    const name = normalizeOnuModelName(raw);
    if (!name) return null;
    const direct = await this.catalogRepo.findOne({
      where: { name: ILike(name) },
    });
    if (direct) return direct;
    // Legacy rows that still have vendor prefix
    const prefixed = await this.catalogRepo.findOne({
      where: [
        { name: ILike(`Huawei-${name}`) },
        { name: ILike(`ZTE-${name}`) },
      ],
    });
    return prefixed;
  }

  private async ensureTenantProfiles(
    schemaName: string,
  ): Promise<Map<string, OnuProfile>> {
    const profileRepo =
      await this.tenantConnections.getOnuProfileRepository(schemaName);
    const existing = await profileRepo.find();
    const byCode = new Map(existing.map((p) => [p.code, p]));
    for (const seed of GENERIC_PROFILE_SEEDS) {
      if (byCode.has(seed.code)) continue;
      const row = await profileRepo.save(
        profileRepo.create({
          code: seed.code,
          name: seed.name,
          description: seed.description,
          vlanCli: seed.vlanCli,
          portKind: seed.portKind,
          sortOrder: seed.sortOrder,
          isSystem: true,
        }),
      );
      byCode.set(seed.code, row);
    }
    return byCode;
  }

  /**
   * Remove leftover catalog-dump types that were never seen on this tenant's
   * ONUs. Keeps: types with onuCount>0, and types not in approved catalog
   * (manual / pending feedback).
   */
  /**
   * Drop tenant types never shown in the user list (sync leftovers).
   * Keeps: listed=true (registered/manual) — even with 0 ONUs until user deletes.
   */
  async pruneUndetectedCatalogTypes(
    schemaName: string,
  ): Promise<{ removed: number }> {
    await this.tenantConnections.ensureTenantSchema(schemaName);
    const typeRepo =
      await this.tenantConnections.getOnuTypeRepository(schemaName);
    await this.markListedFromConnectedOnus(schemaName);

    const types = await typeRepo.find();
    let removed = 0;
    for (const t of types) {
      if (t.listed) continue;
      await typeRepo.remove(t);
      removed += 1;
    }
    return { removed };
  }

  /** Mark tenant types as listed when at least one ONU uses that model. */
  async markListedFromConnectedOnus(schemaName: string): Promise<number> {
    const typeRepo =
      await this.tenantConnections.getOnuTypeRepository(schemaName);
    const counts = await this.countOnusByModel(schemaName);
    const types = await typeRepo.find();
    let updated = 0;
    for (const t of types) {
      const key = normalizeOnuModelName(t.name).toLowerCase();
      if (!t.listed && counts.get(key)) {
        t.listed = true;
        await typeRepo.save(t);
        updated += 1;
      }
    }
    return updated;
  }

  /**
   * Count imported ONUs per normalized model code for a tenant.
   */
  async countOnusByModel(
    schemaName: string,
  ): Promise<Map<string, number>> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schemaName);
    const onus = await onuRepo.find({ select: ['onuType'] });
    const counts = new Map<string, number>();
    for (const o of onus) {
      const n = normalizeOnuModelName(o.onuType ?? '').toLowerCase();
      if (!n) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Collapse Huawei-/ZTE- prefixed duplicates into model codes only.
   * Keeps one row per normalized name (prefers already-clean name).
   */
  async dedupeTenantModelNames(schemaName: string): Promise<{ removed: number }> {
    await this.tenantConnections.ensureTenantSchema(schemaName);
    const typeRepo =
      await this.tenantConnections.getOnuTypeRepository(schemaName);
    const rows = await typeRepo.find({ order: { updatedAt: 'DESC' } });
    const byNorm = new Map<string, typeof rows>();
    for (const row of rows) {
      const norm = normalizeOnuModelName(row.name).toLowerCase();
      if (!norm) continue;
      const list = byNorm.get(norm) ?? [];
      list.push(row);
      byNorm.set(norm, list);
    }

    let removed = 0;
    for (const [, group] of byNorm) {
      if (group.length === 0) continue;
      // Prefer row whose name is already the code (no vendor prefix).
      const preferred =
        group.find(
          (r) =>
            normalizeOnuModelName(r.name).toLowerCase() ===
            r.name.trim().toLowerCase(),
        ) ?? group[0];
      const keepName = normalizeOnuModelName(preferred.name);
      if (preferred.name !== keepName) {
        preferred.name = keepName;
        await typeRepo.save(preferred);
      }
      for (const row of group) {
        if (row.id === preferred.id) continue;
        await typeRepo.remove(row);
        removed += 1;
      }
    }
    return { removed };
  }

  async ensureCatalogItemInTenant(
    schemaName: string,
    item: OnuCatalogItem,
    opts?: { listed?: boolean },
  ) {
    await this.tenantConnections.ensureTenantSchema(schemaName);
    const profileByCode = await this.ensureTenantProfiles(schemaName);
    const typeRepo =
      await this.tenantConnections.getOnuTypeRepository(schemaName);
    const name = normalizeOnuModelName(item.name);
    const existingTypes = await typeRepo.find();
    const byName = new Map(
      existingTypes.map((t) => [
        normalizeOnuModelName(t.name).toLowerCase(),
        t,
      ]),
    );

    const imageUrl = resolveOnuImageUrl(item.imageKey);
    const defaultProfile = item.defaultProfileCode
      ? profileByCode.get(item.defaultProfileCode)
      : null;
    const markListed = opts?.listed === true;
    const found = byName.get(name.toLowerCase());
    if (!found) {
      const row = typeRepo.create({
        ponType: item.ponType,
        channel: item.ponType === 'epon' ? 'E' : 'G',
        channelGpon: item.ponType === 'gpon',
        channelXgpon: false,
        channelXgspon: false,
        name,
        vendor: item.vendor,
        fromCatalog: true,
        listed: markListed,
        ethernetPorts: item.ethernetPorts,
        wifiSsids: item.wifiSsids,
        voipPorts: item.voipPorts,
        catv: item.catv,
        allowCustomProfiles: item.allowCustomProfiles,
        defaultProfileId: defaultProfile?.id ?? null,
        capability: item.capability,
        useDefaultImage: true,
        imageUrl,
      });
      await typeRepo.save(row);
      return row;
    }
    if (found.fromCatalog || item.registrationStatus === 'pending') {
      found.name = name;
      found.vendor = item.vendor;
      found.ponType = item.ponType;
      found.channel = item.ponType === 'epon' ? 'E' : 'G';
      found.ethernetPorts = item.ethernetPorts;
      found.wifiSsids = item.wifiSsids;
      found.voipPorts = item.voipPorts;
      found.catv = item.catv;
      found.capability = item.capability;
      found.allowCustomProfiles = item.allowCustomProfiles;
      found.defaultProfileId = defaultProfile?.id ?? found.defaultProfileId;
      found.imageUrl = imageUrl;
      found.useDefaultImage = true;
      found.fromCatalog = true;
    }
    if (markListed) found.listed = true;
    await typeRepo.save(found);
    return found;
  }

  /**
   * When an ONU model is seen on an OLT / SW info:
   * - ensure pending/approved row in admin catalog
   * - optionally copy into tenant types (default true for authorize/import ONU;
   *   false on OLT type-sync so Autorizar list stays only user-managed types)
   */
  async ensureModelSeen(
    schemaName: string,
    rawType: string | null | undefined,
    opts?: { syncToTenant?: boolean },
  ): Promise<OnuCatalogItem | null> {
    const name = normalizeOnuModelName(rawType ?? '');
    if (!name) return null;
    await this.ensureSeeded();

    let item = await this.findCatalogByModel(name);
    if (!item) {
      const vendor = inferOnuVendor(name);
      const capability = 'bridging_routing';
      item = await this.catalogRepo.save(
        this.catalogRepo.create({
          vendor,
          name,
          ponType: 'gpon',
          ethernetPorts: 1,
          wifiSsids: 0,
          voipPorts: 0,
          catv: false,
          capability,
          allowCustomProfiles: true,
          defaultProfileCode: 'generic_6',
          imageKey: imageKeyForVendorCapability(vendor, capability),
          note: 'Detectado automáticamente desde OLT — pendiente de registro',
          isActive: true,
          registrationStatus: 'pending',
        }),
      );
    } else if (normalizeOnuModelName(item.name) !== item.name) {
      item.name = normalizeOnuModelName(item.name);
      await this.catalogRepo.save(item);
    }

    const syncToTenant = opts?.syncToTenant !== false;
    if (syncToTenant) {
      await this.dedupeTenantModelNames(schemaName);
      await this.ensureCatalogItemInTenant(schemaName, item, { listed: true });
    }
    return item;
  }

  /**
   * Tenant manually created a type: keep it local and register pending in
   * admin catalog (unless already approved — then reuse catalog specs).
   */
  async registerTenantCreatedType(opts: {
    schemaName: string;
    name: string;
    vendor?: string;
    ponType: string;
    ethernetPorts: number;
    wifiSsids: number;
    voipPorts: number;
    catv: boolean;
    capability: string;
    allowCustomProfiles: boolean;
    defaultProfileCode?: string | null;
  }): Promise<OnuCatalogItem> {
    await this.ensureSeeded();
    const name = normalizeOnuModelName(opts.name);
    if (!name) throw new BadRequestException('Modelo requerido');

    let item = await this.findCatalogByModel(name);
    if (item?.registrationStatus === 'approved') {
      await this.ensureCatalogItemInTenant(opts.schemaName, item, {
        listed: true,
      });
      return item;
    }

    const vendor =
      opts.vendor?.trim().toLowerCase() || inferOnuVendor(name);
    const capability = opts.capability || 'bridging_routing';
    const imageKey = imageKeyForVendorCapability(vendor, capability);

    if (!item) {
      item = await this.catalogRepo.save(
        this.catalogRepo.create({
          vendor,
          name,
          ponType: opts.ponType === 'epon' ? 'epon' : 'gpon',
          ethernetPorts: opts.ethernetPorts,
          wifiSsids: opts.wifiSsids,
          voipPorts: opts.voipPorts,
          catv: opts.catv,
          capability,
          allowCustomProfiles: opts.allowCustomProfiles,
          defaultProfileCode: opts.defaultProfileCode ?? 'generic_6',
          imageKey,
          note: 'Creado por un tenant — pendiente de registro',
          isActive: true,
          registrationStatus: 'pending',
        }),
      );
    } else {
      // Refresh pending draft with tenant-provided specs for admin review.
      item.vendor = vendor;
      item.ponType = opts.ponType === 'epon' ? 'epon' : 'gpon';
      item.ethernetPorts = opts.ethernetPorts;
      item.wifiSsids = opts.wifiSsids;
      item.voipPorts = opts.voipPorts;
      item.catv = opts.catv;
      item.capability = capability;
      item.allowCustomProfiles = opts.allowCustomProfiles;
      if (opts.defaultProfileCode !== undefined) {
        item.defaultProfileCode = opts.defaultProfileCode;
      }
      item.imageKey = imageKey;
      await this.catalogRepo.save(item);
    }
    return item;
  }

  /** Update specs for types the tenant already has (approved catalog only). */
  async enrichTenantExistingTypes(schemaName: string) {
    await this.tenantConnections.ensureTenantSchema(schemaName);
    const typeRepo =
      await this.tenantConnections.getOnuTypeRepository(schemaName);
    const types = await typeRepo.find();
    for (const t of types) {
      const item = await this.findCatalogByModel(t.name);
      if (!item || item.registrationStatus !== 'approved' || !item.isActive) {
        continue;
      }
      await this.ensureCatalogItemInTenant(schemaName, item);
    }
  }

  /** @deprecated Prefer enrichTenantExistingTypes — never dump full catalog. */
  async syncCatalogIntoTenant(schemaName: string) {
    return this.enrichTenantExistingTypes(schemaName);
  }
}
