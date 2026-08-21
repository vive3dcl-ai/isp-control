import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import type { OnuProfile } from '../shared/entities/onu-profile.entity';
import type { OnuType } from '../shared/entities/onu-type.entity';
import {
  CreateOnuTypeDto,
  UpdateOnuProfileDto,
  UpdateOnuTypeDto,
} from '../shared/dto/onu-settings.dto';
import { OnuCatalogAdminService } from './onu-catalog-admin.service';
import {
  imageKeyForVendorCapability,
  inferOnuVendor,
  isCustomOnuImageUrl,
  isPlaceholderOnuModel,
  normalizeOnuModelName,
  resolveOnuImageUrl,
  resolveOnuTypeDisplayImage,
  sanitizeOnuImageInput,
} from './onu-model-catalog';
import { resolveOnuDriverForModel } from '../../drivers/onu';

const GENERIC_SEEDS: Array<{
  code: string;
  name: string;
  description: string;
  vlanCli: string;
  portKind: 'eth' | 'veip';
  sortOrder: number;
}> = [
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
    description: 'Bridge/SFU: VLAN sin etiqueta (untag) en eth_0/1 (acceso).',
    vlanCli: 'vlan port eth_0/1 mode untag',
    portKind: 'eth',
    sortOrder: 2,
  },
  {
    code: 'generic_3',
    name: 'Generic_3',
    description: 'Multi-ETH: etiqueta VLAN en eth_0/2 (segundo puerto LAN).',
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
    description: 'HGU/router: VLAN untag vía interfaz virtual VEIP (veip_1).',
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
];

