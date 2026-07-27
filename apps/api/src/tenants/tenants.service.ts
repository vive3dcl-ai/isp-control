import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantStatus } from './entities/tenant.entity';
import { UserDirectory } from './entities/user-directory.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  COMPANY_CURRENCIES,
  COMPANY_CURRENCY_CODES,
} from './company-currencies';
import {
  internalSuspensionPortalUrl,
  normalizePortalUrl,
  parsePortalUrl,
} from '../topology/suspension-portal-url';
import { PlatformPublicUrlsService } from '../platform/platform-public-urls.service';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(UserDirectory)
    private readonly directory: Repository<UserDirectory>,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantConnections: TenantConnectionService,
    private readonly publicUrls: PlatformPublicUrlsService,
  ) {}

  list() {
    return this.tenants.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const owners = await this.directory.find({
      where: { tenantId: id },
      order: { createdAt: 'ASC' },
    });

    return { ...tenant, users: owners };
  }

  create(dto: CreateTenantDto) {
    return this.provisioning.provision(dto);
  }

  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.applyCompanyFields(tenant, dto);
    if (dto.status !== undefined) {
      tenant.status = dto.status;
    }

    return this.tenants.save(tenant);
  }

  async getCompany(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return this.serializeCompany(tenant);
  }

  async updateCompany(tenantId: string, dto: UpdateCompanyDto) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    this.applyCompanyFields(tenant, dto);
    if (tenant.suspensionPortalMode === 'external') {
      if (!tenant.suspensionPortalExternalUrl?.trim()) {
        throw new BadRequestException(
          'Indica la URL del portal externo (http:// o https://)',
        );
      }
    }
    const saved = await this.tenants.save(tenant);
    return this.serializeCompany(saved);
  }

  listCurrencies() {
    return COMPANY_CURRENCIES;
  }

  private applyCompanyFields(
    tenant: Tenant,
    dto: UpdateTenantDto | UpdateCompanyDto,
  ) {
    if (dto.name !== undefined) tenant.name = dto.name.trim();
    if (dto.legalName !== undefined) tenant.legalName = dto.legalName.trim();
    if (dto.phone !== undefined) tenant.phone = dto.phone.trim();
    if ('email' in dto && dto.email !== undefined)
      tenant.email = (dto.email ?? '').trim();
    if (dto.address !== undefined) tenant.address = dto.address.trim();
    if ('city' in dto && dto.city !== undefined)
      tenant.city = (dto.city ?? '').trim();
    if ('country' in dto && dto.country !== undefined)
      tenant.country = (dto.country ?? '').trim();
    if ('taxId' in dto && dto.taxId !== undefined)
      tenant.taxId = (dto.taxId ?? '').trim();
    if ('legalRepresentative' in dto && dto.legalRepresentative !== undefined) {
      tenant.legalRepresentative = (dto.legalRepresentative ?? '').trim();
    }
    if ('currency' in dto && dto.currency !== undefined) {
      const code = dto.currency.trim().toUpperCase();
      if (!(COMPANY_CURRENCY_CODES as readonly string[]).includes(code)) {
        throw new BadRequestException('Moneda no soportada');
      }
      tenant.currency = code;
    }
    if ('logoUrl' in dto && dto.logoUrl !== undefined) {
      tenant.logoUrl = this.sanitizeLogo(dto.logoUrl ?? '');
    }
    if ('invoiceFooter' in dto && dto.invoiceFooter !== undefined) {
      tenant.invoiceFooter = (dto.invoiceFooter ?? '').trim();
    }
    if ('invoiceDocLabel' in dto && dto.invoiceDocLabel !== undefined) {
      tenant.invoiceDocLabel =
        dto.invoiceDocLabel === 'Boleta' ? 'Boleta' : 'Factura';
    }
    if (
      'suspensionPortalEnabled' in dto &&
      dto.suspensionPortalEnabled !== undefined
    ) {
      tenant.suspensionPortalEnabled = !!dto.suspensionPortalEnabled;
    }
    if (
      'suspensionPortalRouterIds' in dto &&
      dto.suspensionPortalRouterIds !== undefined
    ) {
      tenant.suspensionPortalRouterIds = [
        ...new Set(dto.suspensionPortalRouterIds),
      ];
    }
    if (
      'suspensionPortalTemplateId' in dto &&
      dto.suspensionPortalTemplateId !== undefined
    ) {
      tenant.suspensionPortalTemplateId = dto.suspensionPortalTemplateId.trim();
    }
    if (
      'suspensionPortalLogoUrl' in dto &&
      dto.suspensionPortalLogoUrl !== undefined
    ) {
      tenant.suspensionPortalLogoUrl = this.sanitizeLogo(
        dto.suspensionPortalLogoUrl ?? '',
      );
    }
    if (
      'suspensionPortalMode' in dto &&
      dto.suspensionPortalMode !== undefined
    ) {
      tenant.suspensionPortalMode =
        dto.suspensionPortalMode === 'external' ? 'external' : 'internal';
    }
    if (
      'suspensionPortalExternalUrl' in dto &&
      dto.suspensionPortalExternalUrl !== undefined
    ) {
      const raw = (dto.suspensionPortalExternalUrl ?? '').trim();
      if (raw) {
        try {
          tenant.suspensionPortalExternalUrl = parsePortalUrl(raw).url;
        } catch (err) {
          throw new BadRequestException(
            err instanceof Error ? err.message : 'URL de portal inválida',
          );
        }
      } else {
        tenant.suspensionPortalExternalUrl = '';
      }
    }
  }

  private async currentSuspensionPortalUrl(tenant: Tenant): Promise<string> {
    if (
      tenant.suspensionPortalMode === 'external' &&
      tenant.suspensionPortalExternalUrl?.trim()
    ) {
      return normalizePortalUrl(tenant.suspensionPortalExternalUrl);
    }
    const webBase = await this.publicUrls.resolvePublicWebUrl();
    return normalizePortalUrl(
      internalSuspensionPortalUrl(webBase, tenant.slug),
    );
  }

  /** Only allow image data URLs or http(s) URLs for the logo. */
  private sanitizeLogo(raw: string): string {
    const value = raw.trim();
    if (!value) return '';
    const ok =
      /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value) ||
      /^https?:\/\//i.test(value);
    if (!ok) {
      throw new BadRequestException(
        'Logo inválido: usa una imagen (PNG/JPG/SVG/WebP) o una URL http(s)',
      );
    }
    return value;
  }

  private async serializeCompany(tenant: Tenant) {
    const suspensionPortalUrl = await this.currentSuspensionPortalUrl(tenant);
    const applied = tenant.suspensionPortalAppliedUrl
      ? normalizePortalUrl(tenant.suspensionPortalAppliedUrl)
      : '';
    const hasRouters =
      Array.isArray(tenant.suspensionPortalRouterIds) &&
      tenant.suspensionPortalRouterIds.length > 0;
    const suspensionPortalNeedsMikrotikReconfigure =
      !!tenant.suspensionPortalEnabled &&
      hasRouters &&
      (!applied || applied !== suspensionPortalUrl);

    return {
      id: tenant.id,
      name: tenant.name,
      legalName: tenant.legalName,
      phone: tenant.phone,
      email: tenant.email ?? '',
      address: tenant.address,
      city: tenant.city ?? '',
      country: tenant.country ?? '',
      taxId: tenant.taxId ?? '',
      legalRepresentative: tenant.legalRepresentative ?? '',
      currency: tenant.currency || 'USD',
      logoUrl: tenant.logoUrl ?? '',
      invoiceFooter: tenant.invoiceFooter ?? '',
      invoiceDocLabel: tenant.invoiceDocLabel || 'Factura',
      suspensionPortalEnabled: !!tenant.suspensionPortalEnabled,
      suspensionPortalRouterIds: Array.isArray(tenant.suspensionPortalRouterIds)
        ? tenant.suspensionPortalRouterIds
        : [],
      suspensionPortalTemplateId:
        tenant.suspensionPortalTemplateId || 'midnight',
      suspensionPortalLogoUrl: tenant.suspensionPortalLogoUrl ?? '',
      suspensionPortalMode:
        tenant.suspensionPortalMode === 'external' ? 'external' : 'internal',
      suspensionPortalExternalUrl: tenant.suspensionPortalExternalUrl ?? '',
      suspensionPortalUrl,
      suspensionPortalAppliedUrl: applied || null,
      suspensionPortalNeedsMikrotikReconfigure,
      slug: tenant.slug,
    };
  }

  async updateStatus(id: string, status: TenantStatus) {
    return this.update(id, { status });
  }

  async remove(id: string, confirmationSlug: string) {
    const tenant = await this.tenants.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (confirmationSlug.trim() !== tenant.slug) {
      throw new BadRequestException(
        'Confirmation slug does not match. Type the exact company slug to delete.',
      );
    }

    await this.directory.delete({ tenantId: id });
    await this.tenantConnections.dropTenantSchema(tenant.schemaName);
    await this.tenants.delete({ id });

    return { ok: true, deletedId: id, slug: tenant.slug };
  }

  count() {
    return this.tenants.count();
  }
}