@Injectable()
export class OnuSettingsService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly onuCatalog: OnuCatalogAdminService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private async ensureGenericProfiles(schema: string): Promise<OnuProfile[]> {
    const repo = await this.tenantConnections.getOnuProfileRepository(schema);
    const existing = await repo.find({ order: { sortOrder: 'ASC' } });
    const byCode = new Map(existing.map((p) => [p.code, p]));
    let created = false;
    for (const seed of GENERIC_SEEDS) {
      if (byCode.has(seed.code)) continue;
      const row = repo.create({
        code: seed.code,
        name: seed.name,
        description: seed.description,
        vlanCli: seed.vlanCli,
        portKind: seed.portKind,
        sortOrder: seed.sortOrder,
        isSystem: true,
      });
      await repo.save(row);
      created = true;
    }
    if (created) return repo.find({ order: { sortOrder: 'ASC' } });
    return existing;
  }

  async listProfiles(user: AuthUser) {
    const schema = this.requireSchema(user);
    const profiles = await this.ensureGenericProfiles(schema);
    return {
      profiles: profiles.map((p) => this.serializeProfile(p)),
    };
  }

  async updateProfile(user: AuthUser, id: string, dto: UpdateOnuProfileDto) {
    const schema = this.requireSchema(user);
    const repo = await this.tenantConnections.getOnuProfileRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Perfil no encontrado');
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.description !== undefined) row.description = dto.description;
    if (dto.vlanCli !== undefined) row.vlanCli = dto.vlanCli.trim();
    if (dto.portKind !== undefined) row.portKind = dto.portKind;
    await repo.save(row);
    return this.serializeProfile(row);
  }

  async listTypes(user: AuthUser) {
    const schema = this.requireSchema(user);
    await this.ensureGenericProfiles(schema);
    // Agrupa HG8145X6 / HG8145X6-10 (y similares) sin bloquear con ACS.
    await this.onuCatalog.dedupeTenantModelNames(schema);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const profileRepo =
      await this.tenantConnections.getOnuProfileRepository(schema);
    const types = await typeRepo.find({
      where: { listed: true },
      order: { name: 'ASC' },
    });
    const profiles = await profileRepo.find();
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const onuCounts = await this.onuCatalog.countOnusByModel(schema);
    return {
      types: this.collapseTypesForList(types, onuCounts).map((t) =>
        this.serializeType(
          t,
          profileById.get(t.defaultProfileId ?? ''),
          onuCounts.get(normalizeOnuModelName(t.name).toLowerCase()) ?? 0,
        ),
      ),
    };
  }

  /** Fuerza reconciliación ACS → onu_type + tipos (botón Refrescar modelos). */
  async reconcileTypesFromAcs(user: AuthUser) {
    const schema = this.requireSchema(user);
    await this.ensureGenericProfiles(schema);
    const result = await this.onuCatalog.reconcileConnectedModelsFromAcs(schema);
    await this.onuCatalog.dedupeTenantModelNames(schema);
    await this.onuCatalog.pruneUndetectedCatalogTypes(schema);
    await this.onuCatalog.enrichTenantExistingTypes(schema);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const profileRepo =
      await this.tenantConnections.getOnuProfileRepository(schema);
    const types = await typeRepo.find({
      where: { listed: true },
      order: { name: 'ASC' },
    });
    const profiles = await profileRepo.find();
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const onuCounts = await this.onuCatalog.countOnusByModel(schema);
    return {
      ...result,
      types: this.collapseTypesForList(types, onuCounts).map((t) =>
        this.serializeType(
          t,
          profileById.get(t.defaultProfileId ?? ''),
          onuCounts.get(normalizeOnuModelName(t.name).toLowerCase()) ?? 0,
        ),
      ),
    };
  }

  async getType(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const profileRepo =
      await this.tenantConnections.getOnuProfileRepository(schema);
    const row = await typeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Tipo de ONU no encontrado');
    const profile = row.defaultProfileId
      ? await profileRepo.findOne({ where: { id: row.defaultProfileId } })
      : null;
    const onuCounts = await this.onuCatalog.countOnusByModel(schema);
    return this.serializeType(
      row,
      profile ?? undefined,
      onuCounts.get(normalizeOnuModelName(row.name).toLowerCase()) ?? 0,
    );
  }

  async createType(user: AuthUser, dto: CreateOnuTypeDto) {
    const schema = this.requireSchema(user);
    await this.ensureGenericProfiles(schema);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const name = normalizeOnuModelName(dto.name);
    if (!name) throw new BadRequestException('Nombre requerido');
    if (isPlaceholderOnuModel(name)) {
      throw new BadRequestException(
        `«${name}» no es un modelo válido (placeholder ACS/OLT)`,
      );
    }
    const dup = await typeRepo.findOne({ where: { name } });
    if (dup) {
      throw new BadRequestException(`Ya existe el tipo de ONU «${name}»`);
    }

    let defaultProfileCode: string | null = null;
    if (dto.defaultProfileId) {
      const p = await this.requireProfile(schema, dto.defaultProfileId);
      defaultProfileCode = p.code;
    }

    const useDefaultImage = dto.useDefaultImage ?? true;
    const defaultImageUrl = resolveOnuImageUrl(
      imageKeyForVendorCapability(
        inferOnuVendor(name),
        dto.capability ?? 'bridging_routing',
      ),
    );
    let imageUrl = defaultImageUrl;
    if (!useDefaultImage && dto.imageUrl) {
      try {
        imageUrl = sanitizeOnuImageInput(dto.imageUrl);
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'Imagen inválida',
        );
      }
    }

    const catalogItem = await this.onuCatalog.registerTenantCreatedType({
      schemaName: schema,
      name,
      vendor: inferOnuVendor(name),
      ponType: dto.ponType,
      ethernetPorts: dto.ethernetPorts ?? 1,
      wifiSsids: dto.wifiSsids ?? 0,
      voipPorts: dto.voipPorts ?? 0,
      catv: dto.catv ?? false,
      capability: dto.capability ?? 'bridging_routing',
      allowCustomProfiles: dto.allowCustomProfiles ?? true,
      defaultProfileCode,
      imageUrl: !useDefaultImage && isCustomOnuImageUrl(imageUrl) ? imageUrl : null,
    });

    if (catalogItem.registrationStatus === 'approved') {
      await this.onuCatalog.ensureCatalogItemInTenant(schema, catalogItem, {
        listed: true,
      });
      const saved = await typeRepo.findOne({ where: { name } });
      if (saved) {
        if (!saved.listed) {
          saved.listed = true;
          await typeRepo.save(saved);
        }
        return this.getType(user, saved.id);
      }
    }

    const channel = dto.channel?.trim() || (dto.ponType === 'epon' ? 'E' : 'G');
    const row = typeRepo.create({
      ponType: dto.ponType,
      channel,
      channelGpon: dto.channelGpon ?? dto.ponType === 'gpon',
      channelXgpon: dto.channelXgpon ?? false,
      channelXgspon: dto.channelXgspon ?? false,
      name,
      vendor: catalogItem.vendor,
      fromCatalog: true,
      listed: true,
      ethernetPorts: dto.ethernetPorts ?? 1,
      wifiSsids: dto.wifiSsids ?? 0,
      voipPorts: dto.voipPorts ?? 0,
      catv: dto.catv ?? false,
      allowCustomProfiles: dto.allowCustomProfiles ?? true,
      defaultProfileId: dto.defaultProfileId ?? null,
      capability: dto.capability ?? 'bridging_routing',
      useDefaultImage: useDefaultImage || !isCustomOnuImageUrl(imageUrl),
      imageUrl,
    });
    await typeRepo.save(row);
    return this.getType(user, row.id);
  }

  async updateType(user: AuthUser, id: string, dto: UpdateOnuTypeDto) {
    const schema = this.requireSchema(user);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const row = await typeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Tipo de ONU no encontrado');
    if (dto.name !== undefined) {
      const name = normalizeOnuModelName(dto.name);
      if (!name) throw new BadRequestException('Nombre requerido');
      const dup = await typeRepo.findOne({ where: { name } });
      if (dup && dup.id !== id) {
        throw new BadRequestException(`Ya existe el tipo de ONU «${name}»`);
      }
      row.name = name;
    }
    if (dto.ponType !== undefined) row.ponType = dto.ponType;
    if (dto.channel !== undefined) {
      row.channel = dto.channel.trim() || row.channel;
    }
    if (dto.channelGpon !== undefined) row.channelGpon = dto.channelGpon;
    if (dto.channelXgpon !== undefined) row.channelXgpon = dto.channelXgpon;
    if (dto.channelXgspon !== undefined) row.channelXgspon = dto.channelXgspon;
    if (dto.ethernetPorts !== undefined) row.ethernetPorts = dto.ethernetPorts;
    if (dto.wifiSsids !== undefined) row.wifiSsids = dto.wifiSsids;
    if (dto.voipPorts !== undefined) row.voipPorts = dto.voipPorts;
    if (dto.catv !== undefined) row.catv = dto.catv;
    if (dto.allowCustomProfiles !== undefined) {
      row.allowCustomProfiles = dto.allowCustomProfiles;
    }
    if (dto.defaultProfileId !== undefined) {
      if (dto.defaultProfileId) {
        await this.requireProfile(schema, dto.defaultProfileId);
      }
      row.defaultProfileId = dto.defaultProfileId;
    }
    if (dto.capability !== undefined) row.capability = dto.capability;
    if (dto.imageUrl !== undefined) {
      if (dto.imageUrl == null || dto.imageUrl === '') {
        row.imageUrl = resolveOnuImageUrl(
          imageKeyForVendorCapability(row.vendor, row.capability),
        );
        row.useDefaultImage = true;
      } else {
        try {
          row.imageUrl = sanitizeOnuImageInput(dto.imageUrl);
        } catch (e) {
          throw new BadRequestException(
            e instanceof Error ? e.message : 'Imagen inválida',
          );
        }
        row.useDefaultImage = false;
      }
    } else if (dto.useDefaultImage === true) {
      row.useDefaultImage = true;
      row.imageUrl = resolveOnuImageUrl(
        imageKeyForVendorCapability(row.vendor, row.capability),
      );
    } else if (dto.useDefaultImage === false) {
      row.useDefaultImage = false;
    }
    await typeRepo.save(row);

    let defaultProfileCode: string | null | undefined = undefined;
    if (row.defaultProfileId) {
      try {
        const p = await this.requireProfile(schema, row.defaultProfileId);
        defaultProfileCode = p.code;
      } catch {
        defaultProfileCode = null;
      }
    }

    await this.onuCatalog.registerTenantCreatedType({
      schemaName: schema,
      name: row.name,
      vendor: row.vendor,
      ponType: row.ponType,
      ethernetPorts: row.ethernetPorts,
      wifiSsids: row.wifiSsids,
      voipPorts: row.voipPorts,
      catv: row.catv,
      capability: row.capability,
      allowCustomProfiles: row.allowCustomProfiles,
      defaultProfileCode,
      imageUrl:
        !row.useDefaultImage && isCustomOnuImageUrl(row.imageUrl)
          ? row.imageUrl
          : null,
    });

    return this.getType(user, row.id);
  }

  /** Removes from this tenant only — catalog / other tenants untouched. */
  async removeType(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const typeRepo = await this.tenantConnections.getOnuTypeRepository(schema);
    const row = await typeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Tipo de ONU no encontrado');
    await typeRepo.remove(row);
    return { ok: true };
  }

  private async requireProfile(schema: string, id: string) {
    const repo = await this.tenantConnections.getOnuProfileRepository(schema);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new BadRequestException('Perfil personalizado no válido');
    return p;
  }

  private serializeProfile(p: OnuProfile) {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      vlanCli: p.vlanCli,
      portKind: p.portKind,
      sortOrder: p.sortOrder,
      isSystem: p.isSystem,
      label: `${p.name} (usa «${p.vlanCli}»)`,
    };
  }

  private collapseTypesForList(
    types: OnuType[],
    onuCounts: Map<string, number>,
  ): OnuType[] {
    const byNorm = new Map<string, OnuType>();
    for (const t of types) {
      const norm = normalizeOnuModelName(t.name);
      if (!norm || isPlaceholderOnuModel(norm)) continue;
      const key = norm.toLowerCase();
      const count = onuCounts.get(key) ?? 0;
      if (count <= 0) continue;
      const prev = byNorm.get(key);
      if (!prev) {
        byNorm.set(key, t);
        continue;
      }
      const prevExact = prev.name.trim().toLowerCase() === key;
      const curExact = t.name.trim().toLowerCase() === key;
      if (curExact && !prevExact) byNorm.set(key, t);
    }
    return [...byNorm.values()].sort((a, b) =>
      normalizeOnuModelName(a.name).localeCompare(
        normalizeOnuModelName(b.name),
        undefined,
        { sensitivity: 'base' },
      ),
    );
  }

  private serializeType(
    t: OnuType,
    defaultProfile?: OnuProfile | null,
    onuCount = 0,
  ) {
    const localFallback = resolveOnuImageUrl(
      imageKeyForVendorCapability(t.vendor, t.capability),
    );
    const imageDisplayUrl = resolveOnuTypeDisplayImage(t);
    const stored = t.imageUrl?.trim() || null;
    const customImageUrl =
      !t.useDefaultImage && stored && !stored.startsWith('/onu/')
        ? stored
        : null;
    const displayName = normalizeOnuModelName(t.name) || t.name;
    const script = resolveOnuDriverForModel({
      vendor: t.vendor,
      model: displayName,
    });
    return {
      id: t.id,
      ponType: t.ponType,
      ponTypeLabel: t.ponType.toUpperCase(),
      channel: t.channel,
      channelGpon: t.channelGpon,
      channelXgpon: t.channelXgpon,
      channelXgspon: t.channelXgspon,
      name: displayName,
      vendor: t.vendor,
      vendorLabel:
        t.vendor === 'zte'
          ? 'ZTE'
          : t.vendor === 'huawei'
            ? 'Huawei'
            : t.vendor === 'fiberhome'
              ? 'FiberHome'
              : t.vendor,
      fromCatalog: t.fromCatalog,
      onuCount,
      ethernetPorts: t.ethernetPorts,
      wifiSsids: t.wifiSsids,
      voipPorts: t.voipPorts,
      catv: t.catv,
      allowCustomProfiles: t.allowCustomProfiles,
      allowCustomProfilesLabel: t.allowCustomProfiles ? 'Sí' : 'No',
      defaultProfileId: t.defaultProfileId,
      defaultProfileName: defaultProfile?.name ?? null,
      /** Script TR-069 real (library/generic) — reemplaza el Generic_N de UI. */
      provisionScriptId: script.provisionScriptId,
      provisionScriptLabel: script.provisionScriptLabel,
      provisionScriptKind: script.provisionScriptKind,
      skipOmciServiceWan: script.skipOmciServiceWan,
      capability: t.capability,
      capabilityLabel:
        t.capability === 'bridging' ? 'Bridging' : 'Bridging/Routing',
      useDefaultImage: t.useDefaultImage,
      customImageUrl,
      imageUrl: imageDisplayUrl,
      imageDisplayUrl,
      localImageUrl: localFallback,
    };
  }
}
